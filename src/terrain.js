import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { naturalHeight, mountainMask, smooth, mix, perlin, WATER_Y, mulberry32 } from './heights.js';
import { windowTexture } from './textures.js';

// Infinite terrain in square chunks that are built around the train and dropped behind it.
const C = 200, SEG = 40, R = 4;
const V3 = THREE.Vector3;

export function coloredGeo(geo, hex) {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export class Terrain {
  constructor(scene, net, stations, roads) {
    this.scene = scene; this.net = net; this.stations = stations; this.roads = roads;
    this.chunks = new Map();
    this.dirty = new Set();
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 1, flatShading: true });
    this.pineGeo = mergeGeometries([
      coloredGeo(new THREE.ConeGeometry(2.3, 7, 8).translate(0, 5.5, 0), 0x2f6b34),
      coloredGeo(new THREE.CylinderGeometry(0.3, 0.45, 2.5, 6).translate(0, 1.25, 0), 0x6e4a2c),
    ]);
    this.roundGeo = mergeGeometries([
      coloredGeo(new THREE.IcosahedronGeometry(3, 1).translate(0, 5.2, 0), 0x5d9e3c),
      coloredGeo(new THREE.CylinderGeometry(0.35, 0.5, 3.6, 6).translate(0, 1.8, 0), 0x6e4a2c),
    ]);
    this.rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const wTex = windowTexture();
    this.buildingMats = [0xf2d6a2, 0xf4a6a6, 0xa6c8f4, 0xc9f2a6, 0xf7f0e0, 0xe8c1f0, 0xffd27a]
      .map((c) => new THREE.MeshStandardMaterial({ color: c, map: wTex, roughness: 0.8 }));
    this.roofMats = [0xb5442f, 0x7a4b35, 0x5d6470, 0x3c6e8f].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    this.roofGeo = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4);
  }

  key(cx, cz) { return cx * 100003 + cz; }

  // Final ground height: natural land, flattened for towns, carved for the tracks, then levelled for roads.
  heightAt(x, z) {
    let h = naturalHeight(x, z);
    for (const st of this.stations.list) {
      const d = Math.hypot(x - st.trackPos.x, z - st.trackPos.z);
      if (d < st.townR + 60) h = mix(st.townY, h, smooth(st.townR * 0.6, st.townR + 60, d));
    }
    const n = this.net.nearest(x, z, 70);
    if (n) {
      const bed = n.y - 0.55;
      h = mix(bed, h, smooth(12, Math.min(70, 30 + Math.abs(h - bed) * 0.5), n.d));
    }
    return this.roads.flatten(x, z, h);
  }

  markDirtyArea(x, z, r) {
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++)
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const k = this.key(cx, cz);
        if (this.chunks.has(k)) this.dirty.add(k);
      }
  }

  markDirtyEdge(e) {
    const v = new V3();
    for (let d = 0; d <= e.length + 39; d += 40) { e.pointAt(Math.min(d, e.length), v); this.markDirtyArea(v.x, v.z, 75); }
  }

  update(pos, budget) {
    const pcx = Math.floor(pos.x / C), pcz = Math.floor(pos.z / C);
    const todo = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const k = this.key(pcx + dx, pcz + dz);
      if (!this.chunks.has(k) || this.dirty.has(k)) todo.push([dx * dx + dz * dz, pcx + dx, pcz + dz, k]);
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(budget, todo.length); i++) {
      const [, cx, cz, k] = todo[i];
      if (this.chunks.has(k)) this.disposeChunk(k);
      this.chunks.set(k, this.buildChunk(cx, cz));
      this.dirty.delete(k);
    }
    for (const [k, ch] of this.chunks) {
      if (Math.abs(ch.cx - pcx) > R + 1 || Math.abs(ch.cz - pcz) > R + 1) this.disposeChunk(k);
    }
  }

  disposeChunk(k) {
    const ch = this.chunks.get(k);
    this.scene.remove(ch.group);
    ch.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.geometry && o.userData.own) o.geometry.dispose();
    });
    this.chunks.delete(k);
    this.dirty.delete(k);
  }

  buildChunk(cx, cz) {
    const group = new THREE.Group();
    const x0 = cx * C, z0 = cz * C, N = SEG, cs = C / N, M = N + 3;
    const H = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) H[j * M + i] = this.heightAt(x0 + (i - 1) * cs, z0 + (j - 1) * cs);

    const V = (N + 1) * (N + 1);
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3);
    const n = new V3(), c = new THREE.Color();
    const grassA = new THREE.Color(0x5aa64a), grassB = new THREE.Color(0x86c95a), sand = new THREE.Color(0xd9c98f),
      rock = new THREE.Color(0x857d74), snow = new THREE.Color(0xf4f7fb), town = new THREE.Color(0xb9b3a4), gravel = new THREE.Color(0x8f877c);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const v = j * (N + 1) + i, x = x0 + i * cs, z = z0 + j * cs, h = H[(j + 1) * M + i + 1];
      n.set(H[(j + 1) * M + i] - H[(j + 1) * M + i + 2], 2 * cs, H[j * M + i + 1] - H[(j + 2) * M + i + 1]).normalize();
      pos.set([x, h, z], v * 3);
      nor.set([n.x, n.y, n.z], v * 3);
      c.copy(grassA).lerp(grassB, smooth(-0.4, 0.4, perlin.noise(x / 40, z / 40, 2.2)));
      for (const st of this.stations.list) {
        c.lerp(town, 0.85 * smooth(st.townR + 10, st.townR - 20, Math.hypot(x - st.trackPos.x, z - st.trackPos.z)));
      }
      c.lerp(rock, smooth(0.86, 0.7, n.y));
      c.lerp(snow, smooth(90, 110, h + perlin.noise(x / 30, z / 30, 5) * 12));
      c.lerp(sand, smooth(WATER_Y + 1.6, WATER_Y + 0.4, h));
      const tr = this.net.nearest(x, z, 6);
      if (tr) c.lerp(gravel, smooth(6, 3, tr.d));
      col.set([c.r, c.g, c.b], v * 3);
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + N + 1, cc = a + 1, d = b + 1;
      idx.push(a, b, cc, cc, b, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;
    ground.userData.own = true;
    group.add(ground);

    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663));
    this.addTrees(group, x0, z0, rand);
    this.addRocks(group, x0, z0, rand);
    this.addBuildings(group, x0, z0);
    this.scene.add(group);
    return { cx, cz, group };
  }

  inTown(x, z, pad) {
    for (const st of this.stations.list) if (Math.hypot(x - st.trackPos.x, z - st.trackPos.z) < st.townR + pad) return true;
    return false;
  }

  addTrees(group, x0, z0, rand) {
    const density = smooth(-0.35, 0.35, perlin.noise(x0 / 600 + 0.3, z0 / 600 + 0.3, 4.4));
    const attempts = 15 + density * 110;
    const pines = [], rounds = [];
    for (let i = 0; i < attempts; i++) {
      const x = x0 + rand() * C, z = z0 + rand() * C;
      if (this.inTown(x, z, 8) || this.net.nearest(x, z, 10) || this.roads.near(x, z, 10)) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_Y + 0.8 || h > 110) continue;
      const t = { x, y: h - 0.2, z, s: 0.7 + rand() * 0.8, ry: rand() * 6.28, hue: rand() };
      (rand() < 0.3 + mountainMask(x, z) * 0.6 ? pines : rounds).push(t);
    }
    const col = new THREE.Color();
    this.instanced(group, this.pineGeo, this.treeMat, pines, (t) => col.setHSL(0.28 + t.hue * 0.06, 0.25, 0.85 + t.hue * 0.15));
    this.instanced(group, this.roundGeo, this.treeMat, rounds, (t) => col.setHSL(0.15 + t.hue * 0.15, 0.4, 0.8 + t.hue * 0.2));
  }

  addRocks(group, x0, z0, rand) {
    const rocks = [];
    for (let i = 0; i < 12; i++) {
      const x = x0 + rand() * C, z = z0 + rand() * C;
      const h = this.heightAt(x, z);
      if (h < 45 || this.net.nearest(x, z, 10) || this.roads.near(x, z, 10)) continue;
      rocks.push({ x, y: h - 0.5, z, s: 2 + rand() * 5, sx: 0.8 + rand() * 0.6, sy: 0.5 + rand() * 0.5, ry: rand() * 6.28 });
    }
    this.instanced(group, this.rockGeo, this.rockMat, rocks);
  }

  instanced(group, geo, mat, list, colorFn) {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const d = new THREE.Object3D();
    list.forEach((t, i) => {
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, t.ry, 0);
      d.scale.set(t.s * (t.sx ?? 1), t.s * (t.sy ?? 1), t.s);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (colorFn) m.setColorAt(i, colorFn(t));
    });
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }

  addBuildings(group, x0, z0) {
    for (const st of this.stations.list) {
      for (const b of st.spots) {
        if (b.x < x0 || b.x >= x0 + C || b.z < z0 || b.z >= z0 + C) continue;
        if (this.net.nearest(b.x, b.z, 18)) continue;
        const y = this.heightAt(b.x, b.z);
        const geo = new THREE.BoxGeometry(b.w, b.h + 1, b.d);
        boxUV(geo, b.w, b.h + 1, b.d);
        const m = new THREE.Mesh(geo, this.buildingMats[b.mat]);
        m.position.set(b.x, y + (b.h - 1) / 2, b.z);
        m.rotation.y = b.yaw;
        m.castShadow = m.receiveShadow = true;
        m.userData.own = true;
        group.add(m);
        if (!b.tall) {
          const roof = new THREE.Mesh(this.roofGeo, this.roofMats[b.roof]);
          roof.scale.set(b.w + 0.8, 3.2, b.d + 0.8);
          roof.position.set(b.x, y + b.h + 1.6, b.z);
          roof.rotation.y = b.yaw;
          roof.castShadow = true;
          group.add(roof);
        }
      }
    }
  }
}

function boxUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.02); continue; }
    const horiz = f < 2 ? d : w;
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(horiz / 5)), uv.getY(i) * Math.max(1, Math.round(h / 3.5)));
  }
}

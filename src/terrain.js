import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { naturalHeight, smooth, mix, perlin, WATER_Y, mulberry32, groundSnow, biomeWeights, snowiness } from './heights.js';
import { windowTexture, windowLitTexture, bulbsTexture } from './textures.js';
import { coloredGeo, floraGeos, KIND, FLORA, MAX_DENSITY } from './flora.js';
import { liftDistance } from './skitown.js';
import { nightGlow } from './daynight.js';

// Infinite terrain in square chunks that are built around the train and dropped behind it.
const C = 200, SEG = 40, R = 4;
const V3 = THREE.Vector3;

export { coloredGeo };

// ground colours per biome (two shades, mixed with noise)
const GROUND = {
  meadow: [0x5aa64a, 0x86c95a], autumn: [0x8f9a3c, 0xc49a46], winter: [0x5aa64a, 0x86c95a], christmas: [0x5aa64a, 0x86c95a],
  swamp: [0x4a5a2a, 0x6a6432], rainforest: [0x2c8a34, 0x4cae3a], mountain: [0x5a9446, 0x7fb256], ocean: [0x8fbf5e, 0xb8c873],
};
const GROUND_C = Object.fromEntries(Object.entries(GROUND).map(([b, [p, q]]) => [b, [new THREE.Color(p), new THREE.Color(q)]]));

export class Terrain {
  constructor(scene, net, stations, roads) {
    this.scene = scene; this.net = net; this.stations = stations; this.roads = roads;
    this.chunks = new Map();
    this.dirty = new Set();
    this.groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x8a837a, roughness: 1, flatShading: true });
    this.flora = floraGeos();
    this.decoMat = new THREE.MeshBasicMaterial({ vertexColors: true }); // Christmas baubles: always bright
    const bulbs = bulbsTexture();
    this.lightsMat = nightGlow(new THREE.MeshStandardMaterial({ map: bulbs, emissive: 0xffffff, emissiveMap: bulbs, roughness: 0.5 }), 'emissiveIntensity', 2.2);
    this.lampMat = nightGlow(new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffe08a }), 'emissiveIntensity', 4);
    this.snowRoofMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.9 });
    this.rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const wTex = windowTexture(), wLit = windowLitTexture();
    this.buildingMats = [0xf2d6a2, 0xf4a6a6, 0xa6c8f4, 0xc9f2a6, 0xf7f0e0, 0xe8c1f0, 0xffd27a]
      .map((c) => new THREE.MeshStandardMaterial({ color: c, map: wTex, roughness: 0.8, emissive: 0xffffff, emissiveMap: wLit }));
    for (const m of this.buildingMats) nightGlow(m, 'emissiveIntensity', 0.9); // cosy lit windows at night
    // North Pole houses: red, green, white and gingerbread
    this.northPoleMats = [0xc8322f, 0x2f7a4a, 0xf4f1ea, 0xb5713a, 0xe8a0b4]
      .map((c) => nightGlow(new THREE.MeshStandardMaterial({ color: c, map: wTex, roughness: 0.8, emissive: 0xffffff, emissiveMap: wLit }), 'emissiveIntensity', 0.9));
    // ski chalets: honey-coloured wood, stone base, dark balconies, snowy gable roofs
    this.chaletMats = [0xa8703f, 0x8b5a2b, 0xb8834e, 0x9a6233]
      .map((c) => nightGlow(new THREE.MeshStandardMaterial({ color: c, map: wTex, roughness: 0.85, emissive: 0xffffff, emissiveMap: wLit }), 'emissiveIntensity', 0.9));
    this.chaletStone = new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 1 });
    this.chaletDark = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });
    const tri = new THREE.Shape(); tri.moveTo(-0.5, 0); tri.lineTo(0.5, 0); tri.lineTo(0, 1); tri.lineTo(-0.5, 0);
    this.gableGeo = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
    this.gableGeo.userData.shared = true;
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
    if (this.depots) h = this.depots.flatten(x, z, h);
    const n = this.net.nearest(x, z, 70);
    if (n) {
      const bed = n.y - 0.55;
      if (n.mode === 'tunnel') {
        // keep the mountain, and make sure there's always some roof over the tunnel
        if (n.d < 16) h = Math.max(h, n.y + 9 - smooth(8, 16, n.d) * 40);
      } else if (n.mode === 'portal') {
        // slot hidden behind the (8.5 m wide) portal wall; inside the arch it sits under the tunnel floor
        h = mix(n.d < 4.5 ? n.y - 0.9 : bed, Math.max(h, n.y + 9), smooth(6, 10, n.d));
        // Steep mountains: keep the hill no higher than the top of the portal wall right around the
        // entrance, or the (5 m) ground triangles stretch out in front of the portal and cover it.
        if (n.d < 12) h = Math.min(h, n.y + 9);
        // and only let it rise once we're 5 m (one ground triangle) behind the front of the wall
        if (n.depth < 4.5 && n.d < 10) h = Math.min(h, bed);
      } else if (n.mode === 'bridge') {
        h = Math.min(h, n.y - 4 + smooth(6, 14, n.d) * 60); // leave the valley open under the deck
      } else {
        // cut or embankment; an embankment narrows towards a bridge abutment
        const k = Math.min(1, n.endDist / 25), diff = Math.abs(h - bed);
        let inner = mix(5, 12, k);
        let outer = Math.max(inner + 1, mix(inner + diff * 1.2, Math.min(70, 30 + diff * 0.5), k));
        if (h < bed) { inner = mix(4.5, 7, k); outer = inner + Math.min(25, 2 + diff * 2.2); } // embankments: a bank, not a plain
        h = mix(bed, h, smooth(inner, outer, n.d));
      }
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
    const sand = new THREE.Color(0xd9c98f),
      rock = new THREE.Color(0x857d74), snow = new THREE.Color(0xf4f7fb), town = new THREE.Color(0xb9b3a4), gravel = new THREE.Color(0x8f877c), yard = new THREE.Color(0x77706a),
      leafy = new THREE.Color(0xc8742c), mud = new THREE.Color(0x4b4127);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const v = j * (N + 1) + i, x = x0 + i * cs, z = z0 + j * cs, h = H[(j + 1) * M + i + 1];
      n.set(H[(j + 1) * M + i] - H[(j + 1) * M + i + 2], 2 * cs, H[j * M + i + 1] - H[(j + 2) * M + i + 1]).normalize();
      pos.set([x, h, z], v * 3);
      nor.set([n.x, n.y, n.z], v * 3);
      const bw = biomeWeights(x, z), noise = smooth(-0.4, 0.4, perlin.noise(x / 40, z / 40, 2.2));
      c.setRGB(0, 0, 0);
      for (const b in bw.w) { const [p, q] = GROUND_C[b]; c.r += bw.w[b] * mix(p.r, q.r, noise); c.g += bw.w[b] * mix(p.g, q.g, noise); c.b += bw.w[b] * mix(p.b, q.b, noise); }
      const autumn = bw.w.autumn ?? 0, swamp = bw.w.swamp ?? 0, ocean = bw.w.ocean ?? 0;
      if (autumn) c.lerp(leafy, 0.4 * autumn * smooth(0.15, 0.5, perlin.noise(x / 13, z / 13, 7.7))); // fallen leaves
      for (const st of this.stations.list) {
        const inTown = smooth(st.townR + 10, st.townR - 20, Math.hypot(x - st.trackPos.x, z - st.trackPos.z));
        if (st.biome === 'mountain') { // ski village: snowy streets, and a snowy ski run up the mountain
          c.lerp(snow, 0.95 * Math.max(inTown, st.lift ? smooth(26, 14, liftDistance(st.lift, x, z)) : 0));
        } else c.lerp(town, 0.85 * inTown);
      }
      if (this.depots?.list.size) c.lerp(yard, 0.9 * smooth(10, 0, this.depots.outside(x, z)));
      c.lerp(rock, smooth(0.86, 0.7, n.y));
      const snowLine = mix(95, 68, bw.w.mountain ?? 0); // the mountains have snow on their upper slopes
      c.lerp(snow, smooth(snowLine, snowLine + 18, h + perlin.noise(x / 30, z / 30, 5) * 12));
      c.lerp(sand, smooth(WATER_Y + 1.6 + ocean * 1.8, WATER_Y + 0.4, h) * (1 - swamp)); // beaches (wide by the sea)
      if (swamp) c.lerp(mud, swamp * smooth(WATER_Y + 1.1, WATER_Y + 0.2, h));
      c.lerp(snow, 0.93 * snowiness(bw) * smooth(0.55, 0.8, n.y)); // winter regions
      const tr = this.net.nearest(x, z, 6);
      if (tr && tr.mode === 'normal') c.lerp(gravel, smooth(6, 3, tr.d));
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
    for (const st of this.stations.list) {
      if (Math.hypot(x - st.trackPos.x, z - st.trackPos.z) < st.townR + pad) return true;
      if (st.lift && liftDistance(st.lift, x, z) < 14 + pad) return true; // keep the lift line and ski run clear
    }
    return !!this.depots?.near(x, z, pad);
  }

  // Trees, plants and props: each spot picks a biome (by how much of each biome it is), then a plant.
  addTrees(group, x0, z0, rand) {
    const density = smooth(-0.35, 0.35, perlin.noise(x0 / 600 + 0.3, z0 / 600 + 0.3, 4.4));
    const attempts = (15 + density * 110) * MAX_DENSITY;
    const lists = {};
    for (let i = 0; i < attempts; i++) {
      const x = x0 + rand() * C, z = z0 + rand() * C;
      const bw = biomeWeights(x, z);
      // pick a biome for this plant, strongly favouring the main one (cubed weights), so plants only mix near borders
      let sum = 0;
      for (const b in bw.w) sum += bw.w[b] ** 3;
      let r = rand() * sum, biome = 'meadow';
      for (const b in bw.w) { r -= bw.w[b] ** 3; if (r <= 0) { biome = b; break; } }
      const F = FLORA[biome];
      if (rand() > F.density / MAX_DENSITY) continue;
      if (this.inTown(x, z, 8) || this.net.nearest(x, z, 10) || this.roads.near(x, z, 10)) continue;
      const h = this.heightAt(x, z);
      if (h > 110) continue;
      const kind = F.pick(rand, h);
      if (!kind) continue;
      const K = KIND[kind];
      if (K.far && this.net.nearest(x, z, 40)) continue; // boats stay clear of bridges
      const [s0, s1] = K.s;
      (lists[kind] ??= []).push({ x, y: K.water ? WATER_Y + 0.03 : h - 0.2, z, s: s0 + rand() * (s1 - s0), ry: rand() * 6.28, hue: rand() });
    }
    const col = new THREE.Color();
    const tint = { pine: (t) => col.setHSL(0.28 + t.hue * 0.06, 0.25, 0.85 + t.hue * 0.15), round: (t) => col.setHSL(0.15 + t.hue * 0.15, 0.4, 0.8 + t.hue * 0.2) };
    const shade = (t) => col.setScalar(0.85 + t.hue * 0.15);
    for (const kind in lists) {
      this.instanced(group, this.flora[kind], this.treeMat, lists[kind], tint[kind] ?? shade);
      if (kind === 'xmasTree') this.instanced(group, this.flora.xmasDeco, this.decoMat, lists[kind]);
    }
    this.addLighthouse(group, x0, z0, rand);
  }

  // Now and then a lighthouse on the shore.
  addLighthouse(group, x0, z0, rand) {
    if ((biomeWeights(x0 + C / 2, z0 + C / 2).w.ocean ?? 0) < 0.5 || rand() > 0.3) return;
    for (let i = 0; i < 40; i++) {
      const x = x0 + 20 + rand() * (C - 40), z = z0 + 20 + rand() * (C - 40), h = this.heightAt(x, z);
      if (h < WATER_Y + 0.8 || h > WATER_Y + 3.5 || this.inTown(x, z, 20) || this.net.nearest(x, z, 30) || this.roads.near(x, z, 20)) continue;
      const g = new THREE.Group();
      g.position.set(x, h - 0.3, z);
      const body = new THREE.Mesh(this.flora.lighthouse, this.treeMat);
      body.castShadow = body.receiveShadow = true;
      const lamp = new THREE.Mesh(this.lampGeo ??= new THREE.CylinderGeometry(1.15, 1.15, 1.7, 12), this.lampMat);
      lamp.position.y = 16.8;
      this.lampGeo.userData.shared = true;
      g.add(body, lamp);
      group.add(g);
      return;
    }
  }

  addRocks(group, x0, z0, rand) {
    const rocks = [];
    for (let i = 0; i < 12; i++) {
      const x = x0 + rand() * C, z = z0 + rand() * C;
      const h = this.heightAt(x, z);
      if (h < 45 || this.net.nearest(x, z, 10) || this.roads.near(x, z, 10) || this.inTown(x, z, 4)) continue;
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
    const lights = [];
    for (const st of this.stations.list) {
      for (const b of st.spots) {
        if (b.x < x0 || b.x >= x0 + C || b.z < z0 || b.z >= z0 + C) continue;
        if (this.net.nearest(b.x, b.z, 18)) continue;
        if (st.lift && liftDistance(st.lift, b.x, b.z) < 12) continue;
        const y = this.heightAt(b.x, b.z);
        if (st.biome === 'mountain') { this.addChalet(group, b, y); continue; }
        const geo = new THREE.BoxGeometry(b.w, b.h + 1, b.d);
        boxUV(geo, b.w, b.h + 1, b.d);
        const mats = st.biome === 'christmas' ? this.northPoleMats : this.buildingMats;
        const m = new THREE.Mesh(geo, mats[b.mat % mats.length]);
        m.position.set(b.x, y + (b.h - 1) / 2, b.z);
        m.rotation.y = b.yaw;
        m.castShadow = m.receiveShadow = true;
        m.userData.own = true;
        group.add(m);
        if (!b.tall) {
          const roof = new THREE.Mesh(this.roofGeo, groundSnow(b.x, b.z) > 0.5 ? this.snowRoofMat : this.roofMats[b.roof]);
          roof.scale.set(b.w + 0.8, 3.2, b.d + 0.8);
          roof.position.set(b.x, y + b.h + 1.6, b.z);
          roof.rotation.y = b.yaw;
          roof.castShadow = true;
          group.add(roof);
          if ((biomeWeights(b.x, b.z).w.christmas ?? 0) > 0.4) lights.push(...this.eaveLights(b, y));
        }
      }
    }
    if (lights.length) {
      const m = new THREE.Mesh(mergeGeometries(lights), this.lightsMat);
      m.userData.own = true;
      group.add(m);
    }
  }

  // A ski chalet: stone base, wooden walls, a balcony, and a steep snowy gable roof (hotels are taller).
  addChalet(group, b, y) {
    const h = b.tall ? Math.min(b.h, 14) : b.h, w = b.w, d = b.d;
    const add = (geo, mat, px, py, pz, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz); m.rotation.y = b.yaw;
      m.castShadow = shadow; m.receiveShadow = true; m.userData.own = true;
      group.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(w + 0.3, 2.2, d + 0.3), this.chaletStone, b.x, y + 0.1, b.z);
    const walls = new THREE.BoxGeometry(w, h - 0.8, d);
    boxUV(walls, w, h - 0.8, d);
    add(walls, this.chaletMats[b.mat % this.chaletMats.length], b.x, y + 1.2 + (h - 0.8) / 2, b.z);
    // balcony along the front
    const fwd = new THREE.Vector3(Math.sin(b.yaw), 0, Math.cos(b.yaw)), bx = b.x + fwd.x * (d / 2 + 0.55), bz = b.z + fwd.z * (d / 2 + 0.55);
    for (let lvl = 0; lvl < (b.tall ? 2 : 1); lvl++) {
      const by = y + 1.2 + (h - 0.8) * (0.45 + lvl * 0.3);
      add(new THREE.BoxGeometry(w * 0.85, 0.15, 1.1), this.chaletDark, bx, by, bz);
      add(new THREE.BoxGeometry(w * 0.85, 0.7, 0.08), this.chaletDark, b.x + fwd.x * (d / 2 + 1.05), by + 0.4, b.z + fwd.z * (d / 2 + 1.05));
    }
    // steep gable roof, deep in snow
    const roof = add(this.gableGeo, this.snowRoofMat, b.x, y + 0.4 + h, b.z);
    roof.scale.set(w + 1.8, d * 0.6 + 1.5, d + 1.6); // ridge along the width, steep slopes front and back
    roof.userData.own = false; // shared geometry
  }

  // Strings of coloured lights along a house's eaves (Christmas).
  eaveLights(b, y) {
    const out = [], hw = (b.w + 0.8) / 2, hd = (b.d + 0.8) / 2;
    for (const [len, ox, oz, ry] of [[b.w + 0.8, 0, hd, 0], [b.w + 0.8, 0, -hd, 0], [b.d + 0.8, hw, 0, Math.PI / 2], [b.d + 0.8, -hw, 0, Math.PI / 2]]) {
      const g = new THREE.BoxGeometry(len, 0.28, 0.08);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 8); // 2 bulbs per metre
      g.rotateY(ry).translate(ox, 0, oz).rotateY(b.yaw).translate(b.x, y + b.h - 0.1, b.z);
      out.push(g);
    }
    return out;
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

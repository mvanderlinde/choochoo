import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mountainMask, smooth, mix, WATER_Y, mulberry32 } from './heights.js';
import { coloredGeo } from './terrain.js';
import { roadTexture, stripeTexture, glowTexture } from './textures.js';

// Roads that cross the track at level crossings, with cars, trucks and buses driving on them.
// The crossing lights and arms only come down when the driver presses SPACE; otherwise the
// traffic keeps going and any vehicle the train hits gets squashed flat (and pops back up later).

const V3 = THREE.Vector3;
const rightOf = (t) => new V3(-t.z, 0, t.x).normalize();
const clamp = THREE.MathUtils.clamp;
const HALF_W = 3.4;      // half road width
const LANE = 1.7;        // lane centre offset
const MAX_L = 150;       // max road length on each side of the track
const STEP = 4;          // profile sample spacing
const STOP_LINE = -9.5;  // where cars wait when the lights are on (crossing at 0)
const GATE_V = 7.5;      // distance of the gates from the track
const FLAT = 9, BLEND = 22; // terrain flattening around the road
const SIM_RANGE = 600;   // only simulate traffic near the train

const GLASS = 0x2d4258, TIRE = 0x222222, HUB = 0xbbbbbb, HEAD = 0xfff4b0, TAIL = 0xd02020, DARK = 0x333333;
const CAR_COLORS = [0xe63946, 0x2a9df4, 0xffd23f, 0x52b788, 0xf77f00, 0x9b5de5, 0xffffff, 0xff70a6];
const TRUCK_COLORS = [0xd62828, 0x1d70b8, 0x2a9d8f, 0xf4a261];
const CARGO_COLORS = [0xffffff, 0xf1f1f1, 0xffd166, 0x90be6d];
const BUS_COLORS = [0xf5b700, 0xf5b700, 0xd62828, 0x1d70b8];
const TYPES = {
  car: { len: 4.4, speed: [10, 14] },
  truck: { len: 7.8, speed: [8, 11] },
  bus: { len: 10.6, speed: [8, 10] },
};

function vehicleGeo(type, color, color2) {
  const parts = [];
  const B = (w, h, d, x, y, z, c) => parts.push(coloredGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c));
  const W = (r, x, z) => {
    parts.push(coloredGeo(new THREE.CylinderGeometry(r, r, 0.32, 14).rotateZ(Math.PI / 2).translate(x, r, z), TIRE));
    parts.push(coloredGeo(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.34, 10).rotateZ(Math.PI / 2).translate(x, r, z), HUB));
  };
  if (type === 'car') {
    B(1.9, 0.7, 4.4, 0, 0.72, 0, color);
    B(1.7, 0.62, 2.3, 0, 1.38, -0.25, GLASS);
    B(1.74, 0.1, 2.0, 0, 1.72, -0.3, color);
    B(1.96, 0.2, 0.16, 0, 0.45, 2.2, DARK); B(1.96, 0.2, 0.16, 0, 0.45, -2.2, DARK);
    for (const x of [-0.62, 0.62]) { B(0.42, 0.18, 0.06, x, 0.85, 2.21, HEAD); B(0.42, 0.16, 0.06, x, 0.85, -2.21, TAIL); }
    for (const x of [-0.86, 0.86]) for (const z of [-1.4, 1.4]) W(0.36, x, z);
  } else if (type === 'truck') {
    B(1.9, 0.35, 7.6, 0, 0.78, 0, DARK);
    B(2.3, 2.0, 2.1, 0, 1.95, 2.75, color);
    B(2.1, 0.75, 0.06, 0, 2.4, 3.81, GLASS);
    B(2.34, 0.6, 0.9, 0, 2.45, 3.0, GLASS);
    B(2.5, 2.7, 5.2, 0, 2.3, -1.2, color2);
    for (const x of [-0.7, 0.7]) B(0.4, 0.22, 0.06, x, 1.25, 3.81, HEAD);
    for (const x of [-1.0, 1.0]) for (const z of [2.75, -0.6, -2.6]) W(0.5, x, z);
  } else {
    B(2.5, 2.3, 10.6, 0, 1.75, 0, color);
    B(2.54, 0.85, 8.6, 0, 2.3, -0.5, GLASS);
    B(2.2, 1.1, 0.06, 0, 2.25, 5.31, GLASS);
    B(2.4, 0.15, 10.4, 0, 2.97, 0, 0xeeeeee);
    B(2.54, 0.14, 10.4, 0, 1.3, 0, DARK);
    B(2.56, 0.3, 10.66, 0, 0.75, 0, DARK);
    for (const x of [-0.85, 0.85]) { B(0.4, 0.22, 0.06, x, 1.0, 5.31, HEAD); B(0.4, 0.22, 0.06, x, 1.0, -5.31, TAIL); }
    for (const x of [-1.06, 1.06]) for (const z of [3.6, -3.4]) W(0.55, x, z);
  }
  return mergeGeometries(parts);
}

export class Roads {
  constructor(scene, net, stations, seed = 1) {
    this.scene = scene; this.net = net; this.stations = stations;
    this.terrain = null; // set by main once the terrain exists
    this.list = [];
    this.rand = mulberry32(seed);
    this.roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9 });
    this.skirtMat = new THREE.MeshStandardMaterial({ color: 0x6b6458, roughness: 1, side: THREE.DoubleSide });
    this.vehMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
    this.vehGeos = new Map();

    // crossing gate parts (shared)
    const S = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });
    this.m = {
      white: S(0xf4f4f4), black: S(0x1e1e22), red: S(0xd42020),
      off: S(0x4a1414), on: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
      arm: S(0xffffff, { map: stripeTexture() }),
    };
    this.g = {
      base: new THREE.BoxGeometry(0.7, 0.5, 0.7).translate(0, 0.25, 0),
      post: new THREE.CylinderGeometry(0.12, 0.12, 4.4, 10).translate(0, 2.2, 0),
      buckW: new THREE.BoxGeometry(2.3, 0.34, 0.05),
      buckR: new THREE.BoxGeometry(2.42, 0.46, 0.04),
      plate: new THREE.BoxGeometry(1.6, 0.6, 0.12),
      light: new THREE.CylinderGeometry(0.22, 0.22, 0.1, 16).rotateX(Math.PI / 2),
      hood: new THREE.CylinderGeometry(0.27, 0.27, 0.22, 16, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2),
      arm: new THREE.BoxGeometry(4.3, 0.2, 0.12).translate(-2.15, 0, 0),
      weight: new THREE.BoxGeometry(0.6, 0.4, 0.3).translate(0.4, 0, 0),
    };
    this.glowTex = glowTexture();
    this._v = new V3();
  }

  // ---------- creating / removing roads ----------
  maybeCreate(edge) {
    if (this.rand() > 0.55) return;
    const d = edge.length / 2;
    const p = edge.pointAt(d, new V3());
    if (mountainMask(p.x, p.z) > 0.35) return;
    const t = edge.tangentAt(d, new V3()); t.y = 0; t.normalize();
    const dir = rightOf(t);
    const sides = [-1, 1].map((s) => this.scanSide(p, dir, s));
    if (sides.some((sd) => sd.L < 60)) return;

    // profile from -L1 to +L2, smoothed, but keep the flat bit at the track untouched
    const [A, B] = sides;
    const prof = [...A.hs.slice(1).reverse(), ...B.hs];
    const L1 = A.L, L2 = B.L;
    for (let pass = 0; pass < 2; pass++) {
      const src = prof.slice();
      for (let i = 1; i < prof.length - 1; i++) {
        const v = -L1 + i * STEP;
        if (Math.abs(v) > 14) prof[i] = (src[i - 1] + 2 * src[i] + src[i + 1]) / 4;
      }
    }
    const ends = [p.clone().addScaledVector(dir, -L1), p.clone().addScaledVector(dir, L2)];
    const r = {
      edge, d, p, t, dir, L1, L2, prof, deckY: p.y + 0.26,
      minX: Math.min(ends[0].x, ends[1].x) - BLEND, maxX: Math.max(ends[0].x, ends[1].x) + BLEND,
      minZ: Math.min(ends[0].z, ends[1].z) - BLEND, maxZ: Math.max(ends[0].z, ends[1].z) + BLEND,
      objects: [], gates: [], vehicles: [], lanes: { 1: 0, '-1': 0 },
      active: false, activeTime: 0, arm: 0, flashT: 0, sim: false,
    };
    this.list.push(r);
    (edge.roads ??= []).push(r);
    this.buildRoad(r);
    this.markDirty(r);
  }

  // Walk outwards from the track to find how long the road can be on one side, and its height profile.
  scanSide(p, dir, s) {
    const hs = [];
    let prev = null, L = 0;
    for (let v = 0; v <= MAX_L; v += STEP) {
      const x = p.x + dir.x * v * s, z = p.z + dir.z * v * s;
      if (v >= 28) {
        if (this.net.nearest(x, z, BLEND + 2)) break;
        if ([...this.stations.list].some((st) => Math.hypot(x - st.trackPos.x, z - st.trackPos.z) < st.townR + 30)) break;
        if (this.distance(x, z, 30) < 30) break;
      }
      const raw = this.terrain.heightAt(x, z);
      if (raw < WATER_Y + 1) break;
      const h = prev === null ? raw : clamp(raw, prev - 0.9, prev + 0.9); // max ~22% grade
      if (Math.abs(h - raw) > 7) break;
      hs.push(h); prev = h; L = v;
    }
    return { L, hs };
  }

  // A new piece of track (or a new town) that runs into an existing road deletes that road.
  // New track is always generated far ahead of the train, so this happens out of sight.
  checkEdge(e) {
    const v = new V3();
    for (const r of [...this.list]) {
      if (r.edge === e) continue;
      let hit = false;
      if (e.station) {
        const st = e.station;
        hit = this.distTo(r, st.trackPos.x, st.trackPos.z) < st.townR + 30;
      }
      for (let d = 0; !hit && d <= e.length; d += 4) {
        e.pointAt(d, v);
        if (v.x > r.minX && v.x < r.maxX && v.z > r.minZ && v.z < r.maxZ && this.distTo(r, v.x, v.z) < BLEND + 2) hit = true;
      }
      if (hit) this.remove(r);
    }
  }

  removeForEdge(e) { for (const r of e.roads ?? []) this.remove(r); }

  remove(r) {
    const i = this.list.indexOf(r);
    if (i < 0) return;
    this.list.splice(i, 1);
    r.edge.roads = r.edge.roads.filter((x) => x !== r);
    for (const o of r.objects) {
      this.scene.remove(o);
      o.traverse((c) => { if (c.geometry?.userData.own) c.geometry.dispose(); if (c.isSprite) c.material.dispose(); });
    }
    for (const veh of r.vehicles) this.scene.remove(veh.mesh);
    this.markDirty(r);
  }

  markDirty(r) {
    if (!this.terrain) return;
    for (let v = -r.L1; v <= r.L2 + 29; v += 30) {
      const vv = Math.min(v, r.L2);
      this.terrain.markDirtyArea(r.p.x + r.dir.x * vv, r.p.z + r.dir.z * vv, BLEND + 30);
    }
  }

  // ---------- geometry queries (used by the terrain) ----------
  profAt(r, v) {
    const f = clamp((v + r.L1) / STEP, 0, r.prof.length - 1);
    const i = Math.min(Math.floor(f), r.prof.length - 2);
    return mix(r.prof[i], r.prof[i + 1], f - i);
  }

  surfaceY(r, v) { return Math.max(this.profAt(r, v) + 0.1, r.deckY - Math.max(0, Math.abs(v) - 4) * 0.15); }

  distTo(r, x, z) {
    const rx = x - r.p.x, rz = z - r.p.z;
    const v = rx * r.dir.x + rz * r.dir.z, u = rx * r.t.x + rz * r.t.z;
    return Math.hypot(u, v - clamp(v, -r.L1, r.L2));
  }

  distance(x, z, maxD = Infinity) {
    let best = maxD;
    for (const r of this.list) {
      if (x < r.minX - maxD || x > r.maxX + maxD || z < r.minZ - maxD || z > r.maxZ + maxD) continue;
      best = Math.min(best, this.distTo(r, x, z));
    }
    return best;
  }

  near(x, z, m) { return this.distance(x, z, m) < m; }

  // Flatten the ground under and beside each road to the road's profile.
  flatten(x, z, h) {
    for (const r of this.list) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const rx = x - r.p.x, rz = z - r.p.z;
      const v = rx * r.dir.x + rz * r.dir.z, u = rx * r.t.x + rz * r.t.z;
      const vc = clamp(v, -r.L1, r.L2);
      const d = Math.hypot(u, v - vc);
      if (d < BLEND) h = mix(this.profAt(r, vc) - 0.06, h, smooth(FLAT, BLEND, d));
    }
    return h;
  }

  // ---------- meshes ----------
  buildRoad(r) {
    const { p, t, dir } = r;
    const vs = [];
    for (let v = -r.L1; v < r.L2; v += 1) vs.push(v);
    vs.push(r.L2);
    const top = [], uv = [], idx = [], skirt = [], sIdx = [];
    vs.forEach((v, i) => {
      const cx = p.x + dir.x * v, cz = p.z + dir.z * v, y = this.surfaceY(r, v);
      top.push(cx - t.x * HALF_W, y, cz - t.z * HALF_W, cx + t.x * HALF_W, y, cz + t.z * HALF_W);
      uv.push(0, v / 8, 1, v / 8);
      for (const s of [-1, 1]) {
        const ex = cx + t.x * HALF_W * s, ez = cz + t.z * HALF_W * s;
        skirt.push(ex, y, ez, ex, y - 1.4, ez);
      }
      if (i < vs.length - 1) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
        for (const k of [0, 2]) {
          const s0 = i * 4 + k, s1 = s0 + 4;
          sIdx.push(s0, s0 + 1, s1, s0 + 1, s1 + 1, s1);
        }
      }
    });
    const mk = (pos, index, mat, uvs) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(index);
      g.computeVertexNormals();
      g.userData.own = true;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
      r.objects.push(m);
    };
    mk(top, idx, this.roadMat, uv);
    mk(skirt, sIdx, this.skirtMat);
    for (const s of [1, -1]) this.buildGate(r, s);
  }

  // Gate for traffic travelling in direction s along the road: on the driver's right, before the track.
  buildGate(r, s) {
    const a = r.dir.clone().multiplyScalar(s);
    const right = rightOf(a);
    const v = -s * GATE_V;
    const pos = r.p.clone().addScaledVector(r.dir, v).addScaledVector(right, HALF_W + 0.8);
    pos.y = this.profAt(r, v) - 0.06;
    const g = new THREE.Group();
    g.position.copy(pos);
    g.lookAt(pos.clone().sub(a)); // local +z faces oncoming cars, local +x points away from the road
    const { m, g: G } = this;
    const add = (geo, mat, x, y, z, parent = g) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(G.base, m.black, 0, 0, 0);
    add(G.post, m.white, 0, 0, 0);
    for (const rz of [0.75, -0.75]) {
      add(G.buckR, m.red, 0, 4.0, 0.12).rotation.z = rz;
      add(G.buckW, m.white, 0, 4.0, 0.15).rotation.z = rz;
    }
    add(G.plate, m.black, 0, 2.95, 0.1);
    const lights = [], glows = [];
    for (const x of [-0.48, 0.48]) {
      const pair = [add(G.light, m.off, x, 2.95, 0.21), add(G.light, m.off, x, 2.95, -0.01)];
      add(G.hood, m.black, x, 2.95, 0.3);
      lights.push(pair);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff3a20, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.set(x, 2.95, 0.4);
      glow.scale.setScalar(2.2);
      glow.visible = false;
      g.add(glow);
      glows.push(glow);
    }
    const pivot = new THREE.Group();
    pivot.position.set(-0.25, 1.15, 0.3);
    g.add(pivot);
    add(G.arm, m.arm, 0, 0, 0, pivot);
    add(G.weight, m.black, 0, 0, 0, pivot);
    this.scene.add(g);
    r.objects.push(g);
    r.gates.push({ pivot, lights, glows });
  }

  vehicleGeoFor(type) {
    const R = this.rand, pick = (arr) => arr[Math.floor(R() * arr.length)];
    const c = pick(type === 'car' ? CAR_COLORS : type === 'truck' ? TRUCK_COLORS : BUS_COLORS);
    const c2 = type === 'truck' ? pick(CARGO_COLORS) : 0;
    const key = `${type}:${c}:${c2}`;
    if (!this.vehGeos.has(key)) this.vehGeos.set(key, vehicleGeo(type, c, c2));
    return this.vehGeos.get(key);
  }

  spawn(r, lane, q) {
    const x = this.rand();
    const type = x < 0.64 ? 'car' : x < 0.83 ? 'truck' : 'bus';
    const T = TYPES[type];
    const mesh = new THREE.Mesh(this.vehicleGeoFor(type), this.vehMat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const max = T.speed[0] + this.rand() * (T.speed[1] - T.speed[0]);
    const veh = { type, mesh, lane, q, len: T.len, max, speed: max * 0.8, state: 'drive', t: 0, squash: 0 };
    r.vehicles.push(veh);
    return veh;
  }

  // Lane s: travelling in +s*dir. Progress q runs from qStart to qEnd, crossing at q = 0.
  laneRange(r, s) { return s > 0 ? [-r.L1, r.L2] : [-r.L2, r.L1]; }

  populate(r) {
    for (const s of [1, -1]) {
      const [q0, q1] = this.laneRange(r, s);
      for (let q = q0 + 12 + this.rand() * 20; q < q1 - 12; q += 30 + this.rand() * 40) {
        if (Math.abs(q) > 25) this.spawn(r, s, q);
      }
      r.lanes[s] = 1 + this.rand() * 4;
    }
    r.sim = true;
  }

  clearTraffic(r) {
    for (const veh of r.vehicles) this.scene.remove(veh.mesh);
    r.vehicles = [];
    r.sim = false;
  }

  activate(r) {
    if (r.active) return;
    r.active = true;
    r.activeTime = 0;
  }

  // ---------- per frame ----------
  // `ahead` is the set of roads still ahead of the train on its route.
  // Returns the distance from the loco to the nearest crossing with flashing lights (for the bell).
  update(dt, train, ahead, sfx) {
    const tc = train.cars.map((c) => {
      const pos = c.group.position;
      const fwd = c.group.getWorldDirection(new V3()); fwd.y = 0; fwd.normalize();
      return { pos, fwd, right: rightOf(fwd), half: c.length / 2 };
    });
    const loco = train.loco.group.position;
    let bellDist = Infinity;

    for (const r of [...this.list]) {
      const dLoco = Math.hypot(loco.x - r.p.x, loco.z - r.p.z);

      // is any train car sitting on the crossing right now?
      let occupied = false, near = false;
      for (const c of tc) {
        const rx = r.p.x - c.pos.x, rz = r.p.z - c.pos.z;
        const along = rx * c.fwd.x + rz * c.fwd.z, lat = rx * c.right.x + rz * c.right.z;
        if (Math.abs(along) < c.half + 2 && Math.abs(lat) < 6) occupied = true;
        if (Math.hypot(rx, rz) < c.half + 15) near = true;
      }

      // lights and arms
      if (r.active) {
        r.activeTime += dt;
        if (r.activeTime > 4 && !near && !ahead.has(r)) r.active = false;
      }
      const target = r.active && r.activeTime > 1 ? 1 : 0;
      r.arm = target > r.arm ? Math.min(1, r.arm + dt / 2.2) : Math.max(0, r.arm - dt / 2.2);
      const flashing = r.active || r.arm > 0;
      if (flashing) { r.flashT += dt; bellDist = Math.min(bellDist, dLoco); } else r.flashT = 0;
      const phase = Math.floor(r.flashT * 2.5) % 2;
      const down = smooth(0, 1, r.arm);
      for (const gate of r.gates) {
        gate.pivot.rotation.z = -Math.PI / 2 * 0.96 * (1 - down);
        gate.lights.forEach((pair, i) => {
          const on = flashing && i === phase;
          for (const l of pair) l.material = on ? this.m.on : this.m.off;
          gate.glows[i].visible = on;
        });
      }

      // traffic
      if (dLoco > SIM_RANGE) { if (r.sim) this.clearTraffic(r); continue; }
      if (!r.sim) this.populate(r);
      this.updateTraffic(r, dt, tc, train.speed, occupied, sfx);
    }
    return bellDist;
  }

  updateTraffic(r, dt, tc, trainSpeed, occupied, sfx) {
    for (const s of [1, -1]) {
      const [q0, q1] = this.laneRange(r, s);
      const lane = r.vehicles.filter((v) => v.lane === s).sort((a, b) => b.q - a.q); // front first
      // spawn at the start of the lane
      r.lanes[s] -= dt;
      const last = lane[lane.length - 1];
      if (r.lanes[s] <= 0 && (!last || last.q - last.len / 2 > q0 + 16)) {
        const veh = this.spawn(r, s, q0);
        veh.q = q0 + veh.len / 2;
        lane.push(veh);
        r.lanes[s] = 2.5 + this.rand() * 6;
      }
      let leader = null;
      for (const veh of lane) {
        const front = veh.q + veh.len / 2;
        if (veh.state === 'drive') {
          let limit = Infinity;
          if (leader) limit = leader.q - leader.len / 2 - front - 3;
          if (r.active && front <= STOP_LINE + 0.3) limit = Math.min(limit, STOP_LINE - front);
          else if (occupied && front <= -3.2 + 0.3) limit = Math.min(limit, -3.2 - front); // don't drive into a stopped train
          const want = Math.min(veh.max, Math.sqrt(2 * 5 * Math.max(0, limit)));
          veh.speed = veh.speed < want ? Math.min(want, veh.speed + 3 * dt) : want;
          veh.q += veh.speed * dt;
          if (Math.abs(veh.q) < veh.len / 2 + 4 && trainSpeed > 0.3 && this.hitByTrain(r, veh, tc)) {
            veh.state = 'squashed'; veh.t = 0; veh.speed = 0;
            sfx('squish');
          }
        } else {
          veh.t += dt;
          if (veh.state === 'squashed' && veh.t > 1.2 && !occupied && !this.hitByTrain(r, veh, tc, 3)) {
            veh.state = 'popping'; veh.t = 0; sfx('boing');
          } else if (veh.state === 'popping' && veh.t > 0.6) {
            veh.state = 'drive'; sfx('beep');
          }
        }
        leader = veh;
        this.place(r, veh, q0, q1);
      }
      // drop vehicles that reached the end of the road
      for (const veh of lane) {
        if (veh.q > q1 - veh.len / 2) {
          this.scene.remove(veh.mesh);
          r.vehicles.splice(r.vehicles.indexOf(veh), 1);
        }
      }
    }
  }

  hitByTrain(r, veh, tc, pad = 0) {
    const p = this.vehPos(r, veh, this._v);
    const vdx = r.dir.x * veh.lane, vdz = r.dir.z * veh.lane;
    for (const c of tc) {
      const rx = p.x - c.pos.x, rz = p.z - c.pos.z;
      const along = rx * c.fwd.x + rz * c.fwd.z, lat = rx * c.right.x + rz * c.right.z;
      // vehicle footprint projected onto the train car's axes
      const ext = (ax, az) => Math.abs(vdx * ax + vdz * az) * veh.len / 2 + Math.abs(vdz * ax - vdx * az) * 1.0;
      if (Math.abs(along) < c.half + ext(c.fwd.x, c.fwd.z) + pad && Math.abs(lat) < 1.5 + ext(c.right.x, c.right.z) + pad) return true;
    }
    return false;
  }

  vehPos(r, veh, out) {
    const v = veh.lane * veh.q, off = -veh.lane * LANE;
    return out.set(r.p.x + r.dir.x * v + r.t.x * off, this.surfaceY(r, v), r.p.z + r.dir.z * v + r.t.z * off);
  }

  place(r, veh, q0, q1) {
    const m = veh.mesh;
    this.vehPos(r, veh, m.position);
    m.lookAt(m.position.x + r.dir.x * veh.lane, m.position.y, m.position.z + r.dir.z * veh.lane);
    const grow = clamp(Math.min(veh.q - q0, q1 - veh.q) / 8, 0.05, 1); // appear / vanish at the road ends
    let sy = 1, sx = 1;
    if (veh.state === 'squashed') { const k = smooth(0, 0.12, veh.t); sy = mix(1, 0.14, k); sx = mix(1, 1.45, k); }
    else if (veh.state === 'popping') {
      const k = veh.t / 0.6;
      sy = 0.14 + 0.86 * (1 - Math.cos(k * Math.PI * 2.5) * Math.exp(-4 * k)) ; // springy bounce
      sy = k >= 1 ? 1 : sy;
      sx = mix(1.45, 1, Math.min(1, k * 2));
    }
    m.scale.set(sx * grow, sy * grow, (sx > 1 ? 1.1 : 1) * grow);
  }
}

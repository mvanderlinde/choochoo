import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smooth, mix } from './heights.js';
import { makeLoco, makeTender, makeCoach, makeWagon } from './models.js';
import { RAIL_TOP } from './tracks.js';
import { gravelTexture, glowTexture, stoneTexture } from './textures.js';
import { nightGlow } from './daynight.js';

// Train depots: every so often a big yard opens up beside the line, full of sidings, parked
// trains, an engine shed, a water tower, a coal stage and a turntable that slowly spins an
// engine round, while a little shunting engine potters up and down.
//
// Layout is in yard coordinates: u along the main line (0 = middle of the edge), v sideways
// away from it (0 = main line). The static parts are merged into one mesh per material.

const V3 = THREE.Vector3;
const U = 120, W = 62;                 // yard half-length and width
const TRACKS = 6, V0 = 9, GAP = 5;     // sidings at v = 9, 14, ... 34
const LEAD_U = -112, LEAD_END = -22;   // the diagonal lead track from the main line
const SHED_U = [42, 96];               // engine shed, over the last three sidings
const BUFFER_U = 78;
const vOf = (i) => V0 + i * GAP;
const vLast = vOf(TRACKS - 1);
const leadU = (v) => LEAD_U + (v / vLast) * (LEAD_END - LEAD_U);

let M = null;
function mats() {
  if (M) return M;
  const S = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
  const gravel = gravelTexture();
  const stone = stoneTexture(); stone.repeat.set(0.3, 0.3);
  M = {
    ballast: S(0xffffff, { map: gravel, roughness: 1 }),
    rail: S(0x9aa0aa, { metalness: 0.8, roughness: 0.35 }),
    sleeper: S(0x6b4a2f, { roughness: 0.9 }),
    brick: S(0xa8553f), brickDark: S(0x7c3b2c), roof: S(0x4c5560), stone: S(0xffffff, { map: stone }),
    white: S(0xf2f2f2), red: S(0xd23c3c), black: S(0x2a2a2e), wood: S(0x8a5a32), cream: S(0xf3e2c0),
    green: S(0x2f7a4a), tank: S(0x2c5d8f), coal: S(0x1d1d20, { roughness: 1 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x0d0d10, side: THREE.BackSide }),
    pit: S(0x55504a),
    glass: nightGlow(S(0x6f9cc8, { emissive: 0xffd28a, roughness: 0.3 }), 'emissiveIntensity', 1.2),
    lamp: nightGlow(S(0xfff6d0, { emissive: 0xffd58a }), 'emissiveIntensity', 3),
    halo: nightGlow(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd99a, transparent: true, depthWrite: false }), 'opacity', 0.85),
  };
  return M;
}

const contMats = new Map();
function contMat(color) {
  if (!contMats.has(color)) contMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  return contMats.get(color);
}

// Merge every mesh under `root` into one mesh per material (sprites and lights are kept as they are).
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map(), keep = [];
  const push = (mat, geo) => { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(geo); };
  root.traverse((o) => {
    if (o.isSprite) { keep.push(o); return; }
    if (!o.isMesh) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (Array.isArray(o.material)) {
      for (const grp of g.groups) {
        const part = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv']) {
          const a = g.attributes[k];
          part.setAttribute(k, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
        }
        push(o.material[grp.materialIndex], part);
      }
    } else { g.clearGroups(); push(o.material, g); }
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = mat !== M.dark && mat !== M.ballast; m.receiveShadow = true;
    out.add(m);
  }
  for (const s of keep) { s.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, s.parent.matrixWorld)); out.add(s); }
  return out;
}

function box(parent, mat, w, h, d, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  parent.add(m);
  return m;
}
function cyl(parent, mat, rt, rb, h, x, y, z, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

class Depot {
  constructor(scene, edge, side, seed) {
    this.scene = scene; this.edge = edge; this.side = side;
    const r = this.rand = mulberry32(seed);
    const d = edge.length / 2;
    this.p = edge.pointAt(d, new V3());
    this.t = edge.tangentAt(d, new V3()); this.t.y = 0; this.t.normalize();
    this.lat = new V3(this.t.z, 0, -this.t.x).multiplyScalar(side); // world direction of +v
    this.bed = this.p.y - 0.55;

    // yard frame: local z = u, local x = v * side (group +x is the left of the track direction)
    this.group = new THREE.Group();
    this.group.position.copy(this.p);
    this.group.lookAt(this.p.clone().add(this.t));
    const S = new THREE.Group(); // static parts, baked below
    const m = mats();

    // sidings and the lead track that feeds them
    this.track(S, 0, LEAD_U, vLast, LEAD_END);
    for (let i = 0; i < TRACKS; i++) {
      const v = vOf(i), inShed = i >= TRACKS - 3;
      const end = inShed ? SHED_U[1] - 2 : BUFFER_U;
      this.track(S, v, leadU(v) + 3, v, end);
      if (!inShed) this.bufferStop(S, v, end);
    }
    // turntable spur
    const tt = { u: -58, v: vLast + 17, r: 8.5 };
    this.track(S, tt.v, tt.u + tt.r, tt.v, -14);
    this.bufferStop(S, tt.v, -14);

    this.shed(S, r);
    this.waterTower(S, -8, vLast + 9);
    this.coalStage(S, 22, vLast + 9);
    this.signalBox(S, LEAD_U + 6, 5.8);
    this.containers(S, r, -92, 44);
    this.crates(S, r, -78, 30);
    this.hut(S, -104, 52);
    for (const [u, v] of [[-60, vOf(1) + 2.5], [0, vOf(1) + 2.5], [55, vOf(1) + 2.5], [-25, vLast + 6], [-90, vOf(4) - 2.5], [60, vLast + 9]]) this.lampPost(S, u, v);

    // parked trains
    const coachColors = [0x2f7fd8, 0xf2b632, 0x3fae5a, 0xd8342c, 0x8e5bd6, 0xe9e2d0];
    const locoColors = [0x2f6fd8, 0x2a9d5a, 0x2d2d33, 0xf2b632, 0x8e2c8e, 0xd8342c];
    const wagonKinds = ['box', 'tank', 'coal', 'logs', 'container'];
    const wagonColors = [0x9c4a2e, 0x3d6d8f, 0xd88a2f, 0x5c7d3a, 0xc23b3b, 0x777f88];
    const pick = (a) => a[Math.floor(r() * a.length)];
    // track 0: a passenger train ready to go
    this.consist(S, 0, BUFFER_U - 6, [makeLoco(pick(locoColors), true), makeTender(), ...Array.from({ length: 2 + Math.floor(r() * 2) }, () => makeCoach(pick(coachColors)))]);
    // track 1: a long freight train
    this.consist(S, 1, BUFFER_U - 3, Array.from({ length: 6 + Math.floor(r() * 3) }, () => makeWagon(pick(wagonKinds), pick(wagonColors))));
    // track 2: the shunter's track; a couple of wagons parked at the end
    this.consist(S, 2, BUFFER_U - 3, Array.from({ length: 2 }, () => makeWagon(pick(wagonKinds), pick(wagonColors))));
    // shed tracks: engines peeking out of the doors, and one outside having a rest
    for (let i = TRACKS - 3; i < TRACKS; i++) {
      const loco = makeLoco(pick(locoColors), true), tender = makeTender();
      if (r() < 0.7) this.consist(S, i, SHED_U[0] - 1 - r() * 5, [loco, tender], true); // peeking out
      else this.consist(S, i, SHED_U[0] - 30, [loco, tender], true);                // outside for a rest
    }
    this.statics = bake(S);
    this.group.add(this.statics);

    // turntable (spins slowly with an engine on it)
    const pit = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(tt.r + 0.6, tt.r + 0.6, 0.5, 40, 1, true), m.stone);
    ring.position.y = -0.3; pit.add(ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(tt.r + 0.6, 40).rotateX(-Math.PI / 2), m.pit);
    floor.position.y = -0.5; pit.add(floor);
    const deck = new THREE.Group();
    box(deck, m.black, 3.2, 0.5, tt.r * 2, 0, -0.25, 0);
    for (const x of [-0.75, 0.75]) box(deck, m.rail, 0.14, 0.18, tt.r * 2, x, 0.2, 0);
    const ttLoco = makeLoco(pick(locoColors), true);
    ttLoco.group.position.set(0, RAIL_TOP - 0.05, -0.5);
    deck.add(ttLoco.group);
    this.ttDeck = bake(deck);
    this.ttGroup = new THREE.Group();
    this.ttGroup.add(bake(pit), this.ttDeck);
    this.ttGroup.position.set(this.x(tt.v), 0, tt.u);
    this.group.add(this.ttGroup);
    this.ttAngle = 0; this.ttPause = 3;

    // the shunting engine
    this.shunter = { loco: makeLoco(pick(locoColors), true), tender: makeTender(), t: r() * 10 };
    this.shunterGroup = new THREE.Group();
    this.shunterGroup.add(this.shunter.loco.group, this.shunter.tender.group);
    this.shunter.tender.group.position.z = -(11 / 2 + 0.6 + 6.4 / 2);
    this.shunterGroup.position.set(this.x(vOf(2)), RAIL_TOP, 0);
    this.group.add(this.shunterGroup);

    this.scene.add(this.group);
  }

  x(v) { return v * this.side; }

  // straight piece of track from (v1, u1) to (v2, u2)
  track(parent, v1, u1, v2, u2) {
    const m = mats();
    const g = new THREE.Group();
    const dx = this.x(v2) - this.x(v1), dz = u2 - u1, len = Math.hypot(dx, dz);
    g.position.set((this.x(v1) + this.x(v2)) / 2, 0, (u1 + u2) / 2);
    g.rotation.y = Math.atan2(dx, dz);
    const ballast = box(g, m.ballast, 3.6, 0.6, len, 0, -0.27, 0);
    ballast.geometry.attributes.uv.array.forEach((_, i, a) => { if (i % 2) a[i] *= len / 8; });
    for (const x of [-0.75, 0.75]) box(g, m.rail, 0.14, 0.18, len, x, 0.21, 0);
    for (let z = -len / 2 + 0.4; z < len / 2; z += 0.75) box(g, m.sleeper, 2.5, 0.16, 0.28, 0, 0.1, z);
    parent.add(g);
  }

  bufferStop(parent, v, u) {
    const m = mats();
    const g = new THREE.Group();
    g.position.set(this.x(v), 0, u + 0.6);
    for (const x of [-0.8, 0.8]) box(g, m.black, 0.25, 1.4, 0.25, x, 0.7, 0);
    box(g, m.red, 2.6, 0.5, 0.35, 0, 1.25, -0.1);
    for (const x of [-0.6, 0.6]) box(g, m.white, 0.4, 0.52, 0.37, x, 1.25, -0.1);
    box(g, m.stone, 3, 1.1, 1.6, 0, 0.55, 1.1);
    parent.add(g);
  }

  // Line up rolling stock on siding i. Normally they face +u with the first one's front at u = front;
  // flip: facing -u (engines coming out of the shed), first one's front at u = front, the rest behind it.
  consist(parent, i, front, cars, flip = false) {
    let u = front;
    for (const c of cars) {
      c.group.position.set(this.x(vOf(i)), RAIL_TOP, flip ? u + c.length / 2 : u - c.length / 2);
      if (flip) c.group.rotation.y = Math.PI;
      parent.add(c.group);
      u += flip ? c.length + 0.6 : -(c.length + 0.6);
    }
  }

  shed(parent, r) {
    const m = mats();
    const g = new THREE.Group();
    const v = vOf(TRACKS - 2), w = 3 * GAP + 4, len = SHED_U[1] - SHED_U[0], h = 8;
    g.position.set(this.x(v), -0.55, (SHED_U[0] + SHED_U[1]) / 2);
    // front wall with three arched doors
    const wall = new THREE.Shape();
    wall.moveTo(-w / 2, 0); wall.lineTo(w / 2, 0); wall.lineTo(w / 2, h); wall.lineTo(-w / 2, h); wall.lineTo(-w / 2, 0);
    for (let k = -1; k <= 1; k++) {
      const x = k * GAP * this.side, hole = new THREE.Path();
      hole.moveTo(x - 2, 0.01); hole.lineTo(x - 2, 4.6); hole.absarc(x, 4.6, 2, Math.PI, 0, true); hole.lineTo(x + 2, 0.01); hole.lineTo(x - 2, 0.01);
      wall.holes.push(hole);
    }
    const front = new THREE.Mesh(new THREE.ExtrudeGeometry(wall, { depth: 0.6, bevelEnabled: false }), m.brick);
    front.position.z = -len / 2;
    g.add(front);
    box(g, m.brick, w, h, 0.6, 0, h / 2, len / 2);              // back wall
    for (const s of [-1, 1]) {
      box(g, m.brick, 0.6, h, len, s * w / 2, h / 2, 0);         // side walls
      for (let z = -len / 2 + 6; z < len / 2 - 3; z += 7) box(g, m.glass, 0.2, 2.2, 3.2, s * (w / 2 + 0.25), 4.6, z);
    }
    box(g, m.brickDark, w + 0.6, 0.5, 0.8, 0, h + 0.25, -len / 2 + 0.3); // trim
    // pitched roof with smoke vents
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2 - 0.8, 0); tri.lineTo(w / 2 + 0.8, 0); tri.lineTo(0, 4.2); tri.lineTo(-w / 2 - 0.8, 0);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: len + 1.5, bevelEnabled: false }), m.roof);
    roof.position.set(0, h, -len / 2 - 0.75);
    g.add(roof);
    for (let z = -len / 2 + 8; z < len / 2 - 4; z += 12) { box(g, m.black, 1.2, 1.8, 1.2, -GAP * 0.9, h + 2.6, z); box(g, m.black, 1.2, 1.8, 1.2, GAP * 0.9, h + 2.6, z + 6); }
    // darkness inside (seen through the doors)
    box(g, m.dark, w - 1, h - 0.3, len - 1, 0, h / 2, 0.2);
    parent.add(g);
  }

  waterTower(parent, u, v) {
    const m = mats();
    const g = new THREE.Group();
    g.position.set(this.x(v), -0.55, u);
    for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) cyl(g, m.wood, 0.22, 0.28, 7, x, 3.5, z, 8);
    cyl(g, m.tank, 2.8, 2.8, 3.4, 0, 8.7, 0, 24);
    for (const y of [7.4, 10.0]) cyl(g, m.black, 2.86, 2.86, 0.18, 0, y, 0, 24);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.6, 24), m.roof); cone.position.y = 11.2; g.add(cone);
    // spout swinging out over the nearest siding
    const spout = cyl(g, m.black, 0.25, 0.25, 4.5, -this.side * 2.6, 7.8, 0, 10);
    spout.rotation.z = this.side * Math.PI / 2.4;
    parent.add(g);
  }

  coalStage(parent, u, v) {
    const m = mats();
    const g = new THREE.Group();
    g.position.set(this.x(v), -0.55, u);
    box(g, m.stone, 6, 2.6, 12, 0, 1.3, 0);
    box(g, m.wood, 6.4, 0.25, 12.4, 0, 2.7, 0);
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.5), m.coal);
      c.position.set((Math.random() - 0.5) * 4.4, 3.1 + Math.random() * 0.6, (Math.random() - 0.5) * 10);
      g.add(c);
    }
    parent.add(g);
  }

  signalBox(parent, u, v) {
    const m = mats();
    const g = new THREE.Group();
    g.position.set(this.x(v) + this.side * 2.5, -0.55, u);
    box(g, m.brick, 4, 3, 7, 0, 1.5, 0);
    box(g, m.cream, 4.2, 2.6, 7.2, 0, 4.3, 0);
    for (const s of [-1, 1]) box(g, m.glass, 0.1, 1.6, 6.2, s * 2.12, 4.4, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4), m.green);
    roof.scale.set(5.6, 1.8, 8.4); roof.position.y = 6.5;
    g.add(roof);
    parent.add(g);
  }

  // a stack of shipping containers waiting to go on a train
  containers(parent, r, u, v) {
    const cols = [0xd23c3c, 0x2c6db0, 0xe3a21a, 0x2f8f5a, 0xe9e2d0, 0x8e5bd6];
    for (let row = 0; row < 3; row++) for (let k = 0; k < 3 - (row === 2 ? 1 : 0); k++) {
      if (row > 0 && r() < 0.3) continue;
      box(parent, contMat(cols[Math.floor(r() * cols.length)]), 2.5, 2.6, 6.1, this.x(v + k * 2.8), 0.75 + row * 2.62, u);
    }
  }

  crates(parent, r, u, v) {
    const m = mats();
    for (let i = 0; i < 9; i++) {
      const s = 0.9 + r() * 0.5;
      box(parent, m.wood, s, s, s, this.x(v + (r() - 0.5) * 6), -0.55 + s / 2, u + (r() - 0.5) * 8, r());
    }
    for (let i = 0; i < 4; i++) box(parent, m.wood, 1.2, 1.2, 1.2, this.x(v + 1 + i * 0.3), 0.65, u + 4 + i * 0.1, r() * 0.3); // a second layer
  }

  hut(parent, u, v) {
    const m = mats();
    const g = new THREE.Group();
    g.position.set(this.x(v), -0.55, u);
    box(g, m.cream, 6, 3.2, 8, 0, 1.6, 0);
    box(g, m.brickDark, 0.1, 2.2, 1.1, -this.side * 3.02, 1.1, 1.5); // door
    box(g, m.glass, 0.1, 1.1, 1.5, -this.side * 3.02, 2.0, -2); // window
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4), m.red);
    roof.scale.set(7.2, 2.2, 9.2); roof.position.y = 4.3;
    g.add(roof);
    cyl(g, m.black, 0.25, 0.25, 1.6, 1.5, 5, 2.5, 8); // chimney
    parent.add(g);
  }

  lampPost(parent, u, v) {
    const m = mats();
    cyl(parent, m.black, 0.1, 0.14, 6.6, this.x(v), 2.75, u, 8);
    box(parent, m.lamp, 0.8, 0.3, 0.8, this.x(v), 6.1, u);
    const h = new THREE.Sprite(m.halo);
    h.position.set(this.x(v), 5.9, u); h.scale.setScalar(3.4);
    parent.add(h);
  }

  // world position -> yard coordinates
  local(x, z) {
    const dx = x - this.p.x, dz = z - this.p.z;
    return { u: dx * this.t.x + dz * this.t.z, v: dx * this.lat.x + dz * this.lat.z };
  }

  // how far outside the yard rectangle (0 inside); the strip by the main line counts as inside
  outside(x, z) {
    const { u, v } = this.local(x, z);
    const du = Math.max(0, Math.abs(u) - U), dv = Math.max(0, v - W, 3 - v);
    return Math.hypot(du, dv);
  }

  update(dt) {
    // turntable: turn half way round, pause, repeat
    if (this.ttPause > 0) this.ttPause -= dt;
    else {
      this.ttAngle += dt * 0.35; this.ttTurned = (this.ttTurned ?? 0) + dt * 0.35;
      if (this.ttTurned >= Math.PI) { this.ttTurned = 0; this.ttPause = 4; }
      this.ttDeck.rotation.y = this.ttAngle;
    }
    // shunter: trundle up and down the siding, pausing at each end
    const sh = this.shunter;
    sh.t += dt;
    const cycle = 26, k = (sh.t % cycle) / cycle;
    const pos = k < 0.4 ? smooth(0, 0.4, k) : k < 0.5 ? 1 : k < 0.9 ? 1 - smooth(0.5, 0.9, k) : 0;
    const prevZ = this.shunterGroup.position.z;
    this.shunterGroup.position.z = mix(leadU(vOf(2)) + 22, BUFFER_U - 30, pos);
    const ds = this.shunterGroup.position.z - prevZ;
    for (const c of [sh.loco, sh.tender]) for (const w of c.wheels) w.mesh.rotation.x += ds / w.r;
  }

  dispose() {
    this.scene.remove(this.group);
    for (const o of [this.statics, this.ttGroup]) o.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
  }
}

export class DepotManager {
  constructor(scene, net) { this.scene = scene; this.net = net; this.list = new Set(); this.count = 0; }

  // Build a depot beside a depot edge, on whichever side is clear of other track.
  create(edge) {
    const d = edge.length / 2, p = edge.pointAt(d, new V3()), t = edge.tangentAt(d, new V3()); t.y = 0; t.normalize();
    for (const side of this.count % 2 ? [1, -1] : [-1, 1]) {
      const lat = new V3(t.z, 0, -t.x).multiplyScalar(side);
      let clear = true;
      for (let u = -U - 20; clear && u <= U + 20; u += 12) for (let v = 14; clear && v <= W + 20; v += 12) {
        const x = p.x + t.x * u + lat.x * v, z = p.z + t.z * u + lat.z * v;
        if (this.net.nearest(x, z, 10)) clear = false;
      }
      if (!clear) continue;
      const dp = new Depot(this.scene, edge, side, 5000 + this.count++ * 7919);
      edge.depot = dp;
      this.list.add(dp);
      return dp;
    }
    return null;
  }

  remove(dp) { dp.dispose(); this.list.delete(dp); dp.edge.depot = null; }

  // New track that runs through a depot's yard removes the depot (happens far ahead, out of sight).
  checkEdge(e) {
    const v = new V3();
    for (const dp of [...this.list]) {
      if (dp.edge === e) continue;
      for (let d = 0; d <= e.length; d += 6) {
        e.pointAt(d, v);
        if (dp.outside(v.x, v.z) < 8) { this.remove(dp); return dp; }
      }
    }
    return null;
  }

  // Flatten the ground for the yard.
  flatten(x, z, h) {
    for (const dp of this.list) {
      const o = dp.outside(x, z);
      if (o < 40) h = mix(dp.bed, h, smooth(0, 40, o));
    }
    return h;
  }

  outside(x, z) { let o = Infinity; for (const dp of this.list) o = Math.min(o, dp.outside(x, z)); return o; }

  near(x, z, pad) { for (const dp of this.list) if (dp.outside(x, z) < pad) return dp; return null; }

  update(dt, pos) { for (const dp of this.list) if (dp.p.distanceTo(pos) < 700) dp.update(dt); }
}

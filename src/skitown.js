import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { naturalHeight } from './heights.js';
import { coloredGeo } from './flora.js';
import { nightGlow } from './daynight.js';

// Stations in the mountains are ski villages: chalets (built by the terrain tiles), a chairlift up
// the mountainside with people riding it, and skiers zig-zagging down the slope beside it.

const V3 = THREE.Vector3;
const LIFT_FROM = 95, LIFT_TO = 340; // metres from the station, along the uphill direction
const RUN_OFFSET = 34;               // the ski run is beside the lift
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const JACKETS = [0xe63946, 0x2a9df4, 0xffd23f, 0x52b788, 0xf77f00, 0x9b5de5, 0xff70a6];

// Which way is uphill from the station (and not along the line)? Returns null on gentle ground.
export function planLift(st) {
  let best = null;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, dir = new V3(Math.cos(a), 0, Math.sin(a));
    if (Math.abs(dir.dot(st.t)) > 0.55) continue; // not along the track
    const p = st.trackPos.clone().addScaledVector(dir, (LIFT_FROM + LIFT_TO) / 2);
    const h = naturalHeight(p.x, p.z);
    if (!best || h > best.h) best = { dir, h };
  }
  const base = st.trackPos.clone().addScaledVector(best.dir, LIFT_FROM);
  const top = st.trackPos.clone().addScaledVector(best.dir, LIFT_TO);
  if (naturalHeight(top.x, top.z) - st.townY < 18) return null; // not much of a hill
  const side = new V3(-best.dir.z, 0, best.dir.x);
  return { dir: best.dir, side, base, top, runBase: base.clone().addScaledVector(side, RUN_OFFSET), runTop: top.clone().addScaledVector(side, RUN_OFFSET) };
}

// Distance from (x, z) to the lift line and ski run (for keeping trees and houses off them).
export function liftDistance(lift, x, z) {
  const seg = (a, b) => {
    const abx = b.x - a.x, abz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)));
    return Math.hypot(x - a.x - abx * t, z - a.z - abz * t);
  };
  return Math.min(seg(lift.base, lift.top), seg(lift.runBase, lift.runTop));
}

let M = null;
function mats() {
  if (M) return M;
  M = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.5 }),
    glass: nightGlow(new THREE.MeshStandardMaterial({ color: 0x9fc3e6, emissive: 0xffc86a, roughness: 0.3 }), 'emissiveIntensity', 1.4),
  };
  return M;
}
const box = (w, h, d, x, y, z, c) => coloredGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (r1, r2, h, x, y, z, c, seg = 8) => coloredGeo(new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z), c);
const ball = (r, x, y, z, c) => coloredGeo(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), c);

function chair(rider, jacket, skin) {
  const parts = [cyl(0.05, 0.05, 2.0, 0, -1.0, 0, 0x333333, 5), box(1.4, 0.12, 0.6, 0, -2.0, 0.1, 0x2a5d9e), box(1.4, 0.6, 0.1, 0, -1.7, -0.2, 0x2a5d9e)];
  if (rider) parts.push(box(0.5, 0.7, 0.4, 0, -1.55, 0.05, jacket), ball(0.2, 0, -1.0, 0.05, skin), ball(0.14, 0, -0.82, 0.05, jacket), box(0.4, 0.15, 0.6, 0, -1.95, 0.4, 0x264653));
  return mergeGeometries(parts);
}

function skier(jacket, skin, hat) {
  const parts = [
    box(0.12, 0.05, 1.7, -0.16, 0.03, 0.1, 0xd62828), box(0.12, 0.05, 1.7, 0.16, 0.03, 0.1, 0xd62828), // skis
    box(0.16, 0.75, 0.18, -0.13, 0.45, 0, 0x264653), box(0.16, 0.75, 0.18, 0.13, 0.45, 0, 0x264653),   // legs
    coloredGeo(new THREE.CapsuleGeometry(0.25, 0.4, 4, 8).translate(0, 1.15, 0.05), jacket),
    ball(0.2, 0, 1.7, 0.08, skin), ball(0.15, 0, 1.88, 0.05, hat), ball(0.07, 0, 2.05, 0.05, 0xffffff), // head, hat, bobble
    coloredGeo(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4).rotateX(0.5).translate(-0.35, 0.7, 0.2), 0x888888),
    coloredGeo(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 4).rotateX(0.5).translate(0.35, 0.7, 0.2), 0x888888),
  ];
  return mergeGeometries(parts);
}

function liftHut(parts, at, dir, y, roofColor) {
  // a little station hut at each end of the lift
  const g = new THREE.BoxGeometry(5, 3.2, 4).translate(0, 1.6, 0);
  const r = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4).scale(6.4, 2.2, 5.4).translate(0, 4.3, 0);
  const yaw = Math.atan2(dir.x, dir.z);
  parts.push(coloredGeo(g.rotateY(yaw).translate(at.x, y, at.z), 0x8b5a2b), coloredGeo(r.rotateY(yaw).translate(at.x, y, at.z), roofColor));
}

export function buildSkiArea(st, terrain, rand) {
  const lift = st.lift, m = mats();
  const group = new THREE.Group();
  const H = (p) => terrain.heightAt(p.x, p.z);

  // pylons along the line, the cable running over their tops
  const N = 7, tops = [], parts = [];
  for (let i = 0; i <= N; i++) {
    const p = lift.base.clone().lerp(lift.top, i / N), g = H(p), h = i === 0 || i === N ? 6 : 10;
    tops.push(new V3(p.x, g + h, p.z));
    if (i > 0 && i < N) {
      const yaw = Math.atan2(lift.dir.x, lift.dir.z);
      parts.push(coloredGeo(new THREE.CylinderGeometry(0.25, 0.35, h, 8).translate(0, h / 2, 0).translate(p.x, g, p.z), 0x5d6470));
      parts.push(coloredGeo(new THREE.BoxGeometry(3.4, 0.25, 0.3).rotateY(yaw).translate(p.x, g + h, p.z), 0x5d6470));
    }
  }
  liftHut(parts, lift.base, lift.dir, H(lift.base), 0xf4f7fb);
  liftHut(parts, lift.top, lift.dir, H(lift.top), 0xf4f7fb);
  const statics = new THREE.Mesh(mergeGeometries(parts), m.body);
  statics.castShadow = statics.receiveShadow = true;
  group.add(statics);
  // cables (one going up, one coming down)
  const cables = [];
  for (const off of [-1.4, 1.4]) for (let i = 0; i < N; i++) {
    const a = tops[i].clone().addScaledVector(lift.side, off), b = tops[i + 1].clone().addScaledVector(lift.side, off);
    const len = a.distanceTo(b), c = new THREE.CylinderGeometry(0.05, 0.05, len, 4).rotateX(Math.PI / 2);
    const o = new THREE.Object3D(); o.position.copy(a).lerp(b, 0.5); o.lookAt(b); o.updateMatrix();
    cables.push(c.applyMatrix4(o.matrix));
  }
  group.add(new THREE.Mesh(mergeGeometries(cables), m.cable));

  // chairs going round the loop
  const lens = [];
  let total = 0;
  for (let i = 0; i < N; i++) { const l = tops[i].distanceTo(tops[i + 1]); lens.push(l); total += l; }
  const chairs = [];
  const geos = [chair(false, 0, 0), ...JACKETS.slice(0, 4).map((j, i) => chair(true, j, SKIN[i % SKIN.length]))];
  const NCH = 16;
  for (let i = 0; i < NCH; i++) {
    const mesh = new THREE.Mesh(geos[rand() < 0.75 ? 1 + Math.floor(rand() * 4) : 0], m.body);
    mesh.castShadow = true;
    group.add(mesh);
    chairs.push({ mesh, s: (i / NCH) * 2 * total });
  }
  const along = (d, off, out) => { // point on the cable d metres from the bottom
    let i = 0;
    while (i < N - 1 && d > lens[i]) { d -= lens[i]; i++; }
    return out.copy(tops[i]).lerp(tops[i + 1], Math.min(1, d / lens[i])).addScaledVector(lift.side, off);
  };

  // skiers coming down the run beside the lift
  const skiers = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(skier(JACKETS[(i + 2) % JACKETS.length], SKIN[i % SKIN.length], JACKETS[(i + 5) % JACKETS.length]), m.body);
    mesh.castShadow = true;
    group.add(mesh);
    skiers.push({ mesh, k: i / 6, speed: 0.028 + rand() * 0.015, wiggle: 5 + rand() * 4, ph: rand() * 6, lane: (rand() - 0.5) * 14 });
  }

  const p = new V3(), q = new V3();
  return {
    group,
    update(dt) {
      for (const c of chairs) {
        c.s = (c.s + dt * 2.6) % (2 * total);
        const up = c.s < total, d = up ? c.s : 2 * total - c.s;
        along(d, up ? 1.4 : -1.4, c.mesh.position);
        c.mesh.rotation.y = Math.atan2(lift.dir.x, lift.dir.z) + (up ? 0 : Math.PI);
      }
      for (const s of skiers) {
        s.k += dt * s.speed;
        if (s.k > 1) { s.k -= 1; s.lane = (Math.random() - 0.5) * 14; }
        const wig = Math.sin(s.k * 26 + s.ph) * s.wiggle, wig2 = Math.sin((s.k + 0.01) * 26 + s.ph) * s.wiggle;
        const at = (k, w, out) => out.copy(lift.runTop).lerp(lift.runBase, k).addScaledVector(lift.side, s.lane + w);
        at(s.k, wig, p); at(s.k + 0.01, wig2, q);
        s.mesh.position.set(p.x, terrain.heightAt(p.x, p.z) + 0.05, p.z);
        s.mesh.lookAt(q.x, s.mesh.position.y, q.z);
      }
    },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const g of geos) g.dispose(); },
  };
}

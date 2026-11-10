import * as THREE from 'three';
import { coachSideTexture, coachLitTexture, glowTexture } from './textures.js';
import { nightGlow } from './daynight.js';

// Procedural rolling stock. Local axes: +z = forward, y = 0 at rail top.
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o });
const black = M(0x26262b, { roughness: 0.7 });
const gold = M(0xf2c12e, { metalness: 0.6, roughness: 0.3 });
const steel = M(0x8d939c, { metalness: 0.7, roughness: 0.4 });
const roofWhite = M(0xeeeeee);
const matCache = new Map();
const MC = (color) => { if (!matCache.has(color)) matCache.set(color, M(color)); return matCache.get(color); };
const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffe680 });
nightGlow(lamp, 'emissiveIntensity', 4, true);
const glowTex = glowTexture();
const litWindows = coachLitTexture();
const headGlow = nightGlow(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0b0, transparent: true, depthWrite: false }), 'opacity', 0.95, true);
const tailGlow = nightGlow(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a1a, transparent: true, depthWrite: false }), 'opacity', 0.9, true);
// a soft cone of light in front of the engine, so you can see the beam
const beamMat = nightGlow(new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 'opacity', 0.07, true);
const beamGeo = new THREE.ConeGeometry(5, 34, 24, 1, true).translate(0, -17, 0).rotateX(-Math.PI / 2 + 0.07);
const cabGlow = nightGlow(new THREE.MeshStandardMaterial({ color: 0x26262b, emissive: 0xffb050 }), 'emissiveIntensity', 0.9);

function add(parent, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cylZ = (r1, r2, len, seg = 24) => new THREE.CylinderGeometry(r1, r2, len, seg).rotateX(Math.PI / 2);

function wheel(g, wheels, r, x, z, hubMat) {
  const w = add(g, new THREE.CylinderGeometry(r, r, 0.16, 22).rotateZ(Math.PI / 2), black, x, r, z);
  add(w, new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.19, 22).rotateZ(Math.PI / 2), hubMat, 0, 0, 0);
  add(w, box(0.22, 0.2, 0.2), gold, x > 0 ? 0.08 : -0.08, r * 0.45, 0); // crank pin so spinning is visible
  wheels.push({ mesh: w, r });
}

// parked: no spotlight or beam (only the train you drive gets a real light)
export function makeLoco(color = 0xd8342c, parked = false) {
  const g = new THREE.Group(), wheels = [];
  const body = MC(color), red = MC(0xc81e1e);
  for (const x of [-0.8, 0.8]) {
    for (const z of [-0.9, 0.8, 2.5]) wheel(g, wheels, 0.8, x, z, red);
    wheel(g, wheels, 0.45, x, 4.4, red);
    wheel(g, wheels, 0.55, x, -3.2, red);
    add(g, box(0.1, 0.18, 3.6), steel, x * 1.2, 0.8, 0.8); // side rods
  }
  add(g, box(1.3, 0.6, 9.8), black, 0, 1.1, 0.6);           // frame
  add(g, box(3.0, 0.25, 10.4), black, 0, 1.75, 0.6);        // footplate
  add(g, cylZ(1.0, 1.0, 5.6), body, 0, 2.9, 1.3);           // boiler
  for (const z of [-0.4, 1.3, 3.0]) add(g, cylZ(1.04, 1.04, 0.14), gold, 0, 2.9, z);
  add(g, cylZ(1.05, 1.05, 1.0), black, 0, 2.9, 4.6);        // smokebox
  add(g, cylZ(0.75, 0.75, 0.1), MC(0x3a3a40), 0, 2.9, 5.12);
  add(g, new THREE.CylinderGeometry(0.32, 0.38, 1.1, 16), black, 0, 4.3, 4.55); // chimney
  add(g, new THREE.CylinderGeometry(0.5, 0.36, 0.35, 16), black, 0, 4.95, 4.55);
  add(g, new THREE.SphereGeometry(0.5, 16, 12), gold, 0, 3.8, 1.6).scale.y = 0.85; // dome
  add(g, new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), gold, 0, 4.1, -1.0);       // whistle
  add(g, box(2.9, 2.5, 2.8), body, 0, 3.0, -2.9);           // cab
  add(g, box(3.3, 0.22, 3.3), black, 0, 4.35, -2.9);        // cab roof
  add(g, box(2.95, 0.9, 1.1), cabGlow, 0, 3.5, -2.6);       // cab side windows (warm firelight at night)
  for (const x of [-0.95, 0.95]) add(g, cylZ(0.26, 0.26, 0.05, 16), MC(0x9fd3ff), x, 3.8, -1.48);
  add(g, box(3.0, 0.5, 0.25), red, 0, 1.55, 5.65);          // buffer beam
  for (const x of [-1.0, 1.0]) add(g, cylZ(0.16, 0.16, 0.4, 12), black, x, 1.55, 5.95);
  add(g, box(2.4, 0.9, 0.9), red, 0, 0.6, 5.6).rotation.x = -0.6; // cowcatcher
  add(g, cylZ(0.3, 0.3, 0.35, 16), black, 0, 3.5, 5.3);     // headlamp
  add(g, cylZ(0.22, 0.22, 0.05, 16), lamp, 0, 3.5, 5.48);
  if (parked) return { group: g, length: 11, wheels, chimneyTop: new THREE.Vector3(0, 5.2, 4.55) };
  // headlamp: a real spotlight on the track ahead, a glow and a visible beam (all fade on at dusk)
  const spot = nightGlow(new THREE.SpotLight(0xfff0c8, 0, 120, 0.42, 0.55, 1), 'intensity', 60, true);
  spot.position.set(0, 3.5, 5.6);
  spot.target.position.set(0, 0.5, 40);
  g.add(spot, spot.target);
  const glow = new THREE.Sprite(headGlow);
  glow.position.set(0, 3.5, 5.75); glow.scale.setScalar(3);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, 3.5, 5.6);
  beam.renderOrder = 2;
  g.add(glow, beam);
  return { group: g, length: 11, wheels, chimneyTop: new THREE.Vector3(0, 5.2, 4.55) };
}

export function makeTender(color = 0xd8342c) {
  const g = new THREE.Group(), wheels = [];
  for (const x of [-0.8, 0.8]) for (const z of [-2.1, -0.9, 0.9, 2.1]) wheel(g, wheels, 0.5, x, z, MC(0xc81e1e));
  add(g, box(1.3, 0.5, 6), black, 0, 0.95, 0);
  add(g, box(2.9, 0.2, 6.2), black, 0, 1.4, 0);
  add(g, box(2.8, 1.9, 5.8), MC(color), 0, 2.45, 0);
  add(g, box(2.84, 0.12, 5.84), gold, 0, 2.0, 0);
  add(g, box(2.4, 0.4, 4.2), black, 0, 3.5, 0.4);
  for (let i = 0; i < 10; i++) {
    add(g, new THREE.DodecahedronGeometry(0.45), black, (Math.random() - 0.5) * 1.8, 3.75, -1.2 + Math.random() * 3.2);
  }
  return { group: g, length: 6.4, wheels };
}

const coachMats = new Map(); // shared per colour (parked coaches in depots reuse them)
export function makeCoach(color) {
  const g = new THREE.Group(), wheels = [];
  for (const bz of [-4.2, 4.2]) {
    add(g, box(1.6, 0.35, 2.6), black, 0, 0.75, bz);
    for (const x of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) wheel(g, wheels, 0.45, x, bz + dz, steel);
  }
  add(g, box(2.6, 0.35, 12), black, 0, 1.15, 0);
  if (!coachMats.has(color)) {
    const side = new THREE.MeshStandardMaterial({ map: coachSideTexture(color), roughness: 0.5, emissive: 0xffffff, emissiveMap: litWindows });
    nightGlow(side, 'emissiveIntensity', 1.1);
    coachMats.set(color, { side, plain: M(color) });
  }
  const { side, plain } = coachMats.get(color);
  add(g, box(2.9, 2.5, 12), [side, side, plain, plain, plain, plain], 0, 2.55, 0);
  add(g, cylZ(1.5, 1.5, 12.2, 24), roofWhite, 0, 3.8, 0).scale.y = 0.28; // rounded roof
  for (const z of [-6.15, 6.15]) for (const x of [-1.0, 1.0]) add(g, cylZ(0.15, 0.15, 0.4, 10), black, x, 1.4, z);
  // red tail lamp (only shown on the last coach)
  const tail = new THREE.Sprite(tailGlow);
  tail.position.set(0, 1.9, -6.3); tail.scale.setScalar(1.6);
  tail.visible = false;
  g.add(tail);
  return { group: g, length: 12.5, wheels, doors: [-5.4, 5.4], tail };
}

// Freight wagons for the depots: 'box', 'tank', 'coal', 'logs' or 'container'.
export function makeWagon(kind, color) {
  const g = new THREE.Group(), wheels = [], L = 9;
  for (const bz of [-3, 3]) {
    add(g, box(1.5, 0.3, 2.2), black, 0, 0.75, bz);
    for (const x of [-0.8, 0.8]) for (const dz of [-0.65, 0.65]) wheel(g, wheels, 0.42, x, bz + dz, steel);
  }
  add(g, box(2.7, 0.3, L), black, 0, 1.1, 0);
  for (const z of [-L / 2 - 0.15, L / 2 + 0.15]) for (const x of [-1.0, 1.0]) add(g, cylZ(0.14, 0.14, 0.3, 10), black, x, 1.3, z);
  const body = MC(color);
  if (kind === 'box') {
    add(g, box(2.8, 2.5, L - 0.2), body, 0, 2.5, 0);
    add(g, cylZ(1.45, 1.45, L - 0.1, 20), roofWhite, 0, 3.6, 0).scale.y = 0.22;
    for (const x of [-1.42, 1.42]) add(g, box(0.06, 2.0, 2.4), MC(new THREE.Color(color).multiplyScalar(0.7).getHex()), x, 2.4, 0); // doors
  } else if (kind === 'tank') {
    add(g, cylZ(1.25, 1.25, L - 0.6, 24), body, 0, 2.6, 0);
    for (const z of [-(L - 0.6) / 2, (L - 0.6) / 2]) add(g, new THREE.SphereGeometry(1.25, 20, 10).scale(1, 1, 0.3), body, 0, 2.6, z);
    add(g, new THREE.CylinderGeometry(0.45, 0.45, 0.6, 14), body, 0, 4.0, 0);
    add(g, box(2.9, 0.08, L - 1), steel, 0, 1.4, 0);
  } else if (kind === 'coal' || kind === 'logs') {
    add(g, box(2.8, 1.4, L - 0.2), body, 0, 1.95, 0);
    if (kind === 'coal') {
      add(g, box(2.5, 0.3, L - 0.6), black, 0, 2.6, 0);
      for (let i = 0; i < 9; i++) add(g, new THREE.DodecahedronGeometry(0.5), black, (Math.random() - 0.5) * 1.6, 2.75, (Math.random() - 0.5) * (L - 2));
    } else {
      const wood = MC(0x8a5a32);
      for (let i = 0; i < 7; i++) {
        const x = [-0.85, 0, 0.85, -0.42, 0.42, 0, -0.85][i], y = [2.9, 2.9, 2.9, 3.6, 3.6, 4.3, 3.6][i];
        if (i === 6) continue;
        add(g, cylZ(0.42, 0.42, L - 0.6, 10), wood, x, y, 0);
      }
    }
  } else {
    add(g, box(2.8, 2.6, L - 1), body, 0, 2.6, 0);
    for (let z = -3.5; z <= 3.5; z += 1) add(g, box(2.86, 2.4, 0.1), MC(new THREE.Color(color).multiplyScalar(0.8).getHex()), 0, 2.6, z);
  }
  return { group: g, length: L, wheels };
}

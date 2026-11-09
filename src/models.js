import * as THREE from 'three';
import { coachSideTexture } from './textures.js';

// Procedural rolling stock. Local axes: +z = forward, y = 0 at rail top.
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o });
const black = M(0x26262b, { roughness: 0.7 });
const gold = M(0xf2c12e, { metalness: 0.6, roughness: 0.3 });
const steel = M(0x8d939c, { metalness: 0.7, roughness: 0.4 });
const lamp = new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffe680, emissiveIntensity: 1.5 });

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

export function makeLoco(color = 0xd8342c) {
  const g = new THREE.Group(), wheels = [];
  const body = M(color), red = M(0xc81e1e);
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
  add(g, cylZ(0.75, 0.75, 0.1), M(0x3a3a40), 0, 2.9, 5.12);
  add(g, new THREE.CylinderGeometry(0.32, 0.38, 1.1, 16), black, 0, 4.3, 4.55); // chimney
  add(g, new THREE.CylinderGeometry(0.5, 0.36, 0.35, 16), black, 0, 4.95, 4.55);
  add(g, new THREE.SphereGeometry(0.5, 16, 12), gold, 0, 3.8, 1.6).scale.y = 0.85; // dome
  add(g, new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8), gold, 0, 4.1, -1.0);       // whistle
  add(g, box(2.9, 2.5, 2.8), body, 0, 3.0, -2.9);           // cab
  add(g, box(3.3, 0.22, 3.3), black, 0, 4.35, -2.9);        // cab roof
  add(g, box(2.95, 0.9, 1.1), black, 0, 3.5, -2.6);         // cab side windows
  for (const x of [-0.95, 0.95]) add(g, cylZ(0.26, 0.26, 0.05, 16), M(0x9fd3ff), x, 3.8, -1.48);
  add(g, box(3.0, 0.5, 0.25), red, 0, 1.55, 5.65);          // buffer beam
  for (const x of [-1.0, 1.0]) add(g, cylZ(0.16, 0.16, 0.4, 12), black, x, 1.55, 5.95);
  add(g, box(2.4, 0.9, 0.9), red, 0, 0.6, 5.6).rotation.x = -0.6; // cowcatcher
  add(g, cylZ(0.3, 0.3, 0.35, 16), black, 0, 3.5, 5.3);     // headlamp
  add(g, cylZ(0.22, 0.22, 0.05, 16), lamp, 0, 3.5, 5.48);
  return { group: g, length: 11, wheels, chimneyTop: new THREE.Vector3(0, 5.2, 4.55) };
}

export function makeTender(color = 0xd8342c) {
  const g = new THREE.Group(), wheels = [];
  for (const x of [-0.8, 0.8]) for (const z of [-2.1, -0.9, 0.9, 2.1]) wheel(g, wheels, 0.5, x, z, M(0xc81e1e));
  add(g, box(1.3, 0.5, 6), black, 0, 0.95, 0);
  add(g, box(2.9, 0.2, 6.2), black, 0, 1.4, 0);
  add(g, box(2.8, 1.9, 5.8), M(color), 0, 2.45, 0);
  add(g, box(2.84, 0.12, 5.84), gold, 0, 2.0, 0);
  add(g, box(2.4, 0.4, 4.2), black, 0, 3.5, 0.4);
  for (let i = 0; i < 10; i++) {
    add(g, new THREE.DodecahedronGeometry(0.45), black, (Math.random() - 0.5) * 1.8, 3.75, -1.2 + Math.random() * 3.2);
  }
  return { group: g, length: 6.4, wheels };
}

export function makeCoach(color) {
  const g = new THREE.Group(), wheels = [];
  for (const bz of [-4.2, 4.2]) {
    add(g, box(1.6, 0.35, 2.6), black, 0, 0.75, bz);
    for (const x of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) wheel(g, wheels, 0.45, x, bz + dz, steel);
  }
  add(g, box(2.6, 0.35, 12), black, 0, 1.15, 0);
  const side = new THREE.MeshStandardMaterial({ map: coachSideTexture(color), roughness: 0.5 });
  const plain = M(color);
  add(g, box(2.9, 2.5, 12), [side, side, plain, plain, plain, plain], 0, 2.55, 0);
  add(g, cylZ(1.5, 1.5, 12.2, 24), M(0xeeeeee), 0, 3.8, 0).scale.y = 0.28; // rounded roof
  for (const z of [-6.15, 6.15]) for (const x of [-1.0, 1.0]) add(g, cylZ(0.15, 0.15, 0.4, 10), black, x, 1.4, z);
  return { group: g, length: 12.5, wheels, doors: [-5.4, 5.4] };
}

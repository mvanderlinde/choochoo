import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_Y } from './noise.js';

// Trees, plants and props for each biome, as merged vertex-coloured geometries (drawn instanced by
// the terrain tiles), plus the rules for which ones grow where.

export function coloredGeo(geo, hex) {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const TRUNK = 0x6e4a2c;
const cone = (r, h, y, c, seg = 8) => coloredGeo(new THREE.ConeGeometry(r, h, seg).translate(0, y, 0), c);
const cyl = (r1, r2, h, y, c, seg = 6) => coloredGeo(new THREE.CylinderGeometry(r1, r2, h, seg).translate(0, y, 0), c);
const blob = (r, x, y, z, c, detail = 1) => coloredGeo(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z), c);
const ball = (r, x, y, z, c) => coloredGeo(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), c);
const merge = (parts) => { const g = mergeGeometries(parts); g.userData.shared = true; return g; };

function roundTree(canopy, trunk = TRUNK) { return merge([blob(3, 0, 5.2, 0, canopy), cyl(0.35, 0.5, 3.6, 1.8, trunk)]); }

function birch() {
  const parts = [cyl(0.22, 0.3, 6, 3, 0xeeeae0)];
  for (const y of [1.2, 2.6, 3.9, 5.1]) parts.push(coloredGeo(new THREE.CylinderGeometry(0.31, 0.31, 0.12, 6).translate(0, y, 0), 0x333333));
  parts.push(blob(2.2, 0, 6.6, 0, 0xf0c93a), blob(1.5, 0.9, 5.6, 0.4, 0xe8b02e));
  return merge(parts);
}

// Christmas tree: the tree, and separately its baubles and star (drawn bright, like fairy lights)
function xmasTree() {
  const tiers = [[2.4, 3.4, 2.8], [1.9, 3.0, 4.5], [1.3, 2.4, 6.0]];
  const tree = [cyl(0.3, 0.4, 1.6, 0.8, TRUNK)];
  for (const [r, h, y] of tiers) { tree.push(cone(r, h, y, 0x1f5c2e, 10)); tree.push(cone(r * 0.55, h * 0.35, y + h * 0.36, 0xf4f7fb, 10)); }
  const deco = [], cols = [0xff3b30, 0xffd60a, 0x0a84ff, 0xff9f0a, 0xbf5af2, 0xffffff];
  let k = 0;
  for (const [r, h, y] of tiers) {
    const n = Math.round(r * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + y, rr = r * 0.78, yy = y - h * 0.3;
      deco.push(ball(0.2, Math.cos(a) * rr, yy, Math.sin(a) * rr, cols[k++ % cols.length]));
    }
  }
  deco.push(coloredGeo(new THREE.OctahedronGeometry(0.45).translate(0, 7.55, 0), 0xffe14d));
  return { tree: merge(tree), deco: merge(deco) };
}

function snowman() {
  const W = 0xf4f6fa, B = 0x222222;
  const parts = [ball(1.0, 0, 0.9, 0, W), ball(0.72, 0, 2.2, 0, W), ball(0.5, 0, 3.2, 0, W)];
  for (const x of [-0.18, 0.18]) parts.push(ball(0.07, x, 3.32, 0.45, B));
  for (const y of [1.95, 2.25, 2.55]) parts.push(ball(0.08, 0, y, 0.7, B));
  parts.push(coloredGeo(new THREE.ConeGeometry(0.09, 0.5, 8).rotateX(Math.PI / 2).translate(0, 3.2, 0.7), 0xff8c1a));
  parts.push(cyl(0.55, 0.55, 0.08, 3.62, B, 14), cyl(0.36, 0.36, 0.55, 3.9, B, 14));
  parts.push(coloredGeo(new THREE.TorusGeometry(0.5, 0.11, 6, 14).rotateX(Math.PI / 2).translate(0, 2.8, 0), 0xd62828));
  return merge(parts);
}

function willow() {
  return merge([
    cyl(0.4, 0.6, 4.4, 2.2, 0x5a4630),
    coloredGeo(new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.55, 1).translate(0, 5.0, 0), 0x5f7f34),
    coloredGeo(new THREE.CylinderGeometry(2.9, 3.4, 3.2, 12, 1, true).translate(0, 3.5, 0), 0x6b8a3a),
  ]);
}

function deadTree() {
  const C = 0x6b5e50, parts = [cyl(0.22, 0.4, 5.5, 2.75, C)];
  for (const [y, a, tilt, len] of [[3.2, 0, 0.9, 2.2], [4.2, 2.2, 0.8, 1.8], [2.4, 4.1, 1.0, 1.6], [5.0, 1.0, 0.5, 1.2]]) {
    const g = new THREE.CylinderGeometry(0.07, 0.13, len, 5).translate(0, len / 2, 0).rotateZ(tilt).rotateY(a).translate(0, y, 0);
    parts.push(coloredGeo(g, C));
  }
  return merge(parts);
}

function reeds() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = 0.15 + (i % 3) * 0.18, h = 1.5 + (i % 4) * 0.25;
    parts.push(coloredGeo(new THREE.ConeGeometry(0.06, h, 4).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r), 0x6f8f3a));
    if (i % 3 === 0) parts.push(coloredGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 6).translate(Math.cos(a) * r, h * 0.85, Math.sin(a) * r), 0x5b3a1f));
  }
  return merge(parts);
}

function lilypad(flower) {
  const parts = [coloredGeo(new THREE.CylinderGeometry(0.8, 0.8, 0.05, 12, 1, false, 0.3, Math.PI * 2 - 0.6), 0x4f8f3a)];
  if (flower) parts.push(ball(0.2, 0.15, 0.12, 0.1, 0xff8fc0), ball(0.08, 0.15, 0.24, 0.1, 0xffe14d));
  return merge(parts);
}

function jungleTree() {
  return merge([
    cyl(0.45, 0.7, 9, 4.5, 0x5a3f28),
    blob(3.4, 0, 10, 0, 0x2f8f3d), blob(2.6, 2.1, 9, 1.1, 0x3aa04a), blob(2.4, -1.9, 9.3, -1.2, 0x268236), blob(2.0, 0.4, 11.6, -0.8, 0x45ad4f),
  ]);
}

function palm() {
  const parts = [];
  let x = 0, y = 0;
  for (let i = 0; i < 5; i++) {
    const h = 1.6, lean = 0.08 + i * 0.05;
    const g = new THREE.CylinderGeometry(0.22 - i * 0.02, 0.28 - i * 0.02, h, 7).translate(0, h / 2, 0).rotateZ(-lean).translate(x, y, 0);
    parts.push(coloredGeo(g, i % 2 ? 0x8b6b45 : 0x7a5c3a));
    x += Math.sin(lean) * h; y += Math.cos(lean) * h;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const g = new THREE.BoxGeometry(0.8, 0.06, 3.4).translate(0, 0, 1.7).rotateX(0.45).rotateY(a).translate(x, y, 0);
    parts.push(coloredGeo(g, i % 2 ? 0x3f9a3a : 0x4cae44));
  }
  for (const a of [0.5, 2.6, 4.4]) parts.push(ball(0.22, x + Math.cos(a) * 0.3, y - 0.3, Math.sin(a) * 0.3, 0x6b4a2a));
  return merge(parts);
}

function fern(flowers) {
  const parts = [blob(1.1, 0, 0.7, 0, 0x2f7a33, 0), blob(0.9, 0.9, 0.55, 0.3, 0x3a8a3a, 0), blob(0.8, -0.7, 0.5, -0.6, 0x276e2c, 0)];
  if (flowers) for (const [x, z] of [[0.4, 0.8], [-0.6, 0.4], [0.9, -0.5]]) parts.push(ball(0.18, x, 1.25, z, 0xe23b5a));
  return merge(parts);
}

function boat() {
  const parts = [
    coloredGeo(new THREE.BoxGeometry(2.0, 0.9, 5.2).translate(0, 0.3, 0), 0xffffff),
    coloredGeo(new THREE.BoxGeometry(2.04, 0.22, 5.24).translate(0, 0.55, 0), 0x1d70b8),
    coloredGeo(new THREE.ConeGeometry(1.0, 1.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.9).rotateX(Math.PI / 2).translate(0, 0.3, 3.3), 0xffffff),
    cyl(0.08, 0.1, 6, 3.8, 0x8b6b45),
  ];
  const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, 5.2); sail.lineTo(-2.6, 0); sail.lineTo(0, 0);
  parts.push(coloredGeo(new THREE.ExtrudeGeometry(sail, { depth: 0.04, bevelEnabled: false }).rotateY(Math.PI / 2).translate(0, 1.0, 0.1), 0xfafafa));
  const jib = new THREE.Shape(); jib.moveTo(0, 0); jib.lineTo(0, 4.2); jib.lineTo(2.0, 0); jib.lineTo(0, 0);
  parts.push(coloredGeo(new THREE.ExtrudeGeometry(jib, { depth: 0.04, bevelEnabled: false }).rotateY(Math.PI / 2).translate(0, 1.2, 0.3), 0xff5a4a));
  return merge(parts);
}

function lighthouse() {
  const parts = [cyl(3.2, 3.6, 1.2, 0.6, 0x8a837a, 10)];
  for (let i = 0; i < 6; i++) {
    const r0 = 2.2 - i * 0.18, r1 = 2.2 - (i + 1) * 0.18;
    parts.push(cyl(r1, r0, 2.4, 1.2 + i * 2.4 + 1.2, i % 2 ? 0xffffff : 0xd62828, 14));
  }
  parts.push(cyl(1.7, 1.7, 0.3, 15.75, 0x222222, 14), cyl(0.12, 0.12, 2.0, 16.9, 0x222222, 4));
  parts.push(coloredGeo(new THREE.ConeGeometry(1.3, 1.4, 14).translate(0, 18.6, 0), 0xd62828));
  return merge(parts);
}

let G = null;
export function floraGeos() {
  if (G) return G;
  const xt = xmasTree();
  G = {
    pine: merge([cone(2.3, 7, 5.5, 0x2f6b34), cyl(0.3, 0.45, 2.5, 1.25, TRUNK)]),
    round: roundTree(0x5d9e3c),
    snowPine: merge([cone(2.3, 7, 5.5, 0x2f6b34), cone(1.75, 4.6, 7.0, 0xf4f7fb), cyl(0.3, 0.45, 2.5, 1.25, TRUNK)]),
    snowRound: roundTree(0xdde8e2),
    autumnOrange: roundTree(0xe07b24), autumnRed: roundTree(0xc8432c), autumnYellow: roundTree(0xe9b830), birch: birch(),
    xmasTree: xt.tree, xmasDeco: xt.deco, snowman: snowman(),
    willow: willow(), deadTree: deadTree(), reeds: reeds(), lilypad: lilypad(false), lilyFlower: lilypad(true),
    jungleTree: jungleTree(), palm: palm(), fern: fern(false), fernFlowers: fern(true),
    boat: boat(), lighthouse: lighthouse(),
  };
  return G;
}

// scale range, and whether the plant floats on the water
export const KIND = {
  pine: { s: [0.7, 1.5] }, round: { s: [0.7, 1.5] }, snowPine: { s: [0.7, 1.5] }, snowRound: { s: [0.7, 1.5] },
  autumnOrange: { s: [0.7, 1.4] }, autumnRed: { s: [0.7, 1.4] }, autumnYellow: { s: [0.7, 1.4] }, birch: { s: [0.8, 1.3] },
  xmasTree: { s: [0.7, 1.2] }, snowman: { s: [0.8, 1.1] },
  willow: { s: [0.8, 1.3] }, deadTree: { s: [0.7, 1.3] }, reeds: { s: [0.8, 1.4] },
  lilypad: { s: [0.6, 1.3], water: true }, lilyFlower: { s: [0.7, 1.2], water: true },
  jungleTree: { s: [0.8, 1.5] }, palm: { s: [0.8, 1.3] }, fern: { s: [0.7, 1.4] }, fernFlowers: { s: [0.7, 1.3] },
  boat: { s: [0.9, 1.2], water: true, far: true },
};

function pickW(r, list) {
  let x = r();
  for (const [k, p] of list) { x -= p; if (x <= 0) return k; }
  return list[list.length - 1][0];
}
const LAND = WATER_Y + 0.8;

// What grows here: per biome, how dense, and a pick(rand, groundHeight) that returns a kind (or null).
export const FLORA = {
  meadow: { density: 1, pick: (r, h) => h > LAND && (r() < 0.3 ? 'pine' : 'round') },
  autumn: { density: 1, pick: (r, h) => h > LAND && pickW(r, [['pine', 0.14], ['autumnOrange', 0.25], ['autumnRed', 0.2], ['autumnYellow', 0.23], ['birch', 0.18]]) },
  winter: { density: 0.9, pick: (r, h) => h > LAND && (r() < 0.6 ? 'snowPine' : 'snowRound') },
  christmas: { density: 0.8, pick: (r, h) => h > LAND && pickW(r, [['xmasTree', 0.5], ['snowPine', 0.34], ['snowman', 0.16]]) },
  swamp: {
    density: 1.4,
    pick: (r, h) => {
      if (h < WATER_Y - 0.3) return h > WATER_Y - 2.5 && r() < 0.7 ? (r() < 0.25 ? 'lilyFlower' : 'lilypad') : null;
      if (h < WATER_Y + 0.9) return 'reeds';
      return pickW(r, [['willow', 0.45], ['deadTree', 0.25], ['reeds', 0.3]]);
    },
  },
  rainforest: { density: 2.4, pick: (r, h) => h > LAND && pickW(r, [['jungleTree', 0.5], ['palm', 0.18], ['fern', 0.22], ['fernFlowers', 0.1]]) },
  mountain: { density: 0.7, pick: (r, h) => h > LAND && (r() < 0.85 ? 'pine' : 'round') },
  ocean: {
    density: 0.5,
    pick: (r, h) => {
      if (h < WATER_Y - 6) return r() < 0.04 ? 'boat' : null;
      return h > LAND && (r() < 0.65 ? 'palm' : 'fern');
    },
  },
};
export const MAX_DENSITY = 2.4;

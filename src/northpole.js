import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloredGeo, floraGeos } from './flora.js';
import { textTexture } from './textures.js';
import { nightGlow } from './daynight.js';

// Stations in the Christmas biome are the North Pole: a striped North Pole signpost, a giant
// Christmas tree with presents, candy canes, Santa's Workshop, and reindeer with Santa's sleigh.
// Positions are in station coordinates: u along the track, v sideways (+v = the platform side).

const RED = 0xd62828, WHITE = 0xf7f4ee, GREEN = 0x1f7a3f, GOLD = 0xf2c12e, BROWN = 0x8a5a32;
const box = (w, h, d, x, y, z, c) => coloredGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (r1, r2, h, x, y, z, c, seg = 10) => coloredGeo(new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y, z), c);
const ball = (r, x, y, z, c) => coloredGeo(new THREE.SphereGeometry(r, 12, 8).translate(x, y, z), c);

let M = null;
function mats() {
  if (M) return M;
  M = {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
    bright: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glass: nightGlow(new THREE.MeshStandardMaterial({ color: 0x9fc3e6, emissive: 0xffc86a, roughness: 0.3 }), 'emissiveIntensity', 1.4),
    pole: new THREE.MeshBasicMaterial({ map: textTexture('North Pole', '#c8322f', '#fffaf0') }),
    shop: new THREE.MeshBasicMaterial({ map: textTexture('Santa\'s Workshop', '#1f6b3a', '#fffaf0') }),
    nose: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    tree: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
  };
  return M;
}

function present(parts, x, y, z, s, c, ribbon) {
  parts.push(box(s, s * 0.8, s, x, y + s * 0.4, z, c));
  parts.push(box(s + 0.02, s * 0.8 + 0.02, s * 0.2, x, y + s * 0.4, z, ribbon), box(s * 0.2, s * 0.8 + 0.02, s + 0.02, x, y + s * 0.4, z, ribbon));
  parts.push(ball(s * 0.16, x, y + s * 0.85, z, ribbon));
}
const WRAP = [[RED, GOLD], [GREEN, RED], [0x2c6db0, WHITE], [GOLD, GREEN], [0x9b5de5, GOLD], [WHITE, RED]];

function candyCane(parts, x, z) {
  for (let i = 0; i < 7; i++) parts.push(cyl(0.12, 0.12, 0.4, x, 0.2 + i * 0.4, z, i % 2 ? WHITE : RED));
  const hook = new THREE.TorusGeometry(0.35, 0.12, 6, 10, Math.PI).translate(x + 0.35, 2.8, z);
  parts.push(coloredGeo(hook, RED));
}

function reindeer(parts, x, z, dir) {
  const C = 0x8a5a32, D = 0x5b3a1f;
  const f = (dx) => x + dx * dir; // dir: +1 faces +x
  parts.push(coloredGeo(new THREE.CapsuleGeometry(0.45, 1.2, 4, 8).rotateZ(Math.PI / 2).translate(x, 1.35, z), C));
  for (const [dx, dz] of [[0.55, 0.25], [0.55, -0.25], [-0.55, 0.25], [-0.55, -0.25]]) parts.push(cyl(0.09, 0.08, 1.1, f(dx), 0.55, z + dz, D, 6));
  parts.push(cyl(0.16, 0.2, 0.7, f(0.95), 1.75, z, C, 8)); // neck
  parts.push(ball(0.3, f(1.15), 2.15, z, C), ball(0.17, f(1.45), 2.05, z, 0xc8a27a)); // head, muzzle
  for (const s of [-1, 1]) {
    parts.push(coloredGeo(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 5).rotateX(s * 0.5).translate(f(1.05), 2.65, z + s * 0.2), D));
    parts.push(coloredGeo(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 5).rotateZ(dir * 0.9).translate(f(1.15), 2.85, z + s * 0.35), D));
  }
  parts.push(ball(0.12, f(-0.85), 1.55, z, WHITE)); // tail
}

function sleigh(parts, x, z) {
  for (const s of [-0.7, 0.7]) parts.push(box(3.2, 0.12, 0.12, x, 0.1, z + s, GOLD), box(0.12, 0.6, 0.12, x - 1, 0.4, z + s, GOLD), box(0.12, 0.6, 0.12, x + 1, 0.4, z + s, GOLD));
  parts.push(box(2.6, 0.9, 1.6, x, 1.05, z, RED), box(0.4, 1.4, 1.6, x - 1.2, 1.3, z, RED), box(2.7, 0.1, 1.7, x, 1.55, z, GOLD));
  parts.push(ball(0.75, x - 0.2, 2.0, z, 0x8b5a2b)); // Santa's sack
  present(parts, x + 0.7, 1.5, z - 0.3, 0.6, RED, GOLD);
  present(parts, x + 0.6, 1.5, z + 0.4, 0.5, GREEN, RED);
}

export function buildNorthPole(st, rand) {
  const m = mats();
  const g = new THREE.Group();
  g.position.copy(st.trackPos); g.position.y = st.townY - 0.05;
  g.lookAt(g.position.clone().add(st.t)); // local +z = along the track (u)
  const side = st.s.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion)) > 0 ? 1 : -1;
  const X = (v) => v * side; // local x for a sideways offset v
  const parts = [], bright = [];

  // the North Pole signpost by the station
  for (let i = 0; i < 12; i++) parts.push(cyl(0.22, 0.22, 0.5, X(8), 0.25 + i * 0.5, 9, i % 2 ? WHITE : RED, 14));
  bright.push(ball(0.45, X(8), 6.3, 9, GOLD));
  for (const flip of [0, Math.PI]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.8), m.pole);
    sign.position.set(X(8), 4.9, 9); sign.rotation.y = -side * Math.PI / 2 + flip;
    g.add(sign);
  }

  // a giant Christmas tree with presents round it
  const F = floraGeos(), tree = new THREE.Group();
  tree.add(new THREE.Mesh(F.xmasTree, m.tree), new THREE.Mesh(F.xmasDeco, m.bright));
  tree.position.set(X(14), 0, -17); tree.scale.setScalar(2.3);
  tree.children.forEach((c) => { c.castShadow = true; });
  g.add(tree);
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + rand(), r = 3.2 + rand() * 1.5, [c, rb] = WRAP[i % WRAP.length];
    present(parts, X(14) + Math.cos(a) * r, 0, -17 + Math.sin(a) * r, 0.7 + rand() * 0.6, c, rb);
  }

  // candy canes along both sides of the line
  for (const u of [-24, -12, 12, 18, 24]) for (const v of [6.6, -6.6]) candyCane(parts, X(v), u);

  // Santa's Workshop across the line
  const W = { u: -2, v: -17 };
  parts.push(box(8, 6, 13, X(W.v), 3, W.u, RED), box(8.3, 0.4, 13.3, X(W.v), 6.0, W.u, WHITE), box(8.3, 0.5, 13.3, X(W.v), 0.25, W.u, WHITE));
  const roof = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4).scale(10, 3.2, 15).translate(X(W.v), 7.8, W.u);
  parts.push(coloredGeo(roof, WHITE)); // a snowy roof
  parts.push(box(0.3, 3.0, 2.4, X(W.v + 4.05), 1.5, W.u, GREEN)); // big door facing the line
  const glass = [];
  for (const u of [-4.3, 4.3]) glass.push(new THREE.BoxGeometry(0.15, 1.6, 2.2).translate(X(W.v + 4.05), 3.3, W.u + u));
  for (const u of [-3, 3]) for (const s of [-1, 1]) glass.push(new THREE.BoxGeometry(0.15, 1.4, 1.8).translate(X(W.v + s * 4.05), 3.3, W.u + u * 1.6));
  const glassMesh = new THREE.Mesh(mergeGeometries(glass), m.glass);
  g.add(glassMesh);
  for (const flip of [0, Math.PI]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.4), m.shop);
    sign.position.set(X(W.v + 4.2), 5.0, W.u); sign.rotation.y = side * Math.PI / 2 + flip;
    g.add(sign);
  }
  parts.push(cyl(0.5, 0.5, 2.4, X(W.v - 2), 9.0, W.u + 4, 0x7c3b2c, 8)); // chimney
  for (let i = 0; i < 5; i++) { const [c, rb] = WRAP[(i + 2) % WRAP.length]; present(parts, X(W.v + 5 + rand() * 2), 0, W.u - 3 + i * 1.4, 0.6 + rand() * 0.4, c, rb); }

  // Santa's sleigh and his reindeer, ready to go
  const sp = [];
  sleigh(sp, 0, 0); // built facing +x, turned to face along the line
  parts.push(mergeGeometries(sp).rotateY(-Math.PI / 2).translate(X(-13), 0, 10));
  for (const [i, u] of [[0, 14.2], [1, 17], [2, 19.8]]) {
    const rp = [];
    reindeer(rp, 0, 0, 1);
    const geo = mergeGeometries(rp).rotateY(-Math.PI / 2).translate(X(-13 + (i % 2 ? 0.7 : -0.7)), 0, u);
    parts.push(geo);
    if (i === 2) { // Rudolph's shiny nose
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), m.nose);
      nose.position.set(X(-13 - 0.7), 2.05, u + 1.6);
      g.add(nose);
    }
  }

  const body = new THREE.Mesh(mergeGeometries(parts), m.body);
  body.castShadow = body.receiveShadow = true;
  const shiny = new THREE.Mesh(mergeGeometries(bright.filter(Boolean)), m.bright);
  g.add(body, shiny);
  return g;
}

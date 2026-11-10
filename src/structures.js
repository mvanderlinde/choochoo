import * as THREE from 'three';
import { naturalHeight, WATER_Y } from './heights.js';
import { stoneTexture } from './textures.js';

// Tunnels and bridges. Where the land rises well above the track the mountain is kept and the
// track runs through a tunnel; where it drops well below, the valley is kept and the track
// crosses on a bridge. Everything here is built per track edge and deleted with it.

const V3 = THREE.Vector3;
export const rightOf = (t) => new V3(-t.z, 0, t.x).normalize();
const TUNNEL_ABOVE = 10;  // land this much above the track -> tunnel
const BRIDGE_BELOW = 6;   // land this much below the track -> bridge
const MIN_SPAN = 30;      // shorter tunnels/bridges in the middle of an edge are just cut/filled
const ARCH_R = 3.6, ARCH_Y = 3.2; // tunnel arch: walls up to ARCH_Y, then a half circle

let M = null;
function mats() {
  if (M) return M;
  const stone = stoneTexture();
  stone.repeat.set(0.25, 0.25);
  const S = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, ...o });
  M = {
    portal: S({ map: stone }),
    tube: S({ color: 0x77716a }),
    dark: new THREE.MeshBasicMaterial({ color: 0x0b0b0d }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    girder: S({ color: 0xd9533c, roughness: 0.6, metalness: 0.2 }),
    rail: S({ color: 0xf2f2f2, roughness: 0.6 }),
    pier: S({ color: 0xa39c90 }),
    unitBox: new THREE.BoxGeometry(1, 1, 1),
    lampGeo: new THREE.BoxGeometry(0.25, 0.35, 0.6),
  };
  for (const g of [M.unitBox, M.lampGeo]) g.userData.shared = true;
  return M;
}

// Which bits of an edge are tunnel or bridge: [{type, a, b}] in metres along the edge.
export function findSpans(e, opts) {
  if (opts.station || opts.depot) return [];
  const p = new V3(), pts = [];
  for (let d = 0; ; d = Math.min(d + 2, e.length)) {
    e.pointAt(d, p);
    const diff = naturalHeight(p.x, p.z) - p.y;
    let type = diff > TUNNEL_ABOVE ? 'tunnel' : diff < -BRIDGE_BELOW ? 'bridge' : null;
    if (opts.branch && d < 70) type = null; // keep junctions in the open
    // A tunnel or bridge may only run right from the start of an edge if it carries on from the
    // previous edge. Otherwise start it a little way in, so it gets its portal / abutment.
    if (d < 12 && type && type !== opts.prevEnd) type = null;
    if (d === 0 && opts.prevEnd) type = opts.prevEnd; // ...and one that does carry on gets its exit here at the latest
    pts.push({ d, type });
    if (d >= e.length) break;
  }
  const raw = [];
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i].type) continue;
    let j = i;
    while (j + 1 < pts.length && pts[j + 1].type === pts[i].type) j++;
    const sp = { type: pts[i].type, a: pts[i].d, b: pts[j].d };
    const prev = raw[raw.length - 1];
    if (prev && prev.type === sp.type && sp.a - prev.b < 45) prev.b = sp.b; // join two close tunnels/bridges
    else raw.push(sp);
    i = j;
  }
  return raw.filter((sp) => sp.a === 0 || sp.b === e.length || sp.b - sp.a >= MIN_SPAN);
}

export function spanAt(e, d) { return e.spans?.find((s) => d >= s.a && d <= s.b) ?? null; }

// How the ground should treat the track at distance d along the edge:
// 'tunnel' (keep the mountain), 'portal' (first few metres inside a tunnel: narrow slot behind the
// portal wall), 'bridge' (keep the valley) or 'normal' (cut/fill). For normal track, also the
// distance to the nearest bridge, so the embankment can narrow towards the abutment.
export function trackMode(e, d) {
  const sp = spanAt(e, d);
  if (sp?.type === 'tunnel') {
    // depth: how far inside the nearest portal this is
    const depth = Math.min(sp.a > 0 ? d - sp.a : Infinity, sp.b < e.length ? sp.b - d : Infinity);
    return { mode: depth < 6 ? 'portal' : 'tunnel', endDist: 0, depth };
  }
  if (sp) return { mode: 'bridge', endDist: 0 };
  let endDist = Infinity;
  for (const s of e.spans) if (s.type === 'bridge') endDist = Math.min(endDist, d < s.a ? s.a - d : d - s.b);
  return { mode: 'normal', endDist };
}

// Sweep a 2D profile (x = right, y = up) along track samples into a strip mesh.
export function sweep(samples, profile, uScale) {
  const pos = [], uv = [], idx = [];
  for (let s = 0; s < profile.length - 1; s++) {
    const base = pos.length / 3;
    for (const S of samples) {
      for (const k of [s, s + 1]) {
        const [px, py] = profile[k];
        pos.push(S.p.x + S.r.x * px, S.p.y + py, S.p.z + S.r.z * px);
        uv.push(S.d * uScale, k === s ? 0 : 1);
      }
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function samplesBetween(e, a, b) {
  const out = [], n = Math.max(1, Math.ceil(b - a));
  for (let i = 0; i <= n; i++) {
    const d = a + (i / n) * (b - a);
    const t = e.tangentAt(d, new V3());
    out.push({ d, p: e.pointAt(d, new V3()), r: rightOf(t), t });
  }
  return out;
}

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// Instanced boxes: list of {p, yaw (lookAt dir), sx, sy, sz}
function boxes(list, mat) {
  const { unitBox } = mats();
  const im = new THREE.InstancedMesh(unitBox, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((b, i) => {
    o.position.copy(b.p);
    o.lookAt(b.p.x + b.dir.x, b.p.y, b.p.z + b.dir.z);
    o.scale.set(b.sx, b.sy, b.sz);
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
  });
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

// ---------- tunnels ----------
function archPath(path, r = ARCH_R) {
  path.moveTo(-r, -0.6);
  path.lineTo(-r, ARCH_Y);
  path.absarc(0, ARCH_Y, r, Math.PI, 0, true);
  path.lineTo(r, -0.6);
  path.lineTo(-r, -0.6);
  return path;
}

export function buildTunnel(add, e, span) {
  const m = mats();
  const samples = samplesBetween(e, span.a, span.b);
  // tube lining
  const prof = [[-2.4, -0.7], [-ARCH_R, -0.7], [-ARCH_R, ARCH_Y]]; // floor beside the ballast, then wall
  for (let i = 1; i < 12; i++) {
    const th = Math.PI - (i / 12) * Math.PI;
    prof.push([Math.cos(th) * ARCH_R, ARCH_Y + Math.sin(th) * ARCH_R]);
  }
  prof.push([ARCH_R, ARCH_Y], [ARCH_R, -0.7], [2.4, -0.7]);
  add(mesh(sweep(samples, prof, 0.25), m.tube, false));

  // little lamps along the wall
  const lamps = [];
  for (let d = span.a + 8; d < span.b - 4; d += 18) {
    const S = samplesBetween(e, d, d + 0.01)[0];
    for (const side of [-1, 1]) {
      lamps.push({ p: S.p.clone().addScaledVector(S.r, side * (ARCH_R - 0.15)).setY(S.p.y + 3.0), dir: S.t, sx: 1, sy: 1, sz: 1 });
    }
  }
  if (lamps.length) {
    const im = new THREE.InstancedMesh(m.lampGeo, m.lamp, lamps.length);
    const o = new THREE.Object3D();
    lamps.forEach((l, i) => { o.position.copy(l.p); o.lookAt(l.p.clone().add(l.dir)); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    add(im);
  }

  if (span.a > 0) add(portal(e, span.a, 1));
  if (span.b < e.length) add(portal(e, span.b, -1));
}

// Stone portal at distance d; `inward` is +1 if the tunnel continues forwards along the edge.
function portal(e, d, inward) {
  const m = mats();
  const p = e.pointAt(d, new V3());
  const t = e.tangentAt(d, new V3()); t.y = 0; t.normalize();
  const g = new THREE.Group();
  g.position.copy(p);
  g.lookAt(p.clone().addScaledVector(t, inward)); // local +z points into the tunnel

  const outer = new THREE.Shape();
  outer.moveTo(-8.5, -4); outer.lineTo(8.5, -4); outer.lineTo(8.5, 11); outer.lineTo(-8.5, 11); outer.lineTo(-8.5, -4);
  outer.holes.push(archPath(new THREE.Path(), ARCH_R + 0.05));
  const wall = new THREE.ExtrudeGeometry(outer, { depth: 3, bevelEnabled: false });
  wall.translate(0, 0, -0.6);
  g.add(mesh(wall, m.portal));
  // cornice and arch ring for a bit of detail
  const cornice = new THREE.BoxGeometry(18, 0.9, 3.6).translate(0, 11.2, 0.9);
  g.add(mesh(cornice, m.pier));
  const ringShape = archPath(new THREE.Shape(), ARCH_R + 0.9);
  ringShape.holes.push(archPath(new THREE.Path(), ARCH_R + 0.05));
  const ring = new THREE.ExtrudeGeometry(ringShape, { depth: 0.4, bevelEnabled: false }).translate(0, 0, -0.9);
  g.add(mesh(ring, m.pier));
  // darkness inside: one-sided, facing out, so it hides the inside from outside only
  const darkGeo = new THREE.ShapeGeometry(archPath(new THREE.Shape(), ARCH_R + 0.05)).rotateY(Math.PI).translate(0, 0, 1.2);
  const dark = new THREE.Mesh(darkGeo, m.dark);
  g.add(dark);
  return g;
}

// ---------- bridges ----------
export function buildBridge(add, e, span) {
  const m = mats();
  const a = Math.max(0, span.a - 3), b = Math.min(e.length, span.b + 3);
  const samples = samplesBetween(e, a, b);
  // deck girder (ballast and rails already run on top), plus side railings
  add(mesh(sweep(samples, [[-3.1, -0.5], [-3.1, -2.4], [3.1, -2.4], [3.1, -0.5]], 0.2), m.girder));
  for (const s of [-1, 1]) {
    add(mesh(sweep(samples, [[s * 3.1, -0.5], [s * 3.1, 0.55], [s * 2.95, 0.55], [s * 2.95, -0.5]], 0.2), m.rail, false));
  }

  // stone piers down to the valley floor
  const piers = [];
  const len = span.b - span.a;
  const n = Math.max(1, Math.round(len / 18));
  for (let i = 0; i <= n; i++) {
    const d = span.a + (i / n) * len;
    if ((i === 0 && span.a > 0) || (i === n && span.b < e.length)) continue; // abutment there instead
    const S = samplesBetween(e, d, d + 0.01)[0];
    const ground = Math.min(naturalHeight(S.p.x, S.p.z), WATER_Y - 1) - 3;
    const top = S.p.y - 2.4;
    if (top - ground < 1) continue;
    piers.push({ p: S.p.clone().setY((top + ground) / 2), dir: S.t, sx: 4.6, sy: top - ground, sz: 2 });
  }
  if (piers.length) add(boxes(piers, m.pier));

  // abutments where the bridge meets the embankment
  const abut = [];
  for (const [d, dirSign, inside] of [[span.a, -1, span.a > 0], [span.b, 1, span.b < e.length]]) {
    if (!inside) continue;
    const S = samplesBetween(e, d, d + 0.01)[0];
    abut.push({ p: S.p.clone().addScaledVector(S.t, dirSign * 2.5).setY(S.p.y - 6.5), dir: S.t, sx: 8, sy: 12, sz: 6 });
  }
  if (abut.length) add(boxes(abut, m.pier));
}

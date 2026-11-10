import * as THREE from 'three';
import { gravelTexture, arrowTexture } from './textures.js';
import { trackBaseHeight, smooth, mix, mulberry32, mountainMask } from './heights.js';
import { findSpans, trackMode, sweep, rightOf, buildTunnel, buildBridge } from './structures.js';

// Endless track: a tree of edges generated on demand ahead of the train.
// Every junction splits into a left and a right branch that fan apart, so
// there are no dead ends. Edges far behind the train are deleted.
export const RAIL_TOP = 0.3;
const STEP = 8;          // spacing of curve control points (m)
const LOOKAHEAD = 1500;  // keep this much track generated ahead (m)
const CELL = 32;         // spatial hash cell size (m)
const V3 = THREE.Vector3;

class Edge {
  constructor(from, pts) {
    this.from = from;
    this.to = null;
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curve.arcLengthDivisions = pts.length * 10;
    this.length = this.curve.getLength();
    this.mid = this.pointAt(this.length / 2, new V3());
    this.objects = [];
    this.cells = [];
    this.station = null;
  }
  pointAt(d, target) { return this.curve.getPointAt(THREE.MathUtils.clamp(d / this.length, 0, 1), target); }
  tangentAt(d, target) { return this.curve.getTangentAt(THREE.MathUtils.clamp(d / this.length, 0, 1), target); }
}

export class TrackNetwork {
  constructor(scene, seed = 7) {
    this.scene = scene;
    this.rand = mulberry32(seed);
    this.edges = new Set();
    this.grid = new Map();
    this.signs = new Set();
    this.onEdgeAdded = null;
    this.onEdgeRemoved = null;
    this.ballastMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.35 });
    this.sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    this.postMat = new THREE.MeshStandardMaterial({ color: 0x777777 });
    this.sleeperGeo = new THREE.BoxGeometry(2.5, 0.16, 0.28);
    this.postGeo = new THREE.CylinderGeometry(0.15, 0.15, 6, 8);
    this.boardGeo = new THREE.PlaneGeometry(3.4, 3.4);
    for (const g of [this.sleeperGeo, this.postGeo, this.boardGeo]) g.userData.shared = true;
    this.texL = arrowTexture('left');
    this.texR = arrowTexture('right');
  }

  // Creates the first node and the first edge (always a station, so the ride starts at one).
  start() {
    const root = this.makeNode(new V3(0, trackBaseHeight(0, 0), 0), 0, 0, 0, 0, 0);
    return this.makeEdge(root, { station: true });
  }

  makeNode(pos, heading, curv, pref, sinceJunction, sinceStation) {
    return { pos, heading, curv, pref, sinceJunction, sinceStation, outs: [], isJunction: false, inEdge: null };
  }

  makeEdge(node, opts = {}) {
    const r = this.rand;
    const L = opts.station ? 260 : opts.depot ? 320 : 170 + r() * 90;
    const k0 = opts.branch ? opts.branch * 0.0065 : node.curv;
    // each line has a preferred heading; branches push theirs apart so they fan out
    const pref = node.pref + (opts.branch ? opts.branch * 0.7 : (r() - 0.5) * 0.3);
    const k1 = THREE.MathUtils.clamp((r() * 2 - 1) * 0.0035 - 0.0035 * Math.sin(node.heading - pref), -0.005, 0.005);
    let curv;
    if (opts.branch) curv = (s) => (s < 120 ? mix(k0, 0, smooth(60, 120, s)) : mix(0, k1, smooth(120, L, s)));
    else if (opts.depot) curv = (s) => k0 * (1 - smooth(0, L * 0.15, s)) + k1 * smooth(L * 0.85, L, s); // long straight for the yard
    else if (opts.station) curv = (s) => k0 * (1 - smooth(0, L * 0.3, s)) + k1 * smooth(L * 0.7, L, s); // straight middle
    else curv = (s) => mix(k0, k1, smooth(0, L, s));

    const pts = [node.pos.clone()];
    let x = node.pos.x, z = node.pos.z, h = node.heading;
    const n = Math.round(L / STEP);
    for (let i = 1; i <= n; i++) {
      h += curv(i * STEP) * STEP;
      x += Math.sin(h) * STEP;
      z += Math.cos(h) * STEP;
      pts.push(new V3(x, trackBaseHeight(x, z), z));
    }
    if (opts.depot) {
      // the yard is flat, so level the middle of the line through it too
      const yMid = pts[Math.round(n / 2)].y;
      pts.forEach((p, i) => { p.y = mix(p.y, yMid, smooth(0, 6, i) * smooth(n, n - 6, i)); });
    }
    const e = new Edge(node, pts);
    e.wantsStation = !!opts.station;
    e.wantsDepot = !!opts.depot;
    e.spans = findSpans(e, opts);
    e.to = this.makeNode(pts[pts.length - 1].clone(), h, curv(L), pref,
      opts.branch ? 1 : node.sinceJunction + 1, opts.station ? 0 : node.sinceStation + 1);
    e.to.inEdge = e;
    e.to.sinceDepot = opts.depot ? 0 : (node.sinceDepot ?? 3) + 1;
    node.outs.push(e);
    this.edges.add(e);
    this.buildEdgeMeshes(e);
    this.indexEdge(e);
    this.onEdgeAdded?.(e);
    return e;
  }

  generateOuts(node) {
    if (node.outs.length) return;
    // no junctions or stations in (or just after) a tunnel or on a bridge
    const ie = node.inEdge;
    const clear = !ie || !ie.spans.some((s) => s.b > ie.length - 60);
    const junction = clear && node.sinceJunction >= 2 && (node.sinceJunction >= 3 || this.rand() < 0.5);
    if (junction) {
      node.isJunction = true;
      this.makeEdge(node, { branch: 1 });
      this.makeEdge(node, { branch: -1 });
      const right = rightOf(node.outs[0].tangentAt(0, new V3()));
      const lat = (e) => e.pointAt(40, new V3()).sub(node.pos).dot(right);
      const [A, B] = node.outs;
      if (lat(A) < lat(B)) { node.left = A; node.right = B; } else { node.left = B; node.right = A; }
      node.defaultSide = this.rand() < 0.5 ? 'left' : 'right';
      if (node.inEdge) this.buildSign(node);
    } else {
      const station = clear && (node.sinceStation >= 4 || (node.sinceStation >= 2 && this.rand() < 0.5));
      // now and then a train depot (on flattish land, away from stations)
      const depot = !station && clear && (node.sinceDepot ?? 3) >= 7 && node.sinceStation >= 1 &&
        mountainMask(node.pos.x, node.pos.z) < 0.25 && this.rand() < 0.35;
      this.makeEdge(node, { station, depot });
    }
  }

  // Make sure there is LOOKAHEAD metres of track on every route ahead of the train.
  expand(edge, d) {
    const queue = [[edge.to, edge.length - d]];
    while (queue.length) {
      const [n, dist] = queue.shift();
      if (dist > LOOKAHEAD) continue;
      this.generateOuts(n);
      for (const e of n.outs) queue.push([e.to, dist + e.length]);
    }
  }

  // Delete track the train can no longer reach once it is far away.
  prune(train, pos) {
    const keep = new Set([train.edge, ...train.history]);
    const stack = [train.edge.to];
    while (stack.length) {
      const n = stack.pop();
      for (const e of n.outs) if (!keep.has(e)) { keep.add(e); stack.push(e.to); }
    }
    for (const e of [...this.edges]) {
      if (keep.has(e)) continue;
      if ([e.from.pos, e.mid, e.to.pos].every((p) => p.distanceTo(pos) > 600)) this.removeEdge(e);
    }
  }

  removeEdge(e) {
    this.edges.delete(e);
    for (const o of e.objects) {
      this.scene.remove(o);
      if (o.userData.sign) this.signs.delete(o.userData.sign);
      o.traverse((c) => { if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); if (c.isInstancedMesh) c.dispose(); });
    }
    this.unindexEdge(e);
    e.from.outs = e.from.outs.filter((x) => x !== e);
    e.to.inEdge = null;
    this.onEdgeRemoved?.(e);
  }

  // ---------- spatial index for "how far is the nearest track?" ----------
  key(cx, cz) { return cx * 100003 + cz; }

  indexEdge(e) {
    const v = new V3();
    for (let d = 0; d <= e.length; d += 2) {
      e.pointAt(d, v);
      const k = this.key(Math.floor(v.x / CELL), Math.floor(v.z / CELL));
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push({ e, x: v.x, y: v.y, z: v.z, ...trackMode(e, d) });
      if (!e.cells.includes(k)) e.cells.push(k);
    }
  }

  unindexEdge(e) {
    for (const k of e.cells) {
      const arr = this.grid.get(k).filter((p) => p.e !== e);
      if (arr.length) this.grid.set(k, arr); else this.grid.delete(k);
    }
  }

  nearest(x, z, maxR) {
    let best = maxR * maxR, bp = null;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), r = Math.ceil(maxR / CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const arr = this.grid.get(this.key(cx + i, cz + j));
      if (!arr) continue;
      for (const p of arr) {
        const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; bp = p; }
      }
    }
    return bp && { d: Math.sqrt(best), y: bp.y, mode: bp.mode, endDist: bp.endDist };
  }

  // ---------- meshes ----------
  buildEdgeMeshes(e) {
    const samples = [];
    const n = Math.ceil(e.length);
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * e.length;
      const t = e.tangentAt(d, new V3());
      samples.push({ d, p: e.pointAt(d, new V3()), r: rightOf(t) });
    }
    const ballast = [[-2.7, -0.9], [-1.7, 0.03], [1.7, 0.03], [2.7, -0.9]];
    const rail = (o) => [[o - 0.07, 0.12], [o - 0.07, RAIL_TOP], [o + 0.07, RAIL_TOP], [o + 0.07, 0.12]];
    for (const [prof, mat, us] of [[ballast, this.ballastMat, 0.4], [rail(-0.75), this.railMat, 1], [rail(0.75), this.railMat, 1]]) {
      const m = new THREE.Mesh(sweep(samples, prof, us), mat);
      m.receiveShadow = true;
      this.add(e, m);
    }
    const count = Math.floor((e.length - 0.4) / 0.75) + 1;
    const inst = new THREE.InstancedMesh(this.sleeperGeo, this.sleeperMat, count);
    const dummy = new THREE.Object3D(), p = new V3(), t = new V3();
    for (let i = 0; i < count; i++) {
      const d = 0.4 + i * 0.75;
      e.pointAt(d, p); e.tangentAt(d, t);
      dummy.position.copy(p); dummy.position.y += 0.06;
      dummy.lookAt(p.x + t.x, p.y + 0.06 + t.y, p.z + t.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.receiveShadow = true;
    this.add(e, inst);
    for (const sp of e.spans) (sp.type === 'tunnel' ? buildTunnel : buildBridge)((o) => this.add(e, o), e, sp);
  }

  add(e, obj) { this.scene.add(obj); e.objects.push(obj); }

  // Big arrow sign 35 m before a junction showing which way the train will go.
  buildSign(node) {
    const e = node.inEdge;
    const d = e.length - 35;
    const p = e.pointAt(d, new V3());
    const t = e.tangentAt(d, new V3());
    const pos = p.clone().addScaledVector(rightOf(t), 5);
    const g = new THREE.Group();
    g.position.copy(pos);
    g.lookAt(pos.clone().sub(t));
    const post = new THREE.Mesh(this.postGeo, this.postMat);
    post.position.y = 2.5; post.castShadow = true; g.add(post);
    const mat = new THREE.MeshBasicMaterial({ map: this.texR, transparent: true, side: THREE.DoubleSide });
    const board = new THREE.Mesh(this.boardGeo, mat);
    board.position.set(0, 6.5, 0.2); g.add(board);
    g.userData.sign = { node, mat, board };
    this.signs.add(g.userData.sign);
    this.add(e, g);
  }

  updateSigns(upcomingNode, side, time) {
    for (const s of this.signs) {
      const active = s.node === upcomingNode;
      const sd = active ? side : s.node.defaultSide;
      s.mat.map = sd === 'left' ? this.texL : this.texR;
      s.board.scale.setScalar(active ? 1 + 0.1 * Math.sin(time * 6) : 1);
    }
  }
}

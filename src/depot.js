import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smooth, mix } from './heights.js';
import { makeLoco, makeTender, makeCoach, makeWagon } from './models.js';
import { RAIL_TOP } from './tracks.js';
import { biomeWeights, coastDistance } from './biomes.js';
import { gravelTexture, glowTexture, stoneTexture, textTexture, brushTexture } from './textures.js';
import { nightGlow } from './daynight.js';

// Train depots: every so often a big yard opens up beside the line, full of sidings, parked
// trains, an engine shed, a water tower, a coal stage and a turntable that slowly spins an
// engine round, while a little shunting engine potters up and down. The first siding is the wash
// road: the train can turn off the main line onto it (a loop that rejoins the main line at the far
// end of the yard) and roll through the train wash, which scrubs the dirt off.
//
// Layout is in yard coordinates: u along the main line (0 = middle of the edge), v sideways
// away from it (0 = main line). The static parts are merged into one mesh per material.

const V3 = THREE.Vector3;
const U = 120, W = 62;                 // yard half-length and width
const TRACKS = 6, V0 = 9, GAP = 5;     // sidings at v = 9, 14, ... 34
const LEAD_U = -100, LEAD_END = -22;   // the diagonal lead track from the wash road to the other sidings
const SHED_U = [42, 96];               // engine shed, over the last three sidings
const BUFFER_U = 78;
const vOf = (i) => V0 + i * GAP;
const vLast = vOf(TRACKS - 1);
const leadU = (v) => LEAD_U + (v / vLast) * (LEAD_END - LEAD_U);
// The wash road (siding 0) is real track, part of the line: off the main line, along v = V0 through
// the train wash, and back on again.
const LOOP_OUT = [-158, leadU(V0) - 1], LOOP_BACK = [92, 156];
const WASH_U = [2, 36], BRUSH_U = 19;   // the wash, and where its brushes do the scrubbing

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
    // in the swamp the yard is built up on an embankment with steep banks, clear of the pools
    // (elsewhere the flattened yard blends gently into the land round it)
    this.bank = (biomeWeights(this.p.x, this.p.z).w.swamp ?? 0) > 0.3;

    // yard frame: local z = u, local x = v * side (group +x is the left of the track direction)
    this.group = new THREE.Group();
    this.group.position.copy(this.p);
    this.group.lookAt(this.p.clone().add(this.t));
    const S = new THREE.Group(); // static parts, baked below
    const m = mats();

    // sidings and the lead track that feeds them (off the wash road, which is part of the line)
    this.track(S, V0, leadU(V0), vLast, LEAD_END);
    for (let i = 1; i < TRACKS; i++) {
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
    this.signalBox(S, -100, 15.5);
    this.trainWash(S);
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
    // track 1: a passenger train ready to go, or a long freight train
    if (r() < 0.5) this.consist(S, 1, BUFFER_U - 6, [makeLoco(pick(locoColors), true), makeTender(), ...Array.from({ length: 2 + Math.floor(r() * 2) }, () => makeCoach(pick(coachColors)))]);
    else this.consist(S, 1, BUFFER_U - 3, Array.from({ length: 6 + Math.floor(r() * 3) }, () => makeWagon(pick(wagonKinds), pick(wagonColors))));
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

    this.washParts();
    this.scene.add(this.group);
    this.group.updateMatrixWorld(true);
    this.washPoint = this.group.localToWorld(new V3(this.x(V0), 2, BRUSH_U)); // middle of the brushes
  }

  x(v) { return v * this.side; }

  // yard coordinates -> world position
  at(u, v, y, target = new V3()) { return target.copy(this.p).addScaledVector(this.t, u).addScaledVector(this.lat, v).setY(this.p.y + y); }

  // The wash, as distances along the yard loop (whose ramps in and out are the same, so u = 0 is half way).
  washSpan() { const h = this.loop.length / 2; return [h + WASH_U[0], h + WASH_U[1]]; }

  // A good spot to watch the train go through the wash from: beside the main line, just past the
  // brushes, looking back at them and the wash's entrance.
  washView(pos, look) { this.at(31, -12, 10, pos); this.at(16, V0, 1.8, look); }

  // How far the yard loop is from the main line, at u along it.
  loopOffset(u) { return V0 * smooth(LOOP_OUT[0], LOOP_OUT[1], u) * smooth(LOOP_BACK[1], LOOP_BACK[0], u); }

  // The train wash's frame, walls and signs (baked with the rest of the yard).
  trainWash(parent) {
    const m = mats(), x = this.x(V0), half = 2.85, top = 6.6;
    const [u0, u1] = WASH_U, len = u1 - u0, mid = (u0 + u1) / 2;
    if (!M.washSign) {
      const tex = textTexture('🫧 TRAIN WASH 🫧', '#1f6fc4');
      M.washSign = nightGlow(new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, roughness: 0.6 }), 'emissiveIntensity', 0.7);
      M.washBlue = new THREE.MeshStandardMaterial({ color: 0x2f8fe0, roughness: 0.5 });
      M.washPipe = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.6, roughness: 0.35 });
      // bright strip lights (on after dark), and a cool white glow round the entrances
      M.washLight = nightGlow(new THREE.MeshStandardMaterial({ color: 0xeef6ff, emissive: 0xd6ecff, roughness: 0.4 }), 'emissiveIntensity', 2.5);
      M.washHalo = nightGlow(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xcfe6ff, transparent: true, depthWrite: false }), 'opacity', 0.8);
    }
    // low side walls, white with a blue stripe, so you can see the train inside
    for (const s of [-1, 1]) {
      box(parent, m.white, 0.3, 2.0, len, x + this.side * s * half, 0.45, mid);
      box(parent, M.washBlue, 0.34, 0.35, len, x + this.side * s * half, 1.1, mid);
    }
    // gantries: posts and a beam across the top at each end, at the spray bars and over the brushes
    for (const u of [u0, 6, 14, 24, 31, u1]) {
      for (const s of [-1, 1]) box(parent, M.washBlue, 0.4, top + 0.55, 0.4, x + this.side * s * half, (top - 0.55) / 2, u);
      box(parent, M.washBlue, half * 2 + 0.4, 0.45, 0.5, x, top, u);
      box(parent, M.washLight, half * 2 - 0.5, 0.12, 0.22, x, top - 0.29, u); // a strip light under each beam
    }
    // lamps over both entrances
    for (const u of [u0 - 0.5, u1 + 0.5]) {
      const h = new THREE.Sprite(M.washHalo);
      h.position.set(x, top - 0.4, u); h.scale.setScalar(5);
      parent.add(h);
    }
    // spray bars: pipes up the posts and across the top, with nozzles pointing in
    for (const u of [6, 31]) {
      for (const s of [-1, 1]) {
        const px = x + this.side * s * (half - 0.35);
        cyl(parent, M.washPipe, 0.09, 0.09, top - 0.3, px, (top - 0.3) / 2, u + 0.35, 8);
        for (let y = 0.8; y < 5; y += 1.2) box(parent, M.washPipe, 0.3, 0.12, 0.12, px - this.side * s * 0.15, y, u + 0.35);
      }
      box(parent, M.washPipe, half * 2 - 0.6, 0.16, 0.16, x, top - 0.45, u + 0.35);
    }
    // signs over both ends
    const signGeo = new THREE.BoxGeometry(6.5, 1.3, 0.2);
    const plain = M.washBlue;
    for (const [u, face] of [[u0, 5], [u1, 4]]) {
      const mats6 = [plain, plain, plain, plain, plain, plain]; mats6[face] = M.washSign;
      const sign = new THREE.Mesh(signGeo, mats6);
      sign.position.set(x, top + 0.95, u + (face === 5 ? -0.3 : 0.3));
      parent.add(sign);
    }
  }

  // The moving parts of the wash: spinning brushes, water spray and bubbles.
  washParts() {
    const x = this.x(V0);
    const g = this.wash = new THREE.Group();
    this.group.add(g);
    if (!M.brushes) {
      M.brushes = [brushTexture('#2f8fe0', '#9fd4ff'), brushTexture('#ff6fae', '#ffd1e6')]
        .map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
      M.spray = new THREE.PointsMaterial({ map: glowTexture(), color: 0xcfeeff, size: 0.45, transparent: true, depthWrite: false, opacity: 0.85 });
      M.bubble = new THREE.PointsMaterial({ map: glowTexture(), size: 0.7, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 });
    }
    // two pairs of tall brushes either side, and one long one across the top
    const tallGeo = new THREE.CylinderGeometry(0.55, 0.55, 3.5, 18);
    this.brushes = [];
    for (const [u, mat] of [[14, M.brushes[0]], [19, M.brushes[1]]]) {
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(tallGeo, mat);
        b.position.set(x + this.side * s * 2.1, 2.45, u);
        b.castShadow = true;
        g.add(b);
        this.brushes.push({ mesh: b, dir: s });
      }
    }
    const topArm = new THREE.Group();
    topArm.position.set(x, 5.8, 24); topArm.rotation.z = Math.PI / 2;
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.6, 18), M.brushes[0]);
    tb.castShadow = true;
    topArm.add(tb); g.add(topArm);
    this.brushes.push({ mesh: tb, dir: 1 });

    // water: droplets squirting in from the spray bars and falling
    const SPRAY_N = 600;
    this.spray = Array.from({ length: SPRAY_N }, () => ({ p: new V3(), v: new V3(), life: 0 }));
    this.sprayGeo = new THREE.BufferGeometry();
    this.sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY_N * 3), 3));
    const sp = new THREE.Points(this.sprayGeo, M.spray);
    sp.frustumCulled = false;
    // bubbles: pastel blobs drifting up out of the brushes
    const BUB_N = 220;
    this.bubbles = Array.from({ length: BUB_N }, () => ({ p: new V3(), v: new V3(), life: 0 }));
    this.bubGeo = new THREE.BufferGeometry();
    this.bubGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUB_N * 3), 3));
    const cols = new Float32Array(BUB_N * 3), c = new THREE.Color();
    for (let i = 0; i < BUB_N; i++) { c.setHex([0xffffff, 0xd6efff, 0xffd6ec, 0xe8dcff][i % 4]); cols.set([c.r, c.g, c.b], i * 3); }
    this.bubGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const bb = new THREE.Points(this.bubGeo, M.bubble);
    bb.frustumCulled = false;
    g.add(sp, bb);
    this.washOn = 0; this.sprayAcc = 0; this.bubAcc = 0;
  }

  // Is any part of the train in (or just about to go into) the wash?
  trainInWash(train) {
    for (const car of train.cars) {
      const { u, v } = this.local(car.group.position.x, car.group.position.z);
      if (Math.abs(v - V0) < 2.5 && u > WASH_U[0] - 12 - car.length / 2 && u < WASH_U[1] + car.length / 2) return true;
    }
    return false;
  }

  updateWash(dt, train) {
    const target = train && this.trainInWash(train) ? 1 : 0;
    this.washOn += (target - this.washOn) * (1 - Math.exp(-dt * (target ? 3 : 1)));
    const on = this.washOn, x = this.x(V0);
    for (const b of this.brushes) b.mesh.rotation.y += dt * on * 7 * b.dir;
    // spray: from the nozzles on both spray bars, squirting in towards the middle
    this.sprayAcc += dt * on * 900;
    for (const p of this.spray) {
      if (p.life <= 0) {
        if (this.sprayAcc < 1) continue;
        this.sprayAcc -= 1;
        const s = Math.random() < 0.5 ? -1 : 1, overhead = Math.random() < 0.25;
        const u = (Math.random() < 0.5 ? 6 : 31) + 0.35;
        if (overhead) {
          p.p.set(x + this.side * (Math.random() * 2 - 1) * 2.3, 6.0, u);
          p.v.set((Math.random() - 0.5) * 0.6, -4 - Math.random() * 3, (Math.random() - 0.5) * 1.2);
        } else {
          p.p.set(x + this.side * s * 2.3, 0.8 + Math.floor(Math.random() * 4) * 1.2, u);
          p.v.set(-this.side * s * (5 + Math.random() * 3), 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.2);
        }
        p.life = 0.5 + Math.random() * 0.3;
      }
      p.life -= dt;
      p.v.y -= 9.8 * dt;
      p.p.addScaledVector(p.v, dt);
      if (p.p.y < -0.4) p.life = 0;
    }
    this.sprayAcc = Math.min(this.sprayAcc, 50);
    this.pointsOut(this.spray, this.sprayGeo);
    // bubbles: drifting up and away from the brushes
    this.bubAcc += dt * on * 70;
    for (const p of this.bubbles) {
      if (p.life <= 0) {
        if (this.bubAcc < 1) continue;
        this.bubAcc -= 1;
        const s = Math.random() < 0.5 ? -1 : 1;
        p.p.set(x + this.side * s * (1.6 + Math.random() * 0.6), 0.6 + Math.random() * 4, 12 + Math.random() * 14);
        p.v.set(this.side * s * (Math.random() * 0.6), 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8);
        p.life = 2 + Math.random() * 2;
      }
      p.life -= dt;
      p.p.addScaledVector(p.v, dt);
      p.p.x += Math.sin(p.life * 3 + p.p.z) * 0.3 * dt;
    }
    this.bubAcc = Math.min(this.bubAcc, 20);
    this.pointsOut(this.bubbles, this.bubGeo);
  }

  // live particles to the front of the buffer (dead ones are drawn off out of sight)
  pointsOut(list, geo) {
    const a = geo.attributes.position.array;
    let n = 0;
    for (const p of list) if (p.life > 0) { a[n * 3] = p.p.x; a[n * 3 + 1] = p.p.y; a[n * 3 + 2] = p.p.z; n++; }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
  }

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

  update(dt, train) {
    this.updateWash(dt, train);
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
    this.sprayGeo.dispose(); this.bubGeo.dispose();
    for (const o of [this.statics, this.ttGroup, this.wash]) o.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
  }
}

export class DepotManager {
  constructor(scene, net) {
    this.scene = scene; this.net = net; this.list = new Set(); this.count = 0;
    // after dark, real lights shine down inside the nearest train wash (a fixed pair, moved to
    // whichever wash is nearest: adding and removing lights would make three.js recompile shaders)
    this.washLights = [0, 1].map(() => { const l = new THREE.PointLight(0xd6ecff, 0, 26, 1.2); scene.add(l); return l; });
  }

  // Build a depot beside a depot edge, on whichever side is clear of other track. By the sea it
  // always goes on the land side, and not at all if the yard (and the ground blending into it)
  // would reach into the water.
  create(edge) {
    const d = edge.length / 2, p = edge.pointAt(d, new V3()), t = edge.tangentAt(d, new V3()); t.y = 0; t.normalize();
    let sides = this.count % 2 ? [1, -1] : [-1, 1];
    const sea = (side) => { // how close the yard comes to the sea (coast distance: > 0 is the sea), or -Infinity inland
      let most = -Infinity;
      for (let u = -U - 40; u <= U + 40; u += 20) for (let v = 0; v <= W + 40; v += 17) {
        const x = p.x + t.x * u + t.z * v * side, z = p.z + t.z * u - t.x * v * side, bw = biomeWeights(x, z);
        if (bw.ocean) most = Math.max(most, coastDistance(bw.ocean, x, z));
      }
      return most;
    };
    const seaBy = new Map(sides.map((s) => [s, sea(s)]));
    if (sides.some((s) => seaBy.get(s) > -Infinity)) sides = sides.filter((s) => seaBy.get(s) < -8).sort((a, b) => seaBy.get(a) - seaBy.get(b));
    for (const side of sides) {
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
      if (dp.edge === e || e.yard === dp) continue;
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
      const reach = dp.bank && h < dp.bed ? 2 + (dp.bed - h) * 2 : 40; // a bank about 1 in 2, or a gentle 40 m
      if (o < reach) h = mix(dp.bed, h, smooth(0, reach, o));
    }
    return h;
  }

  outside(x, z) { let o = Infinity; for (const dp of this.list) o = Math.min(o, dp.outside(x, z)); return o; }

  near(x, z, pad) { for (const dp of this.list) if (dp.outside(x, z) < pad) return dp; return null; }

  update(dt, pos, train, lights = 0) {
    let nearest = null;
    for (const dp of this.list) {
      if (dp.p.distanceTo(pos) < 700) dp.update(dt, train);
      if (!nearest || dp.washPoint.distanceToSquared(pos) < nearest.washPoint.distanceToSquared(pos)) nearest = dp;
    }
    this.washLights.forEach((l, i) => {
      l.intensity = nearest ? 40 * lights : 0;
      if (nearest) nearest.at(WASH_U[0] + (i + 0.5) * (WASH_U[1] - WASH_U[0]) / 2, V0, 5.6, l.position);
    });
  }

  // where the brushes are in the train washes near pos (for cleaning the train)
  washPoints(pos) { return [...this.list].filter((dp) => dp.washPoint.distanceTo(pos) < 300).map((dp) => dp.washPoint); }
}

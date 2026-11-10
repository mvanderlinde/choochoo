import * as THREE from 'three';
import { mulberry32, biomeWeights } from './heights.js';
import { buildNorthPole } from './northpole.js';
import { textTexture, glowTexture } from './textures.js';
import { nightGlow } from './daynight.js';

const V3 = THREE.Vector3;
// Station names to suit each biome (each world starts somewhere different in each list).
const NAMES = {
  meadow: ['Maple Hill', 'Bunny Hollow', 'Sunny Meadow', 'Duck Pond', 'Apple Orchard', 'Teddy Town', 'Rainbow Bridge',
    'Honey Creek', 'Puddle Lane', 'Cupcake Corner', 'Daisy Field', 'Lollipop Lane', 'Bumblebee Junction', 'Starlight Station',
    'Pancake Point', 'Buttercup Green', 'Ladybird Lane'],
  autumn: ['Pumpkin Patch', 'Acorn Grove', 'Maple Leaf', 'Harvest Hollow', 'Conker Corner', 'Crunchy Leaf Lane',
    'Apple Cider Junction', 'Owl Woods', 'Hazelnut Hill', 'Scarecrow Station', 'Squirrel Wood', 'Toffee Apple Town'],
  winter: ['Snowflake Junction', 'Frosty Fields', 'Icicle Hill', 'Mitten Town', 'Polar Bear Point', 'Sledge Hill',
    'Penguin Pond', 'Snowball Station', 'Igloo Bay', 'Cocoa Corner', 'Woolly Hat Hollow'],
  christmas: ['North Pole', 'Candy Cane Lane', 'Jingle Bell Junction', 'Reindeer Run', 'Tinsel Town', 'Gingerbread Village',
    'Sleigh Bell Station', 'Mistletoe Hill', 'Holly Hollow', 'Elfton', 'Snow Angel Square', 'Santa\'s Village'],
  swamp: ['Froggy Falls', 'Lily Pad Landing', 'Cattail Crossing', 'Bullfrog Bog', 'Muddy Puddle', 'Turtle Creek',
    'Dragonfly Docks', 'Croaky Hollow', 'Gator Bend', 'Newt Nook', 'Squelchy Marsh'],
  rainforest: ['Parrot Peak', 'Monkey Junction', 'Toucan Town', 'Banana Grove', 'Coconut Creek', 'Jaguar Junction',
    'Sloth Hollow', 'Mango Falls', 'Vine Valley', 'Butterfly Bay', 'Tree Frog Town'],
  mountain: ['Moose Mountain', 'Eagle Peak', 'Goat Ridge', 'Pine Valley', 'Echo Canyon', 'Marmot Meadow',
    'Summit Station', 'Snowcap Summit', 'Cloudtop', 'Pebble Pass', 'Yodel Hill'],
  ocean: ['Pebble Beach', 'Blueberry Bay', 'Seashell Shore', 'Starfish Point', 'Lighthouse Cove', 'Sandcastle Bay',
    'Dolphin Docks', 'Crab Claw Cove', 'Seagull Harbour', 'Coral Bay', 'Bucket and Spade'],
};
export const EMOJI = ['🧑', '👩', '👨', '👧', '👦', '👵', '👴', '🧒', '👩‍🦰', '👨‍🦱', '🧔', '👱'];

// ---------- little people ----------
const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.18).translate(0, -0.4, 0);
const armGeo = new THREE.BoxGeometry(0.12, 0.62, 0.14).translate(0, -0.31, 0);
const bodyGeo = new THREE.CapsuleGeometry(0.27, 0.4, 4, 10);
const headGeo = new THREE.SphereGeometry(0.22, 14, 10);
const hatGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.16, 12);
const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  return matCache.get(c);
};
const SHIRTS = [0xe63946, 0x2a9d8f, 0xf4a261, 0x457b9d, 0x9b5de5, 0xffbe0b, 0x06d6a0, 0xff70a6];
const PANTS = [0x264653, 0x3d405b, 0x5c4033, 0x1d3557];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const pick = (a, r) => a[Math.floor(r() * a.length)];

class Person {
  constructor(scene, pos, rand, emoji) {
    this.scene = scene;
    this.emoji = emoji ?? pick(EMOJI, rand);
    const g = this.group = new THREE.Group();
    const part = (geo, m, x, y, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, 0); o.castShadow = true; parent.add(o); return o; };
    const pants = mat(pick(PANTS, rand)), shirt = mat(pick(SHIRTS, rand)), skin = mat(pick(SKIN, rand));
    this.legs = [0.1, -0.1].map((x) => { const p = new THREE.Group(); p.position.set(x, 0.85, 0); g.add(p); part(legGeo, pants, 0, 0, p); return p; });
    part(bodyGeo, shirt, 0, 1.25);
    this.arms = [0.36, -0.36].map((x) => { const p = new THREE.Group(); p.position.set(x, 1.6, 0); g.add(p); part(armGeo, shirt, 0, 0, p); return p; });
    part(headGeo, skin, 0, 1.92);
    if (rand() < 0.4) part(hatGeo, mat(pick(SHIRTS, rand)), 0, 2.12);
    g.scale.setScalar(0.85);
    g.position.copy(pos);
    scene.add(g);
    this.waypoints = [];
    this.speed = 1.5 + rand() * 0.4;
    this.t = rand() * 10;
    this.wave = false;
    this.facing = null;
  }

  walkTo(points, onArrive) { this.waypoints = points.map((p) => p.clone()); this.onArrive = onArrive; }

  update(dt) {
    this.t += dt;
    const g = this.group;
    if (this.waypoints.length) {
      const tgt = this.waypoints[0];
      const dx = tgt.x - g.position.x, dz = tgt.z - g.position.z, d = Math.hypot(dx, dz), step = this.speed * dt;
      g.position.y += (tgt.y - g.position.y) * Math.min(1, dt * 6);
      if (d <= step) {
        g.position.x = tgt.x; g.position.z = tgt.z;
        this.waypoints.shift();
        if (!this.waypoints.length) { const cb = this.onArrive; this.onArrive = null; cb?.(this); }
      } else {
        g.position.x += (dx / d) * step; g.position.z += (dz / d) * step;
        g.rotation.y = Math.atan2(dx, dz);
      }
      const sw = Math.sin(this.t * 9) * 0.6;
      this.legs[0].rotation.x = sw; this.legs[1].rotation.x = -sw;
      this.arms[0].rotation.x = -sw * 0.8; this.arms[1].rotation.x = sw * 0.8;
      this.arms[1].rotation.z = 0;
    } else {
      this.legs[0].rotation.x = this.legs[1].rotation.x = 0;
      this.arms[0].rotation.x = 0; this.arms[1].rotation.x = 0;
      this.arms[1].rotation.z = this.wave ? -2.6 + Math.sin(this.t * 10) * 0.35 : 0;
      if (this.facing !== null) g.rotation.y = this.facing;
    }
  }

  dispose() { this.scene.remove(this.group); }
}

// ---------- stations ----------
// platform lamps: shared materials that glow after dark
const lampMat = nightGlow(new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffd58a }), 'emissiveIntensity', 3);
const lampHalo = nightGlow(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd99a, transparent: true, depthWrite: false }), 'opacity', 0.85);
const lampGeo = new THREE.BoxGeometry(0.7, 0.18, 1.4);
const postGeo = new THREE.CylinderGeometry(0.1, 0.13, 4.6, 8).translate(0, 2.3, 0);
const lampHeadGeo = new THREE.SphereGeometry(0.32, 14, 10);
const LIGHTS_PER_STATION = 2, LIGHT_POOL = 4; // real lights for the nearest stations only

class Station {
  // empty: nobody waiting and nothing to do here (the station the ride starts at)
  constructor(scene, edge, name, seed, empty = false, biome = 'meadow') {
    const rand = this.rand = mulberry32(seed);
    this.scene = scene; this.edge = edge; this.name = name; this.biome = biome;
    const L = edge.length;
    this.trackPos = edge.pointAt(L / 2, new V3());
    this.t = edge.tangentAt(L / 2, new V3()); this.t.y = 0; this.t.normalize();
    const side = rand() < 0.5 ? 1 : -1;
    this.s = new V3(-this.t.z, 0, this.t.x).multiplyScalar(side); // track -> platform
    this.platform = this.trackPos.clone().addScaledVector(this.s, 3.9);
    this.platformTop = this.trackPos.y + 0.9;
    this.townY = this.trackPos.y - 0.5;
    this.townR = 105;
    this.served = empty;
    this.busy = false;
    this.timers = [];
    this.people = [];
    this.group = this.buildPlatform(-side);
    if (biome === 'christmas') { this.decor = buildNorthPole(this, rand); scene.add(this.decor); } // it's the North Pole!
    this.buildSpots();

    this.waiting = [];
    const n = empty ? 0 : 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const p = this.platform.clone().addScaledVector(this.t, (rand() - 0.5) * 30).addScaledVector(this.s, rand() * 0.8 - 0.2);
      p.y = this.platformTop;
      const person = new Person(scene, p, rand);
      person.facing = Math.atan2(-this.s.x, -this.s.z);
      this.people.push(person);
      this.waiting.push(person);
    }
  }

  buildPlatform(away) {
    const g = new THREE.Group();
    g.position.copy(this.platform);
    g.lookAt(this.platform.clone().add(this.t)); // local +z = along track; local x * away = away from track
    const add = (geo, color, x, y, z) => {
      const m = new THREE.Mesh(geo, color.isMaterial ? color : mat(color));
      m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    add(new THREE.BoxGeometry(3.6, 1.6, 40), 0xbdbdbd, 0, 0.1, 0);
    add(new THREE.BoxGeometry(0.3, 0.02, 40), 0xffd400, -away * 1.5, 0.91, 0);
    for (const z of [-10, -3.3, 3.3, 10]) add(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8), 0x444444, away * 0.6, 2.7, z);
    add(new THREE.BoxGeometry(4.4, 0.25, 26), 0xd23c3c, 0, 4.5, 0);
    add(new THREE.BoxGeometry(6, 4.5, 11), 0xf3e2c0, away * 5.5, 1.4, 0);
    add(new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4), 0xb5442f, away * 5.5, 5.0, 0).scale.set(7, 2.6, 12);
    // lamps under the canopy and lamp posts at the platform ends
    for (const z of [-9, -3, 3, 9]) {
      const l = add(lampGeo, lampMat, away * 0.2, 4.28, z); l.castShadow = false;
      const h = new THREE.Sprite(lampHalo); h.position.set(away * 0.2, 4.1, z); h.scale.setScalar(2.6); g.add(h);
    }
    for (const z of [-17, 17]) {
      add(postGeo, 0x3a3f47, away * 1.1, 0.9, z);
      const b = add(lampHeadGeo, lampMat, away * 1.1, 5.6, z); b.castShadow = false;
      const h = new THREE.Sprite(lampHalo); h.position.set(away * 1.1, 5.6, z); h.scale.setScalar(3.2); g.add(h);
    }
    g.updateMatrixWorld();
    this.lightSpots = [-10, 10].map((z) => g.localToWorld(new V3(0, 3.6, z)));
    // name boards, back to back so they read from either side
    const tex = textTexture(this.name);
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.PlaneGeometry(9, 1.8);
    for (const flip of [0, Math.PI]) {
      const b = add(geo, signMat, away * 1.75, 3.3, 0);
      b.rotation.y = -away * Math.PI / 2 + flip;
      b.castShadow = false;
    }
    this.scene.add(g);
    return g;
  }

  // Building lots for the little town around the station (placed by the terrain chunks).
  buildSpots() {
    const r = this.rand;
    this.spots = [];
    const yaw = Math.atan2(this.t.x, this.t.z);
    for (let u = -102; u <= 102; u += 17) for (let v = -102; v <= 102; v += 17) {
      if (Math.abs(v) < 24 || (Math.abs(v) < 30 && Math.abs(u) < 12)) continue;
      const uu = u + (r() - 0.5) * 3, vv = v + (r() - 0.5) * 3;
      const rad = Math.hypot(uu, vv);
      if (rad > this.townR - 5 + r() * 12) continue;
      const tall = Math.abs(v) > 40 && rad < 70 && r() < 0.6;
      this.spots.push({
        x: this.trackPos.x + this.t.x * uu + this.s.x * vv, z: this.trackPos.z + this.t.z * uu + this.s.z * vv,
        w: 8 + r() * 5, d: 8 + r() * 5, h: tall ? 12 + r() * 20 : 5 + r() * 3, tall, yaw,
        mat: Math.floor(r() * 7), roof: Math.floor(r() * 4),
      });
    }
  }

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  // Coach doors that are lined up with this platform, as world positions.
  doorsFor(train) {
    const out = [], xw = new V3();
    for (const car of train.cars) {
      if (!car.doors) continue;
      const g = car.group;
      xw.set(1, 0, 0).applyQuaternion(g.quaternion);
      const sideSign = xw.dot(this.s) > 0 ? 1 : -1;
      for (const dz of car.doors) {
        const p = g.localToWorld(new V3(sideSign * 1.5, 0, dz));
        const rel = p.clone().sub(this.trackPos);
        const along = rel.dot(this.t), lat = Math.abs(rel.x * this.s.x + rel.z * this.s.z);
        if (Math.abs(along) < 19 && lat < 3) out.push(p);
      }
    }
    return out;
  }

  // Called while the train is stopped. Returns true if a stop started here.
  startStop(train, hooks) {
    if (this.served) return false;
    const doors = this.doorsFor(train);
    if (!doors.length) return false;
    this.served = true; this.busy = true;
    const r = this.rand;
    let pending = 0;
    const finish = () => { this.busy = false; hooks.done(this); };
    const onPlatform = (p, out) => { const q = p.clone().addScaledVector(this.s, out); q.y = this.platformTop; return q; };

    // some passengers get off and walk into the station
    const nOff = Math.min(train.passengers.length, 1 + Math.floor(r() * 3) + (train.passengers.length > 9 ? 2 : 0));
    for (let i = 0; i < nOff; i++) {
      const door = doors[Math.floor(r() * doors.length)];
      pending++;
      this.after(0.3 + i * 0.8, () => {
        const emoji = train.passengers.splice(Math.floor(r() * train.passengers.length), 1)[0];
        hooks.changed();
        hooks.pop();
        const p = new Person(this.scene, onPlatform(door, 0.6), r, emoji);
        this.people.push(p);
        const exit = onPlatform(this.platform.clone().addScaledVector(this.t, (r() - 0.5) * 4), 1.6);
        p.walkTo([onPlatform(door, 1.4), exit], (pp) => { this.removePerson(pp); if (--pending === 0) finish(); });
      });
    }
    // everyone waiting walks to the nearest door and gets on
    this.waiting.forEach((p, i) => {
      pending++;
      let best = doors[0];
      for (const d of doors) if (d.distanceTo(p.group.position) < best.distanceTo(p.group.position)) best = d;
      this.after(0.8 + i * 0.7, () => {
        p.wave = false;
        p.walkTo([onPlatform(best, 1.0), onPlatform(best, -0.4)], (pp) => {
          this.removePerson(pp);
          train.passengers.push(pp.emoji);
          hooks.changed();
          hooks.pop();
          if (--pending === 0) finish();
        });
      });
    });
    this.waiting = [];
    if (pending === 0) finish();
    return true;
  }

  removePerson(p) { p.dispose(); this.people = this.people.filter((x) => x !== p); }

  update(dt, train) {
    const near = train.loco.group.position.distanceTo(this.trackPos) < 160;
    for (const p of this.waiting) p.wave = near;
    for (const tm of this.timers) tm.t -= dt;
    const due = this.timers.filter((tm) => tm.t <= 0);
    this.timers = this.timers.filter((tm) => tm.t > 0);
    for (const tm of due) tm.fn();
    for (const p of this.people) p.update(dt);
  }

  dispose() {
    for (const p of this.people) p.dispose();
    this.scene.remove(this.group);
    this.group.traverse((c) => c.geometry?.dispose());
    if (this.decor) { this.scene.remove(this.decor); this.decor.traverse((c) => { if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose(); }); }
  }
}

export class StationManager {
  constructor(scene, seed = 0) {
    this.scene = scene; this.list = new Set(); this.count = 0;
    const r = mulberry32(seed);
    this.nameNext = Object.fromEntries(Object.keys(NAMES).map((b) => [b, Math.floor(r() * NAMES[b].length)])); // each world starts somewhere different
    // a fixed pool of point lights (adding/removing lights would make three.js recompile shaders)
    this.lights = Array.from({ length: LIGHT_POOL }, () => {
      const l = new THREE.PointLight(0xffd59a, 0, 38, 1.2);
      scene.add(l);
      return l;
    });
    this.lightsOn = 0;
  }
  create(edge) {
    // which biome is the station in? (the one there's most of)
    const mid = edge.pointAt(edge.length / 2, new V3()), w = biomeWeights(mid.x, mid.z).w;
    let biome = 'meadow';
    for (const b in w) if (w[b] > (w[biome] ?? 0)) biome = b;
    const list = NAMES[biome], name = list[this.nameNext[biome]++ % list.length];
    const st = new Station(this.scene, edge, name, 1000 + this.count * 7919, this.count === 0, biome);
    this.count++;
    edge.station = st;
    this.list.add(st);
    return st;
  }
  remove(st) { st.dispose(); this.list.delete(st); }
  update(dt, train, lights = 0) {
    for (const st of this.list) st.update(dt, train);
    // the nearest stations get the real lights
    const lp = train.loco.group.position;
    const near = [...this.list].sort((a, b) => a.trackPos.distanceToSquared(lp) - b.trackPos.distanceToSquared(lp));
    this.lights.forEach((l, i) => {
      const st = near[Math.floor(i / LIGHTS_PER_STATION)];
      if (!st) { l.intensity = 0; return; }
      l.position.copy(st.lightSpots[i % LIGHTS_PER_STATION]);
      l.intensity = 30 * lights;
    });
  }
}

import * as THREE from 'three';
import { makeLoco, makeTender, makeCoach } from './models.js';
import { RAIL_TOP } from './tracks.js';
import { puffTexture } from './textures.js';

const MAX_SPEED = 20, ACCEL = 4.5, BRAKE = 9;

export class Train {
  constructor(scene, net, edge, d) {
    this.net = net;
    this.edge = edge;
    this.d = d;
    this.passengers = ['👩', '👴', '👧'];
    this.speed = 0;
    this.history = [];
    this.choice = null; // 'left' | 'right' | null (null = stay on main line)

    this.cars = [makeLoco(), makeTender(), makeCoach(0x2f7fd8), makeCoach(0xf2b632), makeCoach(0x3fae5a)];
    let cursor = 0;
    for (const car of this.cars) {
      car.center = cursor - car.length / 2;
      cursor -= car.length + 0.6;
      scene.add(car.group);
    }
    this.loco = this.cars[0];
    this.cars[this.cars.length - 1].tail.visible = true;

    this.puffs = [];
    const tex = puffTexture();
    for (let i = 0; i < 60; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this.puffTimer = 0;
    this.steamShade = 1; // dimmed at night by main (the puffs aren't lit)
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.update(0, 0);
  }

  choose(side) { this.choice = side; }
  resolvedSide(node) { return node ? (this.choice ?? node.defaultSide) : null; }

  nextEdge(e) {
    const n = e.to;
    if (!n.outs.length) this.net.generateOuts(n);
    if (!n.isJunction) return n.outs[0];
    return this.resolvedSide(n) === 'left' ? n.left : n.right;
  }

  upcomingJunction() {
    let e = this.edge, dist = e.length - this.d;
    for (let i = 0; i < 4; i++) {
      if (e.to.isJunction) return { node: e.to, dist };
      e = this.nextEdge(e);
      dist += e.length;
    }
    return null;
  }

  // Edges along the chosen route ahead, with the distance from the train's head to each edge's start.
  routeAhead(maxDist) {
    const out = [{ edge: this.edge, start: -this.d }];
    let e = this.edge, dist = e.length - this.d;
    while (dist < maxDist) {
      e = this.nextEdge(e);
      out.push({ edge: e, start: dist });
      dist += e.length;
    }
    return out;
  }

  // Point on the track at offset o (meters) from the head of the train; negative = behind.
  pointAt(o, target) {
    let d = this.d + o, e = this.edge;
    if (d > e.length) { d -= e.length; e = this.nextEdge(e); return e.pointAt(d, target); }
    let i = this.history.length - 1;
    while (d < 0 && i >= 0) { e = this.history[i--]; d += e.length; }
    return e.pointAt(Math.max(0, d), target);
  }

  update(dt, throttle) {
    if (throttle > 0) this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    else if (throttle < 0) this.speed = Math.max(0, this.speed - BRAKE * dt);
    const ds = this.speed * dt;
    this.d += ds;
    while (this.d > this.edge.length) {
      const ed = this.edge;
      this.d -= ed.length;
      const nx = this.nextEdge(ed);
      if (ed.to.isJunction) this.choice = null;
      this.history.push(ed);
      if (this.history.length > 5) this.history.shift();
      this.edge = nx;
    }

    for (const car of this.cars) {
      const pf = this.pointAt(car.center + car.length * 0.35, this._a);
      const pb = this.pointAt(car.center - car.length * 0.35, this._b);
      car.group.position.copy(pf).add(pb).multiplyScalar(0.5);
      car.group.position.y += RAIL_TOP;
      pf.y += RAIL_TOP;
      car.group.lookAt(pf);
      for (const w of car.wheels) w.mesh.rotation.x += ds / w.r;
    }
    this.updateSteam(dt);
  }

  updateSteam(dt) {
    this.puffTimer += dt * (1.5 + this.speed * 0.6);
    while (this.puffTimer >= 1) {
      this.puffTimer -= 1;
      const p = this.puffs.find((p) => !p.s.visible);
      if (!p) break;
      this.loco.group.localToWorld(p.s.position.copy(this.loco.chimneyTop));
      p.vel.set((Math.random() - 0.5) * 1.2, 3 + Math.random() * 2, (Math.random() - 0.5) * 1.2);
      p.life = 0; p.max = 1.8 + Math.random() * 1.2;
      p.s.visible = true;
    }
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const f = p.life / p.max;
      if (f >= 1) { p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(1.2 + f * 6);
      p.s.material.opacity = 0.8 * (1 - f);
      p.s.material.color.setScalar(this.steamShade);
    }
  }
}

import * as THREE from 'three';
import { smooth, mix } from './heights.js';
import { glowTexture } from './textures.js';

// The clock: the sun rises and sets, then the moon and stars come out. Anything that should
// glow after dark registers itself with nightGlow(); at dusk the lights fade on, at dawn they
// fade off again.

const SECONDS_PER_HOUR = 20; // a whole day in about 6 minutes (nights go twice as fast)
const LIGHTS_ON_BELOW = 0.06; // sun height (sin of elevation) at which the lights switch

// [object, property, value when fully lit, 'train' to also light up inside tunnels]
const glowing = [];
export function nightGlow(obj, prop, max, train = false) {
  glowing.push({ obj, prop, max, train });
  obj[prop] = 0;
  if (prop === 'opacity') obj.visible = false;
  return obj;
}
// a copy of a material that glows at night glows like the original
export function glowCopy(src, dst) {
  for (const g of glowing.filter((g) => g.obj === src)) glowing.push({ ...g, obj: dst });
}

export class DayNight {
  constructor(scene, hour = 9) {
    this.hour = hour;
    this.lights = this.lightsTarget() ? 1 : 0;
    this.trainLights = this.lights;
    this.sunDir = new THREE.Vector3();
    this.computeSun();

    // stars: a dome of little dots that fade in on clear nights
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 * Math.PI, v = Math.random() * 0.95 + 0.05; // upper half only
      const r = Math.sqrt(1 - v * v);
      pos.set([Math.cos(u) * r * 2000, v * 2000, Math.sin(u) * r * 2000], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.renderOrder = -0.5;
    this.stars.frustumCulled = false;

    // a big friendly moon (and a soft halo round it)
    const tex = glowTexture();
    this.moon = new THREE.Group();
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(55, 32), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, transparent: true }));
    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xcfe0ff, fog: false, transparent: true, depthWrite: false }));
    this.moonHalo.scale.setScalar(420);
    this.moon.add(this.moonHalo, this.moonDisc);
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffd9a0, fog: false, transparent: true, depthWrite: false }));
    this.sunHalo.scale.setScalar(700);
    for (const o of [this.moonDisc.material, this.moonHalo.material, this.sunHalo.material]) o.depthWrite = false;
    this.moon.renderOrder = this.sunHalo.renderOrder = -0.4;
    scene.add(this.stars, this.moon, this.sunHalo);
  }

  lightsTarget() { return Math.sin(((this.hour - 6) / 24) * 2 * Math.PI) < LIGHTS_ON_BELOW; }

  computeSun() {
    const a = ((this.hour - 6) / 24) * 2 * Math.PI;
    this.sunHeight = Math.sin(a);                       // -1 midnight .. 1 noon
    this.sunDir.set(Math.cos(a) * 0.9, Math.sin(a), 0.5).normalize();
    const s = this.sunHeight;
    this.day = smooth(-0.15, 0.25, s);                  // 0 night .. 1 full daylight
    this.night = 1 - this.day;
    this.sunset = smooth(-0.22, 0.0, s) * (1 - smooth(0.05, 0.35, s)); // orange glow near the horizon
    this.sunK = smooth(0, 0.2, s);                      // directional light from the sun
    this.moonK = smooth(0, 0.2, -s);                    // ... or from the moon
  }

  // sheltered: 0..1, 1 = in a tunnel (the train's lamps come on there too)
  update(dt, camera, overcast, sheltered) {
    this.hour = (this.hour + dt / SECONDS_PER_HOUR * (this.sunHeight < 0 ? 2 : 1)) % 24;
    this.computeSun();
    const want = this.lightsTarget() ? 1 : 0;
    this.lights = want > this.lights ? Math.min(1, this.lights + dt * 0.8) : Math.max(0, this.lights - dt * 0.8);
    this.trainLights = Math.max(this.lights, sheltered);
    for (const g of glowing) {
      const v = g.max * (g.train ? this.trainLights : this.lights);
      g.obj[g.prop] = v;
      if (g.prop === 'opacity') g.obj.visible = v > 0.005;
    }

    const cp = camera.position, clear = 1 - overcast;
    this.stars.position.copy(cp);
    this.stars.rotation.y = this.hour * 0.05;
    this.starMat.opacity = smooth(0.5, 0.95, this.night) * clear * 0.9;
    this.moon.position.copy(cp).addScaledVector(this.sunDir, -2200);
    this.moon.lookAt(cp);
    this.moonDisc.material.opacity = smooth(0.2, 0.7, this.night) * mix(1, 0.15, overcast);
    this.moonHalo.material.opacity = this.moonDisc.material.opacity * 0.35;
    this.sunHalo.position.copy(cp).addScaledVector(this.sunDir, 2200);
    this.sunHalo.material.opacity = smooth(-0.08, 0.05, this.sunHeight) * clear * 0.55;
    this.sunHalo.material.color.setHex(0xfff1c0).lerp(new THREE.Color(0xff9a4a), this.sunset);
  }
}

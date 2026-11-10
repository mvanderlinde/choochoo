import * as THREE from 'three';
import { biomeWeights, snowiness, wetness, smooth, mix } from './heights.js';
import { ICON } from './biomes.js';
import { glowTexture, leafTexture } from './textures.js';
import { SKY_TOP, SKY_HORIZON } from './world.js';

// Weather follows the train around the world: sunny, cloudy, rain, or falling snow, with the
// sky, fog, light, clouds, lakes (frozen in winter) and a rain sound all following along.

const RAIN_N = 4500, SNOW_N = 3200, LEAF_N = 700;
// lakes and sea take on the biome's colour; swamps and rainforests are misty
const WATER = { meadow: 0x2f86d0, autumn: 0x3a7fb4, winter: 0x2f86d0, christmas: 0x2f86d0, swamp: 0x2f4f4a, rainforest: 0x2a8f8a, mountain: 0x3a92c8, ocean: 0x1c6fc2 };
const MIST = { swamp: 0.75, rainforest: 0.4 };
const MIST_COLOR = { swamp: 0xa7b391, rainforest: 0xc4d8cc };
const LEAF_COLORS = [0xd9641e, 0xc0392b, 0xe8b02e, 0xb5651d, 0xf2a03d];
const BOX = 45, TOP = 30, BOTTOM = -8; // particle box around the camera

const C = (h) => new THREE.Color(h);
const SUNNY = { top: C(SKY_TOP), horizon: C(SKY_HORIZON) };
const GREY = { top: C(0x7d8896), horizon: C(0xb3bcc6) };
const WINTER = { top: C(0x9fb2c6), horizon: C(0xe4eaf0) };
const NIGHT = { top: C(0x0b1630), horizon: C(0x27375a) };
const SUNSET = { top: C(0x4a5fa8), horizon: C(0xff9d5c) };
const SUN_WHITE = C(0xfff3dd), SUN_LOW = C(0xffa060), MOON = C(0xa9c0ff);
const HEMI_DAY = C(0xdff1ff), HEMI_NIGHT = C(0x6d82c0);
const ICONS = [['☀️', 0], ['⛅', 0.3], ['☁️', 0.65]];
const NIGHT_ICONS = [['🌙', 0], ['☁️', 0.45]];

export class Weather {
  constructor(scene, world, { sun, hemi, sound }) {
    this.scene = scene; this.world = world; this.sun = sun; this.hemi = hemi; this.sound = sound;
    this.s = null; // smoothed state
    this.time = 0;

    // rain: short falling streaks
    const rp = new Float32Array(RAIN_N * 6);
    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0xa9bccf, transparent: true, opacity: 0.7, fog: false }));
    this.rain.frustumCulled = false;
    this.rainDrops = Array.from({ length: RAIN_N }, () => ({ x: 0, y: 0, z: 0, v: 24 + Math.random() * 8 }));

    // snow: soft white flakes that drift and sway
    const sp = new Float32Array(SNOW_N * 3);
    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snow = new THREE.Points(this.snowGeo, new THREE.PointsMaterial({
      map: glowTexture(), size: 0.8, transparent: true, depthWrite: false, opacity: 0.95, fog: false,
    }));
    this.snow.frustumCulled = false;
    this.flakes = Array.from({ length: SNOW_N }, () => ({ x: 0, y: 0, z: 0, v: 1.6 + Math.random() * 1.4, ph: Math.random() * 6.28 }));
    // autumn: leaves tumbling down
    this.leafGeo = new THREE.BufferGeometry();
    this.leafGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEAF_N * 3), 3));
    const lc = new Float32Array(LEAF_N * 3), col = new THREE.Color();
    for (let i = 0; i < LEAF_N; i++) { col.setHex(LEAF_COLORS[i % LEAF_COLORS.length]); lc.set([col.r, col.g, col.b], i * 3); }
    this.leafGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    this.leafMat = new THREE.PointsMaterial({ map: leafTexture(), size: 0.7, vertexColors: true, transparent: true, alphaTest: 0.3, fog: true });
    this.leaves = new THREE.Points(this.leafGeo, this.leafMat);
    this.leaves.frustumCulled = false;
    this.leafList = Array.from({ length: LEAF_N }, () => ({ x: 0, y: 0, z: 0, v: 0.9 + Math.random() * 0.9, ph: Math.random() * 6.28 }));
    this.placed = false;
    scene.add(this.rain, this.snow, this.leaves);
    this.waterColor = new THREE.Color(); this.mistColor = new THREE.Color(); this._c = new THREE.Color();

    this.waterSummer = world.water.material.color.clone();
    this.waterIce = C(0xd6e6ef);
    this.cloudWhite = C(0xffffff); this.cloudGrey = C(0x8f99a4);
    this.iconEl = document.getElementById('weather');
    this.icon = '';
  }

  // What the weather "wants" to be at this spot right now.
  target(p) {
    const bw = biomeWeights(p.x, p.z), wet = wetness(p.x, p.z, this.time, bw);
    const precip = smooth(0.08, 0.26, wet);
    const snowy = snowiness(bw); // falling snow vs rain
    const w = bw.w, t = {
      cloud: smooth(-0.06, 0.16, wet),
      rain: precip * (1 - snowy),
      snowfall: precip * snowy,
      ground: snowy,
      leaves: (w.autumn ?? 0) * (1 - precip),
      mist: 0,
    };
    for (const b in w) t.mist += w[b] * (MIST[b] ?? 0);
    this.bw = bw;
    return t;
  }

  // sheltered: 0..1, 1 = inside a tunnel (no rain or snow there)
  // dn: the DayNight clock (sun height, night amount, sunset glow)
  update(dt, pos, camera, sheltered, dn) {
    this.time += dt;
    const t = this.target(pos);
    if (!this.s) this.s = { ...t };
    const k = 1 - Math.exp(-dt * 0.35); // weather changes over a few seconds
    for (const key in t) this.s[key] = mix(this.s[key], t[key], k);
    const s = this.s;
    const out = 1 - sheltered;

    // sky, fog, light
    const overcast = Math.max(s.cloud, s.rain, s.snowfall);
    this.overcast = overcast;
    const wintry = Math.max(s.ground * 0.6, s.snowfall);
    const sky = this.world.skyMat.uniforms;
    const top = sky.top.value, hor = sky.bottom.value;
    top.copy(SUNNY.top).lerp(WINTER.top, wintry * 0.6).lerp(GREY.top, overcast * 0.85);
    hor.copy(SUNNY.horizon).lerp(WINTER.horizon, wintry).lerp(s.snowfall > s.rain ? WINTER.horizon : GREY.horizon, overcast * 0.85);
    // evening: orange glow low in the sky, then deep blue night
    const glow = dn.sunset * (1 - overcast * 0.7);
    top.lerp(SUNSET.top, glow * 0.6).lerp(NIGHT.top, dn.night);
    hor.lerp(SUNSET.horizon, glow).lerp(NIGHT.horizon, dn.night * mix(1, 0.85, overcast));
    // swamp and rainforest mist
    this.mistColor.setRGB(0, 0, 0);
    let mw = 0;
    for (const b in this.bw.w) if (MIST_COLOR[b]) { this.mistColor.add(this._c.setHex(MIST_COLOR[b]).multiplyScalar(this.bw.w[b])); mw += this.bw.w[b]; }
    if (mw > 0) hor.lerp(this.mistColor.multiplyScalar(1 / mw), s.mist * 0.6 * (1 - dn.night));
    this.scene.fog.color.copy(hor);
    this.scene.background.copy(hor);
    const heavy = Math.max(s.rain, s.snowfall, s.mist * 0.8);
    this.scene.fog.near = mix(250, 70, heavy);
    this.scene.fog.far = mix(820, 380, heavy);
    // the one directional light is the sun by day and the moon by night
    const sunI = mix(2.6, 0.7, overcast);
    this.sun.intensity = dn.sunK * sunI + dn.moonK * mix(0.55, 0.15, overcast);
    this.sun.color.copy(SUN_WHITE).lerp(SUN_LOW, dn.sunset);
    if (dn.sunHeight < 0) this.sun.color.copy(MOON);
    this.hemi.intensity = mix(mix(1.2, 1.55, overcast), 0.5, dn.night);
    this.hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, dn.night);

    // clouds get grey and puffy, lakes freeze in winter
    this.world.cloudMat.color.copy(this.cloudWhite).lerp(this.cloudGrey, overcast).lerp(SUNSET.horizon, glow * 0.5);
    this.world.cloudMat.emissiveIntensity = mix(0.35, 0.12, overcast) * mix(1, 0.15, dn.night);
    for (const c of this.world.clouds) c.scale.setScalar(1 + overcast * 0.9);
    const w = this.world.water.material;
    this.waterColor.setRGB(0, 0, 0);
    for (const b in this.bw.w) this.waterColor.add(this._c.setHex(WATER[b]).multiplyScalar(this.bw.w[b]));
    if (!this.waterSmooth) this.waterSmooth = this.waterColor.clone();
    this.waterSmooth.lerp(this.waterColor, k);
    w.color.copy(this.waterSmooth).lerp(this.waterIce, s.ground);
    w.roughness = mix(0.15, 0.5, s.ground);
    // falling rain and snow aren't lit, so dim them by hand at night
    const dim = mix(1, 0.4, dn.night);
    this.snow.material.color.setScalar(dim);
    this.leafMat.color.setScalar(mix(1, 0.35, dn.night));
    this.rain.material.color.setHex(0xa9bccf).multiplyScalar(dim);

    this.updateParticles(dt, camera.position, s.rain * out, s.snowfall * out, s.leaves * out);
    this.sound?.setRain(s.rain * out);

    // corner icon for little weather watchers
    // plus a picture of the biome we're in
    let main = 'meadow';
    for (const b in this.bw.w) if (this.bw.w[b] > (this.bw.w[main] ?? 0)) main = b;
    const skyIcon = s.snowfall > 0.25 ? '🌨️' : s.rain > 0.25 ? '🌧️' : (dn.night > 0.6 ? NIGHT_ICONS : ICONS).filter(([, c]) => overcast >= c).pop()[0];
    const icon = skyIcon + (this.bw.w[main] > 0.6 ? ICON[main] ?? '' : '');
    if (icon !== this.icon && this.iconEl) { this.icon = icon; this.iconEl.textContent = icon; }
  }

  updateParticles(dt, cp, rain, snow, leaves = 0) {
    const wrap = (p) => {
      if (p.x - cp.x > BOX) p.x -= 2 * BOX; else if (p.x - cp.x < -BOX) p.x += 2 * BOX;
      if (p.z - cp.z > BOX) p.z -= 2 * BOX; else if (p.z - cp.z < -BOX) p.z += 2 * BOX;
    };
    const spawn = (p, anywhere) => {
      p.x = cp.x + (Math.random() * 2 - 1) * BOX;
      p.z = cp.z + (Math.random() * 2 - 1) * BOX;
      p.y = cp.y + (anywhere ? BOTTOM + Math.random() * (TOP - BOTTOM) : TOP);
    };
    if (!this.placed) { for (const list of [this.rainDrops, this.flakes, this.leafList]) for (const p of list) spawn(p, true); this.placed = true; }

    const nl = Math.round(LEAF_N * leaves);
    this.leaves.visible = nl > 0;
    if (nl > 0) {
      const a = this.leafGeo.attributes.position.array;
      for (let i = 0; i < nl; i++) {
        const p = this.leafList[i];
        p.y -= p.v * dt; p.ph += dt * 2.1;
        p.x += (Math.sin(p.ph) * 1.6 + 0.8) * dt; p.z += Math.cos(p.ph * 0.8) * 1.2 * dt; // flutter
        if (p.y < cp.y + BOTTOM) spawn(p, false);
        wrap(p);
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      }
      this.leafGeo.setDrawRange(0, nl);
      this.leafGeo.attributes.position.needsUpdate = true;
    }

    const nr = Math.round(RAIN_N * rain);
    this.rain.visible = nr > 0;
    if (nr > 0) {
      const a = this.rainGeo.attributes.position.array;
      for (let i = 0; i < nr; i++) {
        const p = this.rainDrops[i];
        p.y -= p.v * dt; p.x += 2 * dt;
        if (p.y < cp.y + BOTTOM) spawn(p, false);
        wrap(p);
        a.set([p.x, p.y, p.z, p.x - 0.1, p.y + 1.4, p.z], i * 6);
      }
      this.rainGeo.setDrawRange(0, nr * 2);
      this.rainGeo.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.35 + 0.45 * rain;
    }

    const ns = Math.round(SNOW_N * snow);
    this.snow.visible = ns > 0;
    if (ns > 0) {
      const a = this.snowGeo.attributes.position.array;
      for (let i = 0; i < ns; i++) {
        const p = this.flakes[i];
        p.y -= p.v * dt; p.ph += dt * 1.3;
        p.x += (Math.sin(p.ph) * 0.8 + 0.6) * dt; p.z += Math.cos(p.ph * 0.7) * 0.6 * dt;
        if (p.y < cp.y + BOTTOM) spawn(p, false);
        wrap(p);
        a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
      }
      this.snowGeo.setDrawRange(0, ns);
      this.snowGeo.attributes.position.needsUpdate = true;
    }
  }
}

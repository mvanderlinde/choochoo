import * as THREE from 'three';
import { coldness, groundSnow, wetness, smooth, mix } from './heights.js';
import { glowTexture } from './textures.js';
import { SKY_TOP, SKY_HORIZON } from './world.js';

// Weather follows the train around the world: sunny, cloudy, rain, or falling snow, with the
// sky, fog, light, clouds, lakes (frozen in winter) and a rain sound all following along.

const RAIN_N = 4500, SNOW_N = 3200;
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
    this.placed = false;
    scene.add(this.rain, this.snow);

    this.waterSummer = world.water.material.color.clone();
    this.waterIce = C(0xd6e6ef);
    this.cloudWhite = C(0xffffff); this.cloudGrey = C(0x8f99a4);
    this.iconEl = document.getElementById('weather');
    this.icon = '';
  }

  // What the weather "wants" to be at this spot right now.
  target(p) {
    const cold = coldness(p.x, p.z), wet = wetness(p.x, p.z, this.time);
    const precip = smooth(0.08, 0.26, wet);
    const snowy = smooth(0.03, 0.09, cold); // falling snow vs rain
    return {
      cloud: smooth(-0.06, 0.16, wet),
      rain: precip * (1 - snowy),
      snowfall: precip * snowy,
      ground: groundSnow(p.x, p.z),
    };
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
    this.scene.fog.color.copy(hor);
    this.scene.background.copy(hor);
    const heavy = Math.max(s.rain, s.snowfall);
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
    w.color.copy(this.waterSummer).lerp(this.waterIce, s.ground);
    w.roughness = mix(0.15, 0.5, s.ground);
    // falling rain and snow aren't lit, so dim them by hand at night
    const dim = mix(1, 0.4, dn.night);
    this.snow.material.color.setScalar(dim);
    this.rain.material.color.setHex(0xa9bccf).multiplyScalar(dim);

    this.updateParticles(dt, camera.position, s.rain * out, s.snowfall * out);
    this.sound?.setRain(s.rain * out);

    // corner icon for little weather watchers
    const icon = s.snowfall > 0.25 ? '🌨️' : s.rain > 0.25 ? '🌧️' : ((dn.night > 0.6 ? NIGHT_ICONS : ICONS).filter(([, c]) => overcast >= c).pop()[0]) + (s.ground > 0.5 ? '⛄' : '');
    if (icon !== this.icon && this.iconEl) { this.icon = icon; this.iconEl.textContent = icon; }
  }

  updateParticles(dt, cp, rain, snow) {
    const wrap = (p) => {
      if (p.x - cp.x > BOX) p.x -= 2 * BOX; else if (p.x - cp.x < -BOX) p.x += 2 * BOX;
      if (p.z - cp.z > BOX) p.z -= 2 * BOX; else if (p.z - cp.z < -BOX) p.z += 2 * BOX;
    };
    const spawn = (p, anywhere) => {
      p.x = cp.x + (Math.random() * 2 - 1) * BOX;
      p.z = cp.z + (Math.random() * 2 - 1) * BOX;
      p.y = cp.y + (anywhere ? BOTTOM + Math.random() * (TOP - BOTTOM) : TOP);
    };
    if (!this.placed) { for (const p of this.rainDrops) spawn(p, true); for (const p of this.flakes) spawn(p, true); this.placed = true; }

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

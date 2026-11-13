import * as THREE from 'three';
import { glowCopy } from './daynight.js';

// The train gets grubby as it goes: mud and soot build up from the wheels upwards, in blotches
// and drip streaks, and the paint and brass go dull. Rain washes it off again (and leaves it shiny
// and wet for a bit), and so does the train wash at a depot, one car at a time as each one
// rolls past its brushes. Only the train you drive gets dirty: its materials are cloned, so the parked
// trains in the depots (which share the originals) stay clean.

// how muddy each biome's track is
const MUD = { meadow: 1, autumn: 1.2, winter: 0.6, christmas: 0.6, swamp: 2.2, rainforest: 1.6, mountain: 1, ocean: 1 };
const DIRTY_AFTER = 3500;  // metres of (meadow) track from clean to filthy: about 3 minutes at full speed
const WASH = 0.02;         // per second in heavy rain: about a minute of downpour gets it clean
const DRY = 0.08;          // how quickly it dries off after the rain

const COMMON = /* glsl */`
uniform float uDirt;
uniform float uWet;
uniform float uWashZ; // parts of the car ahead of this (car z) have been through the brushes
uniform vec3 uDirtOffset;
varying vec3 vDirtPos;
`;
const NOISE = /* glsl */`
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;
const GRIME = /* glsl */`
  vec3 dp = vDirtPos;
  float dirt = uDirt * (1.0 - smoothstep(uWashZ - 0.5, uWashZ + 0.5, dp.z));
  float dn = dNoise(dp * 1.3) * 0.6 + dNoise(dp * 4.1) * 0.4;
  float drip = dNoise(vec3(dp.x * 3.0, dp.y * 0.25, dp.z * 3.0)); // long vertical streaks
  float low = smoothstep(4.6, 0.6, dp.y);                            // worst down by the wheels
  float dm = low * 0.55 + dn * 0.3 + drip * 0.25;
  float e0 = 0.82 - dirt * 0.55;                                    // even filthy, the tops keep some paint
  float dirtMask = smoothstep(e0, e0 + 0.22, dm) * 0.82 * min(1.0, dirt * 8.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.76, 0.7), dirt * 0.5); // a dull film all over
  vec3 grime = vec3(0.3, 0.24, 0.17) * (0.5 + 0.7 * dn);
  const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
  grime *= min(1.0, (dot(diffuseColor.rgb, LUM) + 0.05) / dot(grime, LUM)); // never lightens the black parts
  diffuseColor.rgb = mix(diffuseColor.rgb, grime, dirtMask);
`;

function patch(mat, shared, offset) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = shared.dirt;
    sh.uniforms.uWet = shared.wet;
    sh.uniforms.uWashZ = shared.washZ;
    sh.uniforms.uDirtOffset = { value: offset };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>' + COMMON)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vDirtPos = position + uDirtOffset;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>' + COMMON + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>' + GRIME)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.95, dirtMask);
  roughnessFactor = mix(roughnessFactor, 0.12, uWet * 0.7 * (1.0 - dirtMask * 0.5));`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor *= 1.0 - dirtMask * 0.8;');
  };
  mat.customProgramCacheKey = () => 'train-dirt';
}

export class Dirt {
  constructor(cars) {
    // each car has its own dirt, so the wash can clean them one after another
    this.cars = cars.map((car) => ({ car, amount: 0, u: { dirt: { value: 0 }, wet: { value: 0 }, washZ: { value: 1e4 } } }));
    this.washing = false;   // a car is being scrubbed right now
    this.washDone = false;  // the last car came out just this frame
    this._v = new THREE.Vector3();
    for (const c of this.cars) {
      const { car } = c, cache = new Map(); // one clone per original material and position on the car
      car.group.traverse((m) => {
        if (!m.isMesh) return;
        // where this part sits on its car (rotations ignored: the parts are only translated)
        const off = new THREE.Vector3();
        for (let o = m; o && o !== car.group; o = o.parent) off.add(o.position);
        const one = (src) => {
          if (!src.isMeshStandardMaterial) return src;
          const key = src.uuid + off.toArray().join();
          if (!cache.has(key)) {
            const cl = src.clone();
            glowCopy(src, cl);
            patch(cl, c.u, off.clone());
            cache.set(key, cl);
          }
          return cache.get(key);
        };
        m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
      });
    }
  }

  // 0 = spotless, 1 = filthy (the average over the cars; setting it sets them all, handy in the console)
  get amount() { return this.cars.reduce((a, c) => a + c.amount, 0) / this.cars.length; }
  set amount(v) { for (const c of this.cars) c.amount = v; }

  // ds: metres travelled this frame, rain: 0..1 falling on the train, biome: biomeWeights().w,
  // washes: world positions of the middle of the brushes of any train washes nearby
  update(dt, ds, rain, biome, washes = []) {
    let mud = 0, total = 0;
    for (const b in biome ?? {}) { mud += biome[b] * (MUD[b] ?? 1); total += biome[b]; }
    mud = total > 0 ? mud / total : 1;
    const change = (ds / DIRTY_AFTER) * mud * (1 - rain) - dt * WASH * rain;
    let washing = false;
    for (const c of this.cars) {
      c.amount = THREE.MathUtils.clamp(c.amount + change, 0, 1);
      // going through a wash? the brushes are at car z = l.z; everything in front of that is clean
      let washZ = 1e4, inWash = false;
      const half = c.car.length / 2;
      for (const w of washes) {
        const l = c.car.group.worldToLocal(this._v.copy(w));
        if (Math.abs(l.x) > 3 || Math.abs(l.y) > 6 || Math.abs(l.z) > half + 6) continue;
        inWash = true;
        if (l.z < -half) c.amount = 0; // all the way through
        else washZ = l.z;
        if (Math.abs(l.z) < half + 0.5) washing = true;
      }
      c.u.washZ.value = washZ;
      c.u.dirt.value = c.amount;
      const wet = c.u.wet, target = inWash ? 1 : rain;
      wet.value += (target - wet.value) * (1 - Math.exp(-dt * (target > wet.value ? 1.5 : DRY)));
    }
    this.washDone = !washing && this.washing;
    this.washing = washing;
  }
}

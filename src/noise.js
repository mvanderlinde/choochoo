import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

// Shared noise and math helpers (no game imports, so anything can use them).
export const WATER_Y = 1.5;
export const perlin = new ImprovedNoise();
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;

export function fbm(x, z, oct, seed) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * perlin.noise(x * f, z * f, seed); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

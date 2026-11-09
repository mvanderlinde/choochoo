import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

// Shared math + the infinite height field the world is generated from.
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

// 0 = lowlands, 1 = mountain country. Very low frequency so regions are large.
export function mountainMask(x, z) {
  return smooth(0.1, 0.45, fbm(x / 1500 + 0.37, z / 1500 + 0.71, 2, 11.3));
}

// Smooth height the track bed follows (climbs gently into mountain regions).
export function trackBaseHeight(x, z) {
  return Math.max(5, 10 + mountainMask(x, z) * 45 + fbm(x / 700 + 0.13, z / 700 + 0.29, 2, 13.7) * 10);
}

// Height of the land before tracks and towns carve it.
export function naturalHeight(x, z) {
  const M = mountainMask(x, z);
  let h = trackBaseHeight(x, z) + 3 + fbm(x / 170, z / 170, 4, 1.7) * 24 * (1 - 0.4 * M);
  if (M > 0.01) {
    const n = 1 - Math.abs(perlin.noise(x / 150, z / 150, 3.3));
    const n2 = 1 - Math.abs(perlin.noise(x / 55, z / 55, 8.8));
    h += M * (n * n * 140 + n2 * n2 * 30);
  }
  const lake = smooth(0.18, 0.4, fbm(x / 600 + 0.5, z / 600 + 0.5, 2, 21.1)) * (1 - M);
  return mix(h, -6, lake);
}

// ---------- climate ----------
// Large regions that are cold (snow on the ground) or wet (clouds, rain/snow), shifted per world.
let climate = [0, 0];
export function setClimateSeed(seed) { const r = mulberry32(seed); climate = [r() * 1000, r() * 1000]; }
export function coldness(x, z) { return fbm(x / 2600 + climate[0], z / 2600 + climate[1], 2, 31.7); }
export function groundSnow(x, z) { return smooth(0.08, 0.16, coldness(x, z)); }
// Wet weather fronts drift slowly over time (t in seconds).
export function wetness(x, z, t) { return fbm(x / 900 + climate[1] + t * 0.005, z / 900 + climate[0] - t * 0.003, 2, 41.3); }

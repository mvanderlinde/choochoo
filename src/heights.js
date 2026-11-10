import { WATER_Y, perlin, smooth, mix, fbm, mulberry32 } from './noise.js';
import { biomeWeights, coastDistance, setBiomeSeed } from './biomes.js';

// The infinite height field the world is generated from, built from the biome regions.
export { WATER_Y, perlin, smooth, mix, fbm, mulberry32 };
export { biomeWeights };

// 0 = not mountains, 1 = mountain country.
export function mountainMask(x, z) { return biomeWeights(x, z).w.mountain ?? 0; }

// ---------- the height the track bed follows ----------
const gentle = (x, z) => 10 + fbm(x / 700 + 0.13, z / 700 + 0.29, 2, 13.7) * 10;
const TRACK_BASE = {
  meadow: gentle, autumn: gentle, winter: gentle, christmas: gentle,
  rainforest: (x, z) => 13 + fbm(x / 700 + 0.13, z / 700 + 0.29, 2, 13.7) * 14,
  swamp: () => 4.6,
  ocean: () => 5,
  // into the mountains: a high line that climbs and dips on steep grades
  mountain: (x, z) => 42 + fbm(x / 900, z / 900, 2, 14.9) * 22 + fbm(x / 300, z / 300, 2, 15.3) * 20,
};

function trackBase(bw, x, z) {
  let h = 0;
  for (const b in bw.w) h += bw.w[b] * TRACK_BASE[b](x, z);
  return Math.max(5, h);
}
// The line's height blends between biomes over a wide distance, so the climb into the mountains is gradual.
const TRACK_SOFT = 380;
export function trackBaseHeight(x, z) { return trackBase(biomeWeights(x, z, TRACK_SOFT), x, z); }

// ---------- the land, before tracks and towns carve it ----------
function lowland(base, x, z, hills, lakes = true) {
  const h = base + 3 + fbm(x / 170, z / 170, 4, 1.7) * hills;
  if (!lakes) return h;
  return mix(h, -6, smooth(0.18, 0.4, fbm(x / 600 + 0.5, z / 600 + 0.5, 2, 21.1)));
}
const LAND = {
  meadow: (b, x, z) => lowland(b, x, z, 24),
  autumn: (b, x, z) => lowland(b, x, z, 22),
  winter: (b, x, z) => lowland(b, x, z, 20),
  christmas: (b, x, z) => lowland(b, x, z, 16),
  // big jungly hills
  rainforest: (b, x, z) => {
    const n = 1 - Math.abs(perlin.noise(x / 110, z / 110, 6.6));
    return b + 3 + fbm(x / 150, z / 150, 4, 1.9) * 26 + n * n * 18;
  },
  // flat and boggy, with lots of murky pools just below the water line
  swamp: (b, x, z) => WATER_Y - 0.7 + fbm(x / 45, z / 45, 3, 71.3) * 3.2 + fbm(x / 300, z / 300, 2, 72.9) * 1.0,
  // sharp peaks around the line, with snow on top
  mountain: (b, x, z) => {
    const n = 1 - Math.abs(perlin.noise(x / 150, z / 150, 3.3));
    const n2 = 1 - Math.abs(perlin.noise(x / 55, z / 55, 8.8));
    return b + 3 + fbm(x / 170, z / 170, 4, 1.7) * 14 + n ** 4 * 170 + n2 * n2 * 26;
  },
  // a long beach, then the open sea
  ocean: (b, x, z, bw) => {
    if (!bw.ocean) return lowland(b, x, z, 12, false);
    const s = coastDistance(bw.ocean, x, z), u = -s;
    if (u > 0) return WATER_Y + 1 + smooth(0, 160, u) * 7 + fbm(x / 90, z / 90, 2, 62.7) * 1.5 * smooth(0, 60, u);
    return WATER_Y + 1 - smooth(0, 25, s) * 3 - smooth(0, 220, s) * 11;
  },
};

export function naturalHeight(x, z) {
  const bw = biomeWeights(x, z), base = trackBaseHeight(x, z);
  let h = 0;
  for (const b in bw.w) h += bw.w[b] * LAND[b](base, x, z, bw);
  return h;
}

// ---------- climate ----------
// Weather fronts drift slowly over time (t in seconds); some biomes are wetter than others.
let climate = [0, 0];
export function setClimateSeed(seed) {
  const r = mulberry32(seed); climate = [r() * 1000, r() * 1000];
  setBiomeSeed(Math.floor(r() * 1e9));
}
const WET = { rainforest: 0.17, swamp: 0.08, christmas: 0.12, winter: 0.03, ocean: -0.04, autumn: 0.02 };
export function wetness(x, z, t, bw = biomeWeights(x, z)) {
  let bias = 0;
  for (const b in bw.w) bias += bw.w[b] * (WET[b] ?? 0);
  return fbm(x / 900 + climate[1] + t * 0.005, z / 900 + climate[0] - t * 0.003, 2, 41.3) + bias;
}
// 0..1: how snowy it is here (snow on the ground, and snow instead of rain)
export function snowiness(bw) { return smooth(0.3, 0.75, (bw.w.winter ?? 0) + (bw.w.christmas ?? 0)); }
export function groundSnow(x, z) { return snowiness(biomeWeights(x, z)); }

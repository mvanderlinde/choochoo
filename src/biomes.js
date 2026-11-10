import { fbm, mulberry32 } from './noise.js';

// The world is split into big regions (about 1.5 km across), each with its own biome. Regions are
// cells around jittered points; their borders are warped with noise and blended over a couple of
// hundred metres, so one biome melts into the next. biomeWeights() says how much of each biome a
// spot is (the weights add up to 1).

export const BIOMES = ['meadow', 'autumn', 'winter', 'christmas', 'swamp', 'rainforest', 'mountain', 'ocean'];
const CHANCE = { meadow: 0.2, autumn: 0.14, winter: 0.1, christmas: 0.1, swamp: 0.1, rainforest: 0.11, mountain: 0.14, ocean: 0.11 };
const START = ['meadow', 'autumn', 'winter', 'christmas']; // gentle places to begin the ride
export const ICON = { autumn: '🍂', winter: '⛄', christmas: '🎄', swamp: '🐸', rainforest: '🌴', mountain: '🏔️', ocean: '🌊' };

const CELL = 1500, JITTER = 0.35, SOFT = 110;
let seed = 0, startBiome = null;
const cells = new Map();
export function setBiomeSeed(s) { seed = s; cells.clear(); }
// ?biome=ocean etc: start the ride in that biome
export function setStartBiome(b) { if (BIOMES.includes(b)) { startBiome = b; cells.clear(); } }

function cell(i, j) {
  const key = i * 73856093 ^ j * 19349663;
  let c = cells.get(key);
  if (c) return c;
  const r = mulberry32((key ^ (seed * 2654435761)) >>> 0);
  r(); r();
  let biome;
  if (i === 0 && j === 0) biome = startBiome ?? START[Math.floor(r() * START.length)];
  else {
    let x = r();
    for (const b of BIOMES) { x -= CHANCE[b]; if (x <= 0) { biome = b; break; } }
    biome ??= 'meadow';
  }
  const centre = i === 0 && j === 0; // the start cell is centred on the origin
  // starting by the sea: the coast runs the way the train sets off (+z), with the sea on one side
  const a = centre ? (r() < 0.5 ? 0 : Math.PI) : r() * Math.PI * 2;
  c = {
    biome,
    x: (i + (centre ? 0 : (r() * 2 - 1) * JITTER)) * CELL + (centre ? 45 * Math.cos(a) : 0), // start ~45 m inland
    z: (j + (centre ? 0 : (r() * 2 - 1) * JITTER)) * CELL,
    dx: Math.cos(a), dz: Math.sin(a), // ocean: direction out to sea
  };
  if (cells.size > 5000) cells.clear();
  cells.set(key, c);
  return c;
}

// { w: {biome: weight}, ocean: the ocean cell nearby (or null), oceanW }
// soft: how gradually biomes blend (metres); the track's height uses a much softer blend.
export function biomeWeights(x, z, soft = SOFT) {
  const wx = x + fbm(x / 700, z / 700, 2, 51.1) * 380, wz = z + fbm(x / 700 + 9.3, z / 700 + 4.1, 2, 52.7) * 380;
  const ci = Math.round(wx / CELL), cj = Math.round(wz / CELL);
  const near = [];
  let dmin = Infinity;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const c = cell(ci + di, cj + dj), d = Math.hypot(wx - c.x, wz - c.z);
    near.push([c, d]);
    if (d < dmin) dmin = d;
  }
  const w = {};
  let total = 0, ocean = null, oceanBest = 0;
  for (const [c, d] of near) {
    const k = d - dmin;
    if (k > soft * 5) continue;
    const v = Math.exp(-k / soft);
    w[c.biome] = (w[c.biome] ?? 0) + v;
    total += v;
    if (c.biome === 'ocean' && v > oceanBest) { oceanBest = v; ocean = c; }
  }
  for (const b in w) w[b] /= total;
  return { w, ocean, oceanW: w.ocean ?? 0 };
}

// Ocean regions: signed distance from the coastline (negative = land, positive = sea).
export function coastDistance(c, x, z) {
  return (x - c.x) * c.dx + (z - c.z) * c.dz + fbm(x / 420, z / 420, 2, 61.3) * 90;
}

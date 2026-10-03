// Whether anything grows on the bridges' roads: the bridges found over 12 × 12 km (a 13 × 13 grid
// of places 1 km apart), and per bridge every stalk and ground-cover copy chunks of levels 0 and 1
// place within 25 m of it, and every clump at levels 0-2, measured against the deck (its corners,
// sunk ends included) and the road's edge (roadDistanceAt: not frayed, nor cut away by the river).
// Counted, by kind and level: stalks within 0.5 m of either, clumps within 2 m, ground cover within
// 0.5 m, and boulders within their radius + 1.2 m (half the car). ~20 s.
//   node bench/bridges.mjs [folder with terrain.js and nature.js]    VERBOSE=1 lists each one
import { resolve } from 'path';
import { pathToFileURL } from 'url';
const repo = pathToFileURL(resolve(process.argv[2] ?? '.') + '/');
const T = await import(new URL('terrain.js', repo));
const N = await import(new URL('nature.js', repo));
const { createTerrain, newSlot, buildChunk, CHUNK_QUADS, STALK_FLOATS, CLUMP_FLOATS } = T;
const { scatter, KINDS, INSTANCE_FLOATS } = N;

const PLACES = []; for (let x = -6000; x <= 6000; x += 1000) for (let z = -6000; z <= 6000; z += 1000) PLACES.push([x, z]);
const finder = createTerrain({ radius: 1 });
const seen = new Map();
for (const [x, z] of PLACES) {
  finder.update(x, z, Infinity);
  for (const b of finder.bridges) seen.set(`${b.cx},${b.cz}`, JSON.parse(JSON.stringify(b)));
}
const bridges = [...seen.values()];

function segDist(px, pz, c) {  // xz distance to the polyline of corners (x, y, z, ...)
  let best = Infinity;
  for (let i = 0; i + 3 < c.length; i += 3) {
    const ax = c[i], az = c[i + 2], dx = c[i + 3] - ax, dz = c[i + 5] - az, l2 = dx * dx + dz * dz;
    const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / l2, 0), 1);
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return best;
}
const name = k => KINDS[k].wall ? 'boulder' : `kind ${k}`;

const totals = {};
const bad = (what, level, b, x, z, deck, road, extra = '') => {
  const key = `${what} L${level}`;
  totals[key] = (totals[key] ?? 0) + 1;
  if (process.env.VERBOSE) console.log(`  ${key} at ${x.toFixed(1)},${z.toFixed(1)}: deck ${deck.toFixed(2)} road ${road.toFixed(2)} ${extra}`);
};
const roadT = createTerrain({ radius: 8 });
const slots = [0, 1, 2].map(l => newSlot(0, l));
let examined = 0;
for (const b of bridges) {
  roadT.update(b.cx, b.cz, Infinity);
  const near = (x, z) => segDist(x, z, b.corners) - b.half;
  for (const level of [0, 1, 2]) {
    const slot = slots[level], size = slot.size;
    for (let cz = Math.floor((b.z0 - 25) / size); cz <= Math.floor((b.z1 + 25) / size); cz++) {
      for (let cx = Math.floor((b.x0 - 25) / size); cx <= Math.floor((b.x1 + 25) / size); cx++) {
        buildChunk(slot, cx, cz);
        examined++;
        const road = (x, z) => roadT.roadDistanceAt(x, z);
        for (let s = 0; level < 2 && s < slot.stalkCount; s++) {
          const x = slot.stalks[s * STALK_FLOATS], z = slot.stalks[s * STALK_FLOATS + 2];
          const d = near(x, z), r = road(x, z);
          if (d < 0.5 || r < 0.5) bad('stalk', level, b, x, z, d, r);
        }
        for (let s = 0; s < slot.clumpCount; s++) {
          const x = slot.clumps[s * CLUMP_FLOATS], z = slot.clumps[s * CLUMP_FLOATS + 2];
          const d = near(x, z), r = road(x, z);
          if (d < 2 || r < 2) bad('clump', level, b, x, z, d, r);
        }
        if (level > 1) continue;
        const lists = scatter(slot);
        lists.forEach((list, k) => {
          if (!list) return;
          for (let o = 0; o < list.length; o += INSTANCE_FLOATS) {
            const x = list[o], z = list[o + 2], size = list[o + 4], what = name(k);
            const reach = what === 'boulder' ? 1.0 * size + 1.2 : 0.5;  // the car's half-width past a boulder
            const d = near(x, z), r = road(x, z);
            if (d < reach || r < reach) bad(what, level, b, x, z, d, r, `y ${list[o + 1].toFixed(1)} deckY~${b.corners[1].toFixed(1)}`);
          }
        });
      }
    }
  }
}
console.log(`${bridges.length} bridges, ${examined} chunks`);
console.log(Object.keys(totals).length ? totals : 'nothing on them');

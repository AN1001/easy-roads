// How fast terrain.js builds chunks, how much garbage that makes, and a checksum of every vertex
// byte: for speeding up the terrain without changing it. Run it on a copy of the old terrain.js
// and on the new one; if the checksums match, the land is the same to the byte.
//
//   node bench/build.mjs                  this project's terrain.js
//   node bench/build.mjs old/terrain.js   another copy, to compare
//
// Builds 625 chunks (a 25 × 25 ring) in each of 4 places (canyons, hills, and two mixed), 6 times;
// the first round warms up the JIT and isn't timed. Leave the machine idle while it runs.

import { createHash } from 'crypto';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { PerformanceObserver } from 'perf_hooks';

const file = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../terrain.js', import.meta.url);
const { createTerrain } = await import(file);
const PLACES = [[600, -260], [-1000, -400], [2000, 1500], [-3000, 2500]];
const ROUNDS = 6;

const terrain = createTerrain({ radius: 12 });
const checksum = createHash('sha256');
let collections = 0;
const observer = new PerformanceObserver(list => { collections += list.getEntries().length; });
const times = [];
for (let round = 0; round < ROUNDS; round++) {
  if (round === 1) observer.observe({ entryTypes: ['gc'] });
  let ms = 0;
  for (const [x, z] of PLACES) {
    terrain.update(x + 1e5, z + 1e5, Infinity);  // move the ring away and back: every chunk is rebuilt
    const start = performance.now();
    terrain.update(x, z, Infinity);
    ms += performance.now() - start;
    // The mesh's vertices only (not the skirts'), so older copies of terrain.js compare.
    if (round === 0) for (const slot of terrain.slots) checksum.update(new Uint8Array(slot.vertices.buffer, 0, 31 * 31 * 8));
  }
  if (round > 0) times.push(ms / (PLACES.length * terrain.slots.length));
}
await new Promise(r => setTimeout(r, 50));  // let the last GC entries arrive
observer.disconnect();
times.sort((a, b) => a - b);
const chunks = 2 * (ROUNDS - 1) * PLACES.length * terrain.slots.length;  // each round builds every place twice
console.log(`${file.pathname}`);
console.log(`  ms per chunk: median ${times[times.length >> 1].toFixed(3)}, best ${times[0].toFixed(3)}, worst ${times[times.length - 1].toFixed(3)}`);
console.log(`  garbage collections: ${(collections / chunks * 1000).toFixed(0)} per 1,000 chunks built`);
console.log(`  checksum ${checksum.digest('hex').slice(0, 16)}`);

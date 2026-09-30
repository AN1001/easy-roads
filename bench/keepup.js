// Does chunk building keep up with the car? Moves the camera across the land in a straight line at
// top speed, a frame at a time, building as main.js does, and counts the frames that find a hole
// close enough to be seen (inside SEEN m): main.js fills those at once, past its budget, so each is
// a slow frame instead of land appearing.
//
//   node bench/keepup.js
//
// "slower" divides the budget: as if building took that many times longer (a slower machine or
// JS engine).

import { createTerrain } from '../terrain.js';

// As main.js.
const FOG_START = 10, FOG_END = 400, FOG_THICKNESS = 140, DETAIL = [100, 220], AHEAD = 40, BUILD_BUDGET = 1;  // m, m, m, m, m, ms
const SEEN = FOG_START - FOG_THICKNESS * Math.log(1 - 0.96 * (1 - Math.exp(-(FOG_END - FOG_START) / FOG_THICKNESS)));  // m

function keepUp({ speed = 30, fps = 60, heading = 45, slower = 1, distance = 3000, x = 600, z = -330 } = {}) {
  const terrain = createTerrain({ draw: FOG_END, ahead: AHEAD, detail: DETAIL });
  let start = performance.now();
  terrain.update(x, z, Infinity);  // like the game's first frame
  const startupMs = performance.now() - start, startupChunks = terrain.slots.filter(slot => slot.ready).length;
  const stepX = Math.sin(heading * Math.PI / 180) * speed / fps, stepZ = Math.cos(heading * Math.PI / 180) * speed / fps;
  const frames = Math.round(distance / speed * fps);
  let behind = 0, worstMs = 0, totalMs = 0, drawn = 0, rows = 0;
  for (let f = 0; f < frames; f++) {
    x += stepX; z += stepZ;
    start = performance.now();
    rows += terrain.update(x, z, BUILD_BUDGET / slower, SEEN);
    const ms = (performance.now() - start) * slower;
    totalMs += ms; worstMs = Math.max(worstMs, ms);
    if (terrain.behind) behind++;
    drawn += terrain.drawCount;
  }
  return { heading, fps, slower, 'startup chunks': startupChunks, 'startup ms': +startupMs.toFixed(0),
    'chunks built/s': +(rows / 33 / (frames / fps)).toFixed(1), 'drawable chunks': Math.round(drawn / frames),
    'frames behind': `${behind} of ${frames}`, 'build ms per frame': +(totalMs / frames).toFixed(3), 'worst frame ms': +worstMs.toFixed(2) };
}

const runs = [];
for (const slower of [1, 3]) for (const fps of [60, 30]) runs.push(keepUp({ fps, slower }));
console.table(runs);

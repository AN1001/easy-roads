// A top-down map of the terrain, as a PNG: shaded relief, with the roads drawn on top (from the
// same vertex numbers the shader paints them from: their frayed edges), the rivers' water (the
// vertices marked as water) and the bridges, as the car drives on them (groundAt). For seeing the shape of
// the land and the road network at once, which the game's misty chase camera never shows.
//
//   node bench/relief.mjs [out.png] [centre x] [centre z] [size in m] [m per pixel]
//   node bench/relief.mjs map.png 0 0 2400 2       2.4 km around the start, 1200 × 1200 pixels
//
// North (+z) is up. Also prints how long the chunks took to build.

import { writeFileSync } from 'fs';
import { png } from './png.mjs';
const { createTerrain, CHUNK_QUADS, VERTEX_SHORTS } = await import(new URL('../terrain.js', import.meta.url));

const [out = 'relief.png', ...numbers] = process.argv.slice(2);
const [centreX = 0, centreZ = 0, size = 2400, metresPerPixel = 2] = numbers.map(Number);
const pixels = Math.round(size / metresPerPixel);

// Enough chunks around the centre to cover the map, all built up front.
const terrain = createTerrain({ radius: Math.ceil(size / 2 / CHUNK_QUADS) + 1 });
console.log('(bridges: only those within 500 m of the centre)');
const start = performance.now();
terrain.update(centreX, centreZ, Infinity);
const ms = performance.now() - start;
console.log(`${terrain.slots.length} chunks in ${ms.toFixed(0)} ms: ${(ms / terrain.slots.length).toFixed(2)} ms each`);

const LIGHT = [-0.5, 0.7, 0.5].map(v => v / Math.hypot(-0.5, 0.7, 0.5));  // from the north-west
const normal = new Float64Array(3);
const rgb = Buffer.alloc(pixels * pixels * 3);
let lowest = Infinity, highest = -Infinity;
for (let py = 0; py < pixels; py++) {
  for (let px = 0; px < pixels; px++) {
    const x = Math.floor(centreX - size / 2 + px * metresPerPixel);
    const z = Math.floor(centreZ + size / 2 - py * metresPerPixel);
    const h = terrain.heightAt(x + 0.3, z + 0.3, normal);
    lowest = Math.min(lowest, h); highest = Math.max(highest, h);
    // m from the road's edge at the vertex at (x, z), as terrain.vert reads it.
    const slot = terrain.slotFor(Math.floor(x / CHUNK_QUADS), Math.floor(z / CHUNK_QUADS));
    const o3 = ((z - slot.z) * (CHUNK_QUADS + 1) + x - slot.x) * VERTEX_SHORTS;
    const edge = slot.vertices[o3 + 1] * 0.01, kind = slot.vertices[o3 + 3] >> 8;
    const bridge = terrain.groundAt(x + 0.3, z + 0.3) > h + 0.01;

    const shade = 0.3 + 0.9 * Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
    const t = Math.min(Math.max((h + 40) / 140, 0), 1);  // higher is paler
    let colour = [(0.15 + 0.5 * t) * shade, (0.25 + 0.55 * t) * shade, (0.12 + 0.4 * t) * shade].map(c => c * 255);
    if (edge < 0) colour = [235, 200, 140];  // the road's sand
    if (kind === -127) colour = [60 * shade, 100 * shade, 150 * shade];
    if (bridge) colour = [200, 60, 60];
    const o = (py * pixels + px) * 3;
    for (let k = 0; k < 3; k++) rgb[o + k] = Math.min(255, colour[k]);
  }
}
console.log(`heights ${lowest.toFixed(1)} to ${highest.toFixed(1)} m`);
writeFileSync(out, png(pixels, pixels, rgb));
console.log(`wrote ${out}`);


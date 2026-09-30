// The textures (textures.js) as a PNG, for looking at them: bank, forest floor, grass, sand, the
// bamboo's culm and leaves, the clouds, the bamboo's far clumps and far stalks' leaves, from left to
// right, each 2 × 2 tiles (the leaves, the clumps and the far leaves: once, twice the size), in its colour from the shaders at full
// brightness (no dusk light). The second row of the grass shows its alpha instead, the tufts; the
// sand's, a corner of the puddles' texture (createPuddles), 32 m by 16 m: how wet (white: a puddle). The leaves and clumps are drawn over
// dark grey where they're see-through (the far leaves too), and the clouds are their thickness, white where thickest.
// Also prints how long they took to make.
//
//   node bench/textures.mjs [out.png] [screen pixels per texel]

import { writeFileSync } from 'fs';
import { png } from './png.mjs';
import { createTextures, createPuddles, TEXTURE_SIZE as N, TEXTURE_LAYERS, PUDDLE_SIZE, GRASS, SAND, LEAVES, CLOUDS, CLUMPS, FAR_LEAVES } from '../textures.js';

const [out = 'textures.png', zoom = 2] = process.argv.slice(2).map((a, i) => i ? Number(a) : a);
// BANK, FLOOR, GRASS, SAND (terrain.frag); CULM, LEAF (bamboo.glsl: its greenest); the clouds (sky.frag's
// thickest); the clumps and the far leaves (the leaves' colour, as clump.vert and leaves.vert shade them).
const COLOURS = [[0.22, 0.20, 0.15], [0.22, 0.22, 0.13], [0.23, 0.30, 0.13], [0.50, 0.43, 0.31],
                 [0.30, 0.40, 0.15], [0.20, 0.32, 0.10], [0.5, 0.5, 0.5], [0.20, 0.32, 0.10], [0.20, 0.32, 0.10]];

const start = performance.now();
const pixels = createTextures(), puddles = createPuddles();
console.log(`made in ${(performance.now() - start).toFixed(1)} ms`);

const tile = 2 * N * zoom, width = TEXTURE_LAYERS * tile, rgb = Buffer.alloc(width * tile * 3);
for (let y = 0; y < tile; y++) {
  for (let x = 0; x < width; x++) {
    const k = Math.floor(x / tile), cards = k === LEAVES || k === CLUMPS || k === FAR_LEAVES, card = cards ? 2 : 1;
    const u = Math.floor(x % tile / zoom / card) % N, v = N - 1 - Math.floor(y / zoom / card) % N;
    const o = ((k * N + v) * N + u) * 4, alpha = pixels[o + 3] / 255;
    for (let c = 0; c < 3; c++) {
      let value = COLOURS[k][c] * 2 * pixels[o + c] / 255 * (k === SAND ? 1 : 2);  // the dark ones brightened
      if (k === GRASS && y >= tile / 2) value = alpha * 0.8;
      if (k === SAND && y >= tile / 2) {
        const o2 = 2 * ((2 * N - 1 - Math.floor(y / zoom)) * PUDDLE_SIZE + Math.floor(x % tile / zoom));
        value = puddles[o2 + 1] ? 1 : puddles[o2] / 255 * 0.8;
      }
      if (cards && alpha === 0) value = 0.12;
      if (k === CLOUDS) value = alpha;
      rgb[(y * width + x) * 3 + c] = Math.min(255, 255 * value);
    }
  }
}
writeFileSync(out, png(width, tile, rgb));
console.log(`wrote ${out}`);

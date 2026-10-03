// How two screenshots differ (bench/headless.mjs's, of two versions at the same moment: HOLD and
// main.js's `step`): how many pixels, by how much at most, and where (a picture: the first
// screenshot, dimmed, with the differing pixels red).
//
//   node bench/diff.mjs a.png b.png [where.png]

import { readFileSync, writeFileSync } from 'fs';
import { readPng, png } from './png.mjs';

const [fileA, fileB, out] = process.argv.slice(2);
const a = readPng(readFileSync(fileA)), b = readPng(readFileSync(fileB));
if (a.width !== b.width || a.height !== b.height) throw new Error('not the same size');
const rgb = Buffer.alloc(a.width * a.height * 3);
let differ = 0, most = 0;
for (let k = 0; k < a.width * a.height; k++) {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.rgba[4 * k + c] - b.rgba[4 * k + c]));
  if (d) differ++;
  most = Math.max(most, d);
  for (let c = 0; c < 3; c++) rgb[3 * k + c] = d ? (c === 0 ? 255 : 0) : a.rgba[4 * k + c] >> 2;
}
console.log(`${differ} of ${a.width * a.height} pixels differ (${(100 * differ / (a.width * a.height)).toFixed(3)}%), by up to ${most} of 255`);
if (out) writeFileSync(out, png(a.width, a.height, rgb));

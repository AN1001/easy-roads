// The car's rally livery, assets/Car 03/car3_rally.png: the model's texture (car3.png) repainted
// white, with made-up sponsors (coloured boxes of scrambled lettering, and stripes), its number in
// yellow, and mud. The glass, lights and trim are the model's, and so are the paint's panel lines
// and shading. It's two of the model's texture side by side, the second for the car's left
// (car.js's parseBody), so lettering reads the right way round on both sides, and across the middle
// of the roof, bonnet, back and front. Run it again after changing anything here:
//
//   node bench/livery.mjs [zoomed.png]   also writes the texture 6× the size, to look at
//   node bench/livery.mjs --zen          the zen car the game uses (since 30 Sep 2026),
//                                        car3_zen.png: the model's green, and only the brake
//                                        light on the back bumper, with its fleck of mud

import { readFileSync, writeFileSync } from 'fs';
import { png, readPng } from './png.mjs';
import { parseBody } from '../car.js';

const ZEN = process.argv.includes('--zen');
const NUMBER = '27';
const WHITE = [228, 228, 220], YELLOW = [255, 200, 20], RED = [220, 35, 45], BLUE = [30, 90, 220];
const PURPLE = [125, 45, 190], NAVY = [24, 26, 44], INK = [30, 28, 34];
const SPOILER = WHITE;  // car.js's spoiler: texel (2, 2) of the first copy, which nothing else uses
// The brake light on the back bumper: pure red, lit (car.frag), and a touch of blue, so it's lit only
// braking. Kept exactly this colour (no shading, or making sure the reds keep some green), except
// where a fleck of mud covers it.
const BRAKE_LAMP = [230, 0, 8];
const MUD_WET = [78, 60, 40], MUD_DRY = [150, 126, 90];  // the road's sand, wet and dried

const DIR = new URL('../assets/Car 03/', import.meta.url);
const read = name => readPng(readFileSync(new URL(name, DIR))).rgba;
const green = read('car3.png'), red = read('car3_red.png'), yellow = read('car3_yellow.png');
const S = 128, W = 2 * S;  // the model's texture is S texels square; the livery, two of it

// The paint: the texels where the three colours differ (the glass, lights and trim are the same in
// all three). Its shading: how much lighter or darker each is than the green's flat paint.
const FLAT = 40 + 68 + 60;
const paint = new Uint8Array(S * S), shade = new Float32Array(S * S);
for (let k = 0; k < S * S; k++) {
  for (let c = 0; c < 3; c++) if (green[4 * k + c] !== red[4 * k + c] || green[4 * k + c] !== yellow[4 * k + c]) paint[k] = 1;
  shade[k] = (green[4 * k] + green[4 * k + 1] + green[4 * k + 2]) / FLAT;
}
// The lights (saturated, or bright) are left alone.
const light = k => {
  const [r, g, b] = green.subarray(4 * k, 4 * k + 3);
  return !paint[k] && (Math.max(r, g, b) - Math.min(r, g, b) > 60 || r + g + b > 450);
};

// --- Where on the car each texel is ---

// Its position (m, the car's: +x its left, +y up, +z forward, y = 0 the ground) and its face's
// normal, from a triangle covering its centre; or, for texels on a triangle's edge that the game can
// read but whose centres are outside it, the nearest within half a texel's diagonal, carried on.
const body = parseBody(readFileSync(new URL('Car3.obj', DIR), 'utf8'));
const where = new Float32Array(W * S * 6).fill(NaN), gap = new Float32Array(W * S).fill(Infinity);
for (let i = 0; i < body.indices.length; i += 3) {
  const corner = [0, 1, 2].map(j => body.vertices.subarray(5 * body.indices[i + j], 5 * body.indices[i + j] + 5));
  const [a, b, c] = corner.map(p => [p[3] * W, p[4] * S]);
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) continue;
  const e1 = [0, 1, 2].map(k => corner[1][k] - corner[0][k]), e2 = [0, 1, 2].map(k => corner[2][k] - corner[0][k]);
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const length = Math.hypot(...n);
  for (let v = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - 1)); v <= Math.min(S - 1, Math.max(a[1], b[1], c[1]) + 1); v++) {
    for (let u = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - 1)); u <= Math.min(W - 1, Math.max(a[0], b[0], c[0]) + 1); u++) {
      const p = [u + 0.5, v + 0.5];
      const wb = ((p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])) / area;
      const wc = ((b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1])) / area;
      const weights = [1 - wb - wc, wb, wc];
      let outside = 0;  // texels from the triangle
      if (Math.min(...weights) < 0) {
        outside = Infinity;
        for (const [s, t] of [[a, b], [b, c], [c, a]]) {
          const d = [t[0] - s[0], t[1] - s[1]], along = Math.max(0, Math.min(1, ((p[0] - s[0]) * d[0] + (p[1] - s[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)));
          outside = Math.min(outside, Math.hypot(p[0] - s[0] - along * d[0], p[1] - s[1] - along * d[1]));
        }
      }
      const t = v * W + u;
      if (outside > 0.71 || outside >= gap[t]) continue;
      gap[t] = outside;
      for (let k = 0; k < 3; k++) {
        where[6 * t + k] = weights[0] * corner[0][k] + weights[1] * corner[1][k] + weights[2] * corner[2][k];
        where[6 * t + 3 + k] = n[k] / length;
      }
    }
  }
}

// --- Stickers ---

// What each texel is painted: a colour, or null to keep the model's (its glass, lights and trim).
const colour = Array.from({ length: W * S }, (_, t) => paint[(t >> 8) * S + (t & (S - 1))] ? WHITE : null);
const put = (copy, u, v, c) => { if (c && u >= 0 && u < S && v >= 0 && v < S) colour[v * W + copy * S + u] = c; };

// A picture to stick on: width × height texels, each a colour or null (the paint shows through).
function picture(width, height, fill = null) {
  return { width, height, texels: Array(width * height).fill(fill) };
}
function plot(pic, x, y, c) {
  if (x >= 0 && x < pic.width && y >= 0 && y < pic.height) pic.texels[y * pic.width + x] = c;
}
function draw(pic, x, y, rows, c, scale = 1) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch !== '.') for (let k = 0; k < scale * scale; k++) plot(pic, x + i * scale + k % scale, y + j * scale + Math.floor(k / scale), c);
  }));
}

// Turned round: upside down and back to front.
function turned(pic) {
  return { ...pic, texels: pic.texels.slice().reverse() };
}

// On both sides, its top left at texel (u, v) of the sides' picture; on the right, back to front.
function onSides(pic, u, v) {
  for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) {
    put(1, u + x, v + y, pic.texels[y * pic.width + x]);
    put(0, u + x, v + y, pic.texels[y * pic.width + pic.width - 1 - x]);
  }
}
// Across the middle of the top (the bonnet, roof and tailgate: its top forward, read from behind),
// the back or the front: its left edge `left` texels right of the middle (negative: left of it), its
// top `top` texels along. The model's texture has half of each, from the middle out, which the car's
// two halves read mirrored: here, one in each copy.
const MIDDLE = { top: 58, back: 22, front: 27 };  // the texel the middle runs through
function across(panel, pic, left, top) {
  for (let y = 0; y < pic.height; y++) for (let x = 0; x < pic.width; x++) {
    const a = left + x, c = pic.texels[y * pic.width + x], right = panel === 'front' ? a < 0 : a >= 0;
    const out = a >= 0 ? a : -a - 1, m = MIDDLE[panel];  // texels out from the middle
    if (panel === 'top') put(right ? 0 : 1, top + y, m + out, c);
    else if (panel === 'back') put(right ? 0 : 1, m - out, top + y, c);
    else put(right ? 0 : 1, m + out, top + y, c);
  }
}

// Made-up lettering: letters 3 × 5 texels, a few with a texel knocked out or added, in words.
const LETTERS = [
  ['.#.', '#.#', '###', '#.#', '#.#'], ['##.', '#.#', '##.', '#.#', '##.'], ['.##', '#..', '#..', '#..', '.##'],
  ['##.', '#.#', '#.#', '#.#', '##.'], ['###', '#..', '##.', '#..', '###'], ['###', '#..', '##.', '#..', '#..'],
  ['#.#', '#.#', '###', '#.#', '#.#'], ['#.#', '#.#', '##.', '#.#', '#.#'], ['#..', '#..', '#..', '#..', '###'],
  ['#.#', '###', '###', '#.#', '#.#'], ['###', '#.#', '#.#', '#.#', '###'], ['##.', '#.#', '##.', '#..', '#..'],
  ['##.', '#.#', '##.', '#.#', '#.#'], ['.##', '#..', '.#.', '..#', '##.'], ['###', '.#.', '.#.', '.#.', '.#.'],
  ['#.#', '#.#', '#.#', '#.#', '###'], ['#.#', '#.#', '.#.', '#.#', '#.#'], ['###', '..#', '.#.', '#..', '###'],
  ['#.#', '#.#', '#.#', '#.#', '.#.'], ['###', '.#.', '.#.', '.#.', '###'],
];
function random(i, seed) {
  let h = Math.imul(i, 374761393) + Math.imul(seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Words of scrambled letters across `width` texels from (x, y), in the middle of it: each letter
// 4 texels on, a space 2 more.
function scramble(pic, x, y, width, c, seed, scale = 1) {
  const letters = [];
  for (let i = 0, at = 0, word = 2 + Math.floor(random(0, seed) * 5); at + 3 * scale <= width; i++) {
    if (word === 0) { at += 2 * scale; word = 2 + Math.floor(random(i, seed + 1) * 5); continue; }
    const rows = LETTERS[Math.floor(random(i, seed) * LETTERS.length)].slice();
    if (random(i, seed + 2) < 0.3) {  // knocked about
      const j = Math.floor(random(i, seed + 3) * 5), k = Math.floor(random(i, seed + 4) * 3);
      rows[j] = rows[j].slice(0, k) + (rows[j][k] === '#' ? '.' : '#') + rows[j].slice(k + 1);
    }
    letters.push([at, rows]);
    at += 4 * scale; word--;
  }
  const used = letters.at(-1)[0] + 3 * scale, left = x + Math.floor((width - used) / 2);
  for (const [at, rows] of letters) draw(pic, left + at, y, rows, c, scale);
}

// The number's digits: 6 × 9 texels, strokes 2 thick, 2 apart; and small ones, 3 × 5.
const BIG = { gap: 2, digits: {
  0: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  1: ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  2: ['.####.', '##..##', '....##', '....##', '...##.', '..##..', '.##...', '##....', '######'],
  3: ['.####.', '##..##', '....##', '....##', '..###.', '....##', '....##', '##..##', '.####.'],
  4: ['...##.', '..###.', '.####.', '##.##.', '##.##.', '######', '...##.', '...##.', '...##.'],
  5: ['######', '##....', '##....', '#####.', '....##', '....##', '....##', '##..##', '.####.'],
  6: ['.####.', '##..##', '##....', '#####.', '##..##', '##..##', '##..##', '##..##', '.####.'],
  7: ['######', '....##', '....##', '...##.', '...##.', '..##..', '..##..', '.##...', '.##...'],
  8: ['.####.', '##..##', '##..##', '##..##', '.####.', '##..##', '##..##', '##..##', '.####.'],
  9: ['.####.', '##..##', '##..##', '##..##', '.#####', '....##', '....##', '##..##', '.####.'],
} };
const SMALL = { gap: 2, digits: {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
} };
// A plate with the number on it in yellow, `across` and `down` texels of it round the number.
function plate(background, across, down, font = BIG, scale = 1) {
  const w = font.digits[0][0].length, h = font.digits[0].length;
  const pic = picture((NUMBER.length * (w + font.gap) - font.gap) * scale + 2 * across, h * scale + 2 * down, background);
  [...NUMBER].forEach((digit, i) => draw(pic, across + i * (w + font.gap) * scale, down, font.digits[digit], YELLOW, scale));
  return pic;
}
// A box of scrambled lettering, in the middle of it.
function sponsor(width, height, background, ink, seed, scale = 1) {
  const pic = picture(width, height, background), margin = Math.floor((height - 5 * scale) / 2);
  scramble(pic, margin + 1, margin, width - 2 * margin - 2, ink, seed, scale);
  return pic;
}

// The sides. Their picture (the model's texture, from v = 85 down): the car's left side, front at
// u = 0, 33 texels per m; the windows above v = 103, a trim strip along v = 107, the door between
// the panel lines at u = 41 and 80, the sill's black trim below v = 124.
const STRIPES = [RED, YELLOW];
const stripes = picture(118, 2);                           // under the windows
for (let x = 0; x < 118; x++) STRIPES.forEach((c, y) => plot(stripes, x, y, c));
onSides(stripes, 4, 104);
onSides(sponsor(34, 7, YELLOW, INK, 11), 5, 108);          // front wing
onSides(plate(NAVY, 3, 1), 48, 108);                       // door
onSides(sponsor(18, 7, RED, WHITE, 12), 82, 108);          // behind the door
onSides(sponsor(56, 6, BLUE, WHITE, 13), 37, 119);         // along the sill

// The top: the bonnet from u = 1 to 32, the windscreen to 52, the roof to 107, the back window and
// the tailgate to 127; the middle at v = 58, out to the side at v = 82.
across('top', turned(sponsor(30, 13, RED, WHITE, 21, 2)), -15, 10);         // bonnet, read from the front
across('top', turned(sponsor(44, 5, PURPLE, WHITE, 22)), -22, 47);          // along the top of the windscreen
across('top', plate(NAVY, 3, 3, BIG, 2), -16, 62);                          // roof
const checks = picture(36, 6);                                              // along the top of the back window
for (let y = 0; y < 6; y++) for (let x = 0; x < 36; x++) plot(checks, x, y, (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? INK : YELLOW);
across('top', checks, -18, 108);
// The back: the tailgate's lip above v = 35 (the sides' stripes carry on round it), the lights to
// 41 either side of a black panel (the number on it), the panel below them to 50, facing down.
const round = picture(46, 2);
for (let x = 0; x < 46; x++) STRIPES.forEach((c, y) => plot(round, x, y, c));
across('back', round, -23, 33);
across('back', plate(null, 0, 0, SMALL), -4, 36);
// The brake light, upright in the middle of the back bumper: the bumper's back is its own strip of
// the texture, v = 16.6 (0.53 m up) to 22.1 (0.39 m), its middle at u = 1.3, 37 texels per m out.
for (let v = 17; v <= 21; v++) for (const u of [1, 2]) for (const copy of [0, 1]) put(copy, u, v, BRAKE_LAMP);
// The front: above the grille to v = 35, the grille and lights to 42, the panel below to 50.
across('front', sponsor(40, 7, BLUE, WHITE, 41), -20, 43);

if (!Number.isNaN(where[6 * (2 * W + 2)])) throw new Error("the spoiler's texel is on the car");
put(0, 2, 2, SPOILER);
if (ZEN) {  // none of it but the brake light
  colour.fill(null);
  for (let v = 17; v <= 21; v++) for (const u of [1, 2]) for (const copy of [0, 1]) put(copy, u, v, BRAKE_LAMP);
}

// --- Mud ---

function noise(x, y, z, seed) {  // smooth, -1 to 1, on a grid of 1
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const ease = t => t * t * (3 - 2 * t), fx = ease(x - xi), fy = ease(y - yi), fz = ease(z - zi);
  const at = (i, j, k) => random(Math.imul(xi + i, 92837111) ^ Math.imul(yi + j, 689287499) ^ Math.imul(zi + k, 283923481), seed);
  const lerp = (a, b, t) => a + (b - a) * t;
  return 2 * lerp(lerp(lerp(at(0, 0, 0), at(1, 0, 0), fx), lerp(at(0, 1, 0), at(1, 1, 0), fx), fy),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), fx), lerp(at(0, 1, 1), at(1, 1, 1), fx), fy), fz) - 1;
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// How muddy (0 to 1) the car is at (x, y, z), facing n: caked up to MUD_LINE, and higher just
// behind each wheel, which throws it up and back, round the wheel arches, and on the back (the
// car's wake) and the front; above that, splashes, fewer higher up. None on top: the rain washes it.
const WHEEL_Z = [1.227, -1.285], WHEEL_Y = 0.296, WHEEL_R = 0.32;  // car.js's wheels
const MUD_LINE = 0.3, SPRAY = 0.25, BACK = 0.42, FRONT = 0.38;   // m
function mudAt(t, x, y, z, n) {
  if (n[1] > 0.6) return 0;
  const rough = noise(x * 9, y * 9, z * 9, 51) + 0.5 * noise(x * 25, y * 25, z * 25, 52);  // -1.5 to 1.5
  let line = MUD_LINE;
  for (const wz of WHEEL_Z) {
    const behind = wz - z;  // m behind the wheel's middle
    if (behind > 0) line = Math.max(line, MUD_LINE + SPRAY * smoothstep(0, 0.3, behind) * Math.exp(-Math.max(behind - 0.3, 0) / 0.3));
    if (Math.hypot(y - WHEEL_Y, z - wz) < WHEEL_R + 0.08 + 0.03 * rough) line = Math.max(line, y + 0.05);
  }
  if (n[2] < -0.5) line = Math.max(line, BACK);
  if (n[2] > 0.5) line = Math.max(line, FRONT);
  const above = y - line + 0.06 * rough;  // m above its edge
  if (above < 0.03) return smoothstep(0.03, -0.03, above);
  return random(t, 53) < 0.4 * Math.exp(-above / 0.1) ? 0.85 : 0;
}

// --- Put together ---

const rgb = Buffer.alloc(W * S * 3);
for (let t = 0; t < W * S; t++) {
  const k = (t >> 8) * S + (t & (S - 1));  // the model's texel
  let c = colour[t] ? colour[t].map(value => paint[k] ? value * shade[k] : value) : [...green.subarray(4 * k, 4 * k + 3)];
  const x = where[6 * t], n = where.subarray(6 * t + 3, 6 * t + 6);
  const lamp = colour[t] === BRAKE_LAMP, fleck = random(t, 55) < 0.3;
  if (lamp) c = [...BRAKE_LAMP];
  if (!Number.isNaN(x) && !light(k) && (ZEN ? lamp && fleck : !lamp || fleck)) {
    const mud = lamp ? 1 : mudAt(t, x, where[6 * t + 1], where[6 * t + 2], n);
    if (mud > 0) {
      // Drier higher up, and on the paint, darker in its panel lines, as the stickers are.
      const dry = smoothstep(0.1, 0.5, where[6 * t + 1]) * 0.7 + 0.3 * random(t, 54);
      const dirt = MUD_WET.map((w, i) => (w + (MUD_DRY[i] - w) * dry) * (paint[k] ? shade[k] : 1));
      c = c.map((value, i) => value + (dirt[i] - value) * mud);
    }
  }
  // Pure reds glow as the tail lights (car.frag): the livery's reds keep a little green.
  if (colour[t] && !lamp && c[0] > 102 && Math.max(c[1], c[2]) < 16) c[1] = 16;
  for (let i = 0; i < 3; i++) rgb[3 * t + i] = Math.max(0, Math.min(255, Math.round(c[i])));
}
const NAME = ZEN ? 'car3_zen.png' : 'car3_rally.png';
writeFileSync(new URL(NAME, DIR), png(W, S, rgb));
console.log(`wrote assets/Car 03/${NAME}`);

const zoomed = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (zoomed) {
  const Z = 6, big = Buffer.alloc(W * Z * S * Z * 3);
  for (let y = 0; y < S * Z; y++) for (let x = 0; x < W * Z; x++) rgb.copy(big, 3 * (y * W * Z + x), 3 * (Math.floor(y / Z) * W + Math.floor(x / Z)), 3 * (Math.floor(y / Z) * W + Math.floor(x / Z)) + 3);
  writeFileSync(zoomed, png(W * Z, S * Z, big));
  console.log(`wrote ${zoomed}`);
}

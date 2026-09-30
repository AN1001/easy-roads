// Textures made at startup, as the layers of one texture array: for the ground, earth banks, the
// forest floor, grass and the road's sand; for the bamboo, its culms, its leaves and its clumps far
// off; and the clouds. And the road's puddles, in a texture of their own (createPuddles).
// The ground's are square tiles that repeat seamlessly, 16 m across at 8 texels per metre: chunky,
// and still at least a pixel per texel on the road beside the car at 360 rows. The shaders multiply
// their own colours by them, so a texel is a brightness, with a tint, around 1, stored halved (128
// is × 1). Each layer's brightness averages exactly 1, so in the distance, where the mipmaps blur a
// texture to its average, things keep about their colours (tinted a little by the tints: the moss
// makes the bank and the floor a little greener).
// Alpha: the grass's tufts, which fray the road's edge; where the leaves are; how thick the clouds
// are; where the far clumps' stalks and leaves are; where the far stalks' leaves are.

export const TEXTURE_SIZE = 128;    // texels along each side
export const TEXELS_PER_METRE = 8;  // the ground's: must match terrain.frag
export const TEXTURE_LAYERS = 9;    // in this order (the shaders' *_LAYER constants):
export const BANK = 0, FLOOR = 1, GRASS = 2, SAND = 3, CULM = 4, LEAVES = 5, CLOUDS = 6, CLUMPS = 7, FAR_LEAVES = 8;

const N = TEXTURE_SIZE;

// RGBA bytes, one layer after another, for a texture array.
export function createTextures() {
  const pixels = new Uint8Array(N * N * 4 * TEXTURE_LAYERS);
  const layer = new Float32Array(N * N * 4);  // r, g, b brightness around 1, and alpha
  [bank, floor, grass, sand, culm, leaves, clouds, clumps, farLeaves].forEach((make, k) => {
    layer.fill(1);
    make(layer);
    pack(layer, pixels, k);
  });
  return pixels;
}

// The road's puddles, and how wet it is round them (terrain.frag): a texture PUDDLE_SIZE texels
// square at the ground's 8 per metre, so it repeats every PUDDLE_TILE m. Two bytes a texel: how wet
// (0 to 1), in broad patches; and 255 where it's a puddle, 0 where not. The puddles are the wettest
// patches, over PUDDLES, but only one in PUDDLE_ONE_IN of them: the rest are just damp. (Until 29
// Sep 2026, the sand's alpha, repeating every 16 m, and every one of them a puddle: ten times as
// many.) A byte of their own, rather than the wetness over PUDDLES, so the mipmaps blur a puddle far
// off to the share of a pixel it covers. Blurred first and then compared, the wetness fell short of
// PUDDLES from ~40 m, and by 100 m all of it, still clear of the mist: the puddles grew in as the
// car came up to them.
export const PUDDLE_SIZE = 512;                             // texels along each side
export const PUDDLE_TILE = PUDDLE_SIZE / TEXELS_PER_METRE;  // m: must match terrain.frag
const PUDDLES = 0.8, PUDDLE_ONE_IN = 10;

// RG bytes, for a texture.
export function createPuddles() {
  const S = PUDDLE_SIZE, texels = new Uint8Array(S * S * 2), wet = new Uint8Array(S * S);
  const noise = layeredTile(S, 32, 3, 85);
  for (let s = 0; s < S * S; s++) wet[s] = Math.round(255 * Math.min(Math.max(0.45 + 0.9 * noise[s], 0), 1));
  // The wettest patches: texels over PUDDLES, touching along a side or at a corner (so none is cut
  // in two), across the tile's edges too; each numbered by the first texel found.
  const over = Math.floor(255 * PUDDLES) + 1, patch = new Int32Array(S * S).fill(-1), firsts = [], stack = [];
  for (let s = 0; s < S * S; s++) {
    if (wet[s] < over || patch[s] >= 0) continue;
    patch[s] = firsts.length;
    stack.push(s);
    while (stack.length) {
      const t = stack.pop(), u = t % S, v = (t - u) / S;
      for (let dv = -1; dv <= 1; dv++) {
        for (let du = -1; du <= 1; du++) {
          const n = wrap(v + dv, S) * S + wrap(u + du, S);
          if (wet[n] >= over && patch[n] < 0) { patch[n] = firsts.length; stack.push(n); }
        }
      }
    }
    firsts.push(s);
  }
  // Which hold puddles: one in PUDDLE_ONE_IN, at random.
  const order = firsts.map((s, k) => k).sort((a, b) => random(firsts[a], 0, 86) - random(firsts[b], 0, 86));
  const puddle = new Uint8Array(firsts.length);
  for (let k = 0; k < Math.round(firsts.length / PUDDLE_ONE_IN); k++) puddle[order[k]] = 1;
  for (let s = 0; s < S * S; s++) {
    texels[2 * s] = wet[s];
    texels[2 * s + 1] = patch[s] >= 0 && puddle[patch[s]] ? 255 : 0;
  }
  return texels;
}

// Whether there's a puddle at world position (x, z): the texel terrain.frag shows there up close
// (⌊8x⌋, ⌊8z⌋ of the tile), so a tyre finds the same puddles as are drawn. `texels` is what
// createPuddles made.
export function puddleAt(texels, x, z) {
  const S = PUDDLE_SIZE, u = wrap(Math.floor(x * TEXELS_PER_METRE) | 0, S), v = wrap(Math.floor(z * TEXELS_PER_METRE) | 0, S);
  return texels[2 * (v * S + u) + 1] > 127;
}

// --- Noise that repeats every tile ---

// k modulo n, for n a power of two, also for negative k. (Bit masks, not %: on numbers that
// aren't known to be whole, % is a slow floating-point remainder.)
const wrap = (k, n) => k & (n - 1);

// Integer hash to 0..1: the same as terrain.js's.
function random(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smooth random values from -1 to 1 (value noise), on a grid of cells `cellU` × `cellV` texels.
// The grid wraps round at the edges of a tile `size` texels square (the layers', unless said), so
// each cell size must divide it: a power of two.
function smooth(u, v, cellU, cellV, seed, size = N) {
  const x = u / cellU, y = v / cellV, nx = size / cellU, ny = size / cellV;
  const xi = Math.floor(x) | 0, yi = Math.floor(y) | 0, fx = x - xi, fy = y - yi;
  const x0 = wrap(xi, nx), x1 = wrap(xi + 1, nx), y0 = wrap(yi, ny), y1 = wrap(yi + 1, ny);
  const a = random(x0, y0, seed), b = random(x1, y0, seed);
  const c = random(x0, y1, seed), d = random(x1, y1, seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return 2 * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) - 1;
}

// Layers of it, each on cells half the size and half as strong as the one before.
function layered(u, v, cell, count, seed, size = N) {
  let sum = 0, weight = 0, amplitude = 1;
  for (let k = 0; k < count; k++, cell /= 2, amplitude /= 2) {
    sum += amplitude * smooth(u, v, cell, cell, seed + k, size);
    weight += amplitude;
  }
  return sum / weight;
}

// The same for every texel of a tile `size` texels square, at once: cell by cell, each one's corners
// looked up once, and along each of its rows, a straight line between the eased ends.
function layeredTile(size, cell, count, seed) {
  const values = new Float64Array(size * size), ease = new Float64Array(cell);
  let weight = 0, amplitude = 1;
  for (let k = 0; k < count; k++, cell /= 2, amplitude /= 2) {
    const n = size / cell;
    for (let t = 0; t < cell; t++) { const f = t / cell; ease[t] = f * f * (3 - 2 * f); }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = random(i, j, seed + k), b = random(wrap(i + 1, n), j, seed + k);
        const c = random(i, wrap(j + 1, n), seed + k), d = random(wrap(i + 1, n), wrap(j + 1, n), seed + k);
        for (let y = 0; y < cell; y++) {
          const sy = ease[y], left = a + (c - a) * sy, slope = b - a + (a - b - c + d) * sy;
          const row = (j * cell + y) * size + i * cell;
          for (let x = 0; x < cell; x++) values[row + x] += amplitude * (2 * (left + slope * ease[x]) - 1);
        }
      }
    }
    weight += amplitude;
  }
  for (let o = 0; o < values.length; o++) values[o] /= weight;
  return values;
}

// One random point in each `cell` × `cell` square (also wrapping round): for stones and cracks.
// Leaves in `found` the distance to the nearest point, to the second nearest, and a random number
// for the nearest one's cell (0..1).
const found = new Float64Array(3);
function cells(u, v, cell, seed) {
  const n = N / cell, ci = Math.floor(u / cell) | 0, cj = Math.floor(v / cell) | 0;
  found[0] = found[1] = Infinity;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      const wi = wrap(i, n), wj = wrap(j, n);
      const dx = (i + random(wi, wj, seed)) * cell - u, dy = (j + random(wi, wj, seed + 1)) * cell - v;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < found[0]) { found[1] = found[0]; found[0] = d; found[2] = random(wi, wj, seed + 2); }
      else if (d < found[1]) found[1] = d;
    }
  }
}

function set(layer, u, v, r, g, b) {
  const o = (v * N + u) * 4;
  layer[o] = r; layer[o + 1] = g; layer[o + 2] = b;
}

// Scaled so the brightness (red, green and blue together) averages 1, halved, as bytes; alpha as it
// is. (Not each channel on its own: that would take a tint on some texels off all the rest.)
function pack(layer, pixels, k) {
  const base = k * N * N * 4;
  let sum = 0;
  for (let o = 0; o < layer.length; o += 4) sum += layer[o] + layer[o + 1] + layer[o + 2];
  const scale = 3 * 127.5 * N * N / sum;
  for (let o = 0; o < layer.length; o++) {
    pixels[base + o] = Math.min(255, Math.round(layer[o] * ((o & 3) === 3 ? 255 : scale)));
  }
}

// --- The layers ---

// A tint: multiplies a texel's red, green and blue.
function tint(layer, u, v, r, g, b) {
  const o = (v * N + u) * 4;
  layer[o] *= r; layer[o + 1] *= g; layer[o + 2] *= b;
}
const MOSS = [0.8, 1.2, 0.6];

// Banks, which terrain.frag hangs on slopes with its rows level (v is height, 0 at the bottom):
// dark earth with stones bedded in it, each lit along its top and shadowed beneath, darker runs
// where water trickles down, and moss in patches, mostly on the stones.
function bank(layer) {
  const stone = new Float32Array(N * N);  // per texel: 0, or the stone's own shade
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      cells(u + 0.5, v + 0.5, 8, 51);  // a stone in a third of the squares a metre across
      if (found[2] < 0.33 && found[0] < 1.5 + 6 * found[2]) stone[v * N + u] = 1.1 + 0.6 * found[2];
    }
  }
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const s = stone[v * N + u], above = stone[wrap(v + 1, N) * N + u], below = stone[wrap(v - 1, N) * N + u];
      let value = 0.85 + 0.12 * layered(u, v, 32, 3, 52) + 0.16 * (random(u, v, 53) - 0.5);
      if (s) {
        value = s + 0.1 * (random(u, v, 54) - 0.5);
        if (!above) value += 0.15;       // its top, lit
        else if (!below) value -= 0.25;  // its underside
      } else if (above) value -= 0.2;    // the shadow under a stone
      const run = Math.max(0, smooth(u, v, 4, 32, 55));  // thin runs down the slope
      value *= 1 - 0.3 * run * run;
      set(layer, u, v, value, value, value);
      const moss = layered(u, v, 16, 3, 56) + (s ? 0.25 : 0);
      if (moss > 0.2) tint(layer, u, v, ...MOSS);
    }
  }
}

const STEP_U = [1, 1, 0, -1, -1, -1, 0, 1], STEP_V = [0, 1, 1, 1, 0, -1, -1, -1];  // 8 directions

// The forest floor, seen from above (u is x, v is z): fallen leaves, long and thin (bamboo's), some
// pale and dry, some dark and wet, over dark earth, and moss in patches.
function floor(layer) {
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const value = 0.7 + 0.1 * layered(u, v, 16, 3, 61) + 0.1 * (random(u, v, 62) - 0.5);
      set(layer, u, v, value, value * 0.95, value * 0.85);
    }
  }
  // Leaves: 2-3 texels (25-40 cm) along one of 8 directions.
  for (let k = 0; k < N * N / 2; k++) {
    let u = Math.floor(random(k, 0, 63) * N), v = Math.floor(random(k, 1, 63) * N);
    const d = Math.floor(random(k, 2, 63) * 8), length = 2 + Math.floor(random(k, 3, 63) * 2);
    const dry = random(k, 4, 63) < 0.4, value = dry ? 1.2 + 0.25 * random(k, 5, 63) : 0.85 + 0.15 * random(k, 5, 63);
    for (let t = 0; t < length; t++) {
      set(layer, u, v, value * (dry ? 1.12 : 1.05), value, value * (dry ? 0.7 : 0.8));
      u = wrap(u + STEP_U[d], N); v = wrap(v + STEP_V[d], N);
    }
  }
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) if (layered(u, v, 32, 3, 64) > 0.15) tint(layer, u, v, ...MOSS);
  }
}

// Grass along the road, seen from above: blades in clumps, each texel its own shade and some of
// them yellowing, dark between the clumps. Alpha: the clumps' tufts, for fraying the road's edge.
function grass(layer) {
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      cells(u + 0.5, v + 0.5, 4, 71);
      let value = 0.8 + 0.4 * random(u, v, 72) + 0.2 * found[2];
      if (found[1] - found[0] < 0.6) value -= 0.25;  // between clumps
      const yellow = random(u, v, 73) < 0.15 ? 0.15 : 0;
      set(layer, u, v, value * (1 + yellow), value, value * (1 - yellow));
      layer[(v * N + u) * 4 + 3] = Math.min(Math.max(0.5 + 0.8 * layered(u, v, 8, 2, 74), 0), 1);
    }
  }
}

// The road: sandy dirt, fine grit, scattered pebbles, each shadowed on one side, and a few dark
// stones. (How wet it is, and its puddles: createPuddles.)
function sand(layer) {
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      let value = 1 + 0.08 * layered(u, v, 16, 3, 81) + 0.14 * (random(u, v, 82) - 0.5);
      const pebble = random(u, v, 83);
      if (pebble < 0.025) value += 0.3;
      else if (pebble > 0.99) value -= 0.3;
      else if (random(wrap(u - 1, N), wrap(v - 1, N), 83) < 0.025) value -= 0.18;  // a pebble's shadow
      const warm = 0.04 * smooth(u, v, 64, 64, 84);
      set(layer, u, v, value * (1 + warm), value, value * (1 - warm));
    }
  }
}

// Bamboo culms (bamboo.js): N / CULM_STRIP strips side by side, each CULM_STRIP texels across (once
// round a stalk) and 4 m tall (v, up the stalk); each stalk wears one. Smooth, with faint streaks
// up it, and ringed at its nodes every 31-44 cm: a pale ridge, the dark scar where the sheath fell
// just under it, and a whitish band of wax under that. Some are blotched with lichen, a few with rot.
export const CULM_STRIP = 4;             // texels: must match bamboo.glsl
export const CULM_TEXELS_PER_METRE = 32; // up the stalk: must match bamboo.glsl
const LICHEN = [1.35, 1.15, 1.9];        // on the culm's green: pale grey-green
function culm(layer) {
  const isNode = new Uint8Array(N);
  for (let s = 0; s < N / CULM_STRIP; s++) {
    // Nodes evenly spaced, so the strip repeats, a few nudged up a texel.
    const count = 9 + Math.floor(random(s, 0, 91) * 4), first = random(s, 1, 91) * N;
    isNode.fill(0);
    for (let k = 0; k < count; k++) isNode[wrap(Math.floor(first + k * N / count + (random(s, k, 92) < 0.3 ? 1 : 0)) | 0, N)] = 1;
    const old = random(s, 2, 91) < 0.35, rotten = random(s, 3, 91) < 0.1;
    for (let v = 0; v < N; v++) {
      let toNode = 0;  // texels up to the next node (0: this is one)
      while (!isNode[wrap(v + toNode, N)]) toNode++;
      for (let t = 0; t < CULM_STRIP; t++) {
        const u = s * CULM_STRIP + t;
        let value = 1 + 0.08 * (random(u, 0, 93) - 0.5) + 0.06 * smooth(u, v, 4, 16, 94);
        if (toNode === 0) value += 0.25;                  // the node's ridge
        else if (toNode === 1) value -= 0.3;              // the scar under it
        else if (isNode[wrap(v - 1, N)]) value -= 0.08;   // the ridge's shadow over it
        set(layer, u, v, value, value, value);
        if (toNode >= 2 && toNode <= 4) tint(layer, u, v, 1.1, 1.08, 1.35);  // wax
        if (old && layered(u + 7 * s, v, 16, 2, 95) > 0.25) tint(layer, u, v, ...LICHEN);
        if (rotten && layered(u + 11 * s, v, 8, 2, 96) > 0.45) tint(layer, u, v, 0.5, 0.45, 0.4);
      }
    }
  }
}

// A card of bamboo leaves (bamboo.js), seen side on: u across (the stalk up the middle), v up, from
// where the branches start to the top of the stalk. Alpha: 1 on a leaf or twig, 0 between (and all
// round the edge, so mipmaps don't bleed in from the far side).
function leaves(layer) {
  for (let o = 3; o < layer.length; o += 4) layer[o] = 0;
  sprays(plotter(layer, 1, N - 2), N / 2, 0, N, N / 2 - 3, 1, 0);
}

// The card a far stalk's leaves are drawn on, facing the camera (bamboo.js): what the near stalk's 3
// cards, crossed at 60°, look like from the side. One is seen face on, the other two at 60° either
// side, so half as wide (one of them from behind: the other way round). As thick with leaves, so a
// stalk looks the same as it swaps from one to the other. (One card of leaves until 29 Sep 2026:
// the near stalks' leaves were twice as thick, and filled in as the car came up to them.)
function farLeaves(layer) {
  for (let o = 3; o < layer.length; o += 4) layer[o] = 0;
  crossed(plotter(layer, 1, N - 2), N / 2, (plot, squeeze) => sprays(plot, N / 2, 0, N, N / 2 - 3, 1, 0));
}

// Calls draw(plot, squeeze) three times, for the three crossed cards seen from the side: `plot`
// squeezes what's drawn towards column u0, by 1, 0.5 and -0.5.
function crossed(plot, u0, draw) {
  for (const squeeze of [1, 0.5, -0.5]) draw((u, v, r, g, b) => plot(u0 + (u - u0) * squeeze, v, r, g, b), squeeze);
}

// Plots opaque texels of a layer between columns `left` and `right`, and inside its top and bottom
// rows: the rest are left see-through.
function plotter(layer, left, right) {
  return (u, v, r, g, b) => {
    u = Math.round(u); v = Math.round(v);
    if (u < left || u > right || v < 1 || v > N - 2) return;
    set(layer, u, v, r, g, b);
    layer[(v * N + u) * 4 + 3] = 1;
  };
}

// A stalk's leaves, from a stalk up column `u0` from row `from` to `to`, plotted with `plot`: twigs
// leave the stalk every 3-5 texels, either side, arch out and droop, longest (`reach` texels) two
// fifths of the way up; along each hang fans of narrow leaves, 5-10 texels × `leaf` long, down and
// out. A leaf is a shade of its own; a few are yellowing. `seed`: 0 for the leaves' card; others
// for other stalks.
function sprays(plot, u0, from, to, reach, leaf, seed) {
  let k = 0;
  for (let v0 = from + 4; v0 < to - 4; v0 += 3 + 2 * random(k, 0, 97 + seed), k++) {
    const side = random(k, 4, 97 + seed) < 0.5 ? 1 : -1, up = (v0 - from) / (to - from);
    const crown = Math.sin(Math.PI * Math.min(up / 0.8, 1) ** 0.7);  // 0 at the bottom, 1 at 2/5, 0 at the top
    const length = reach * (0.25 + 0.75 * crown) * (0.75 + 0.25 * random(k, 1, 97 + seed));
    const rise = 0.2 + 0.4 * random(k, 2, 97 + seed);
    const twigV = t => v0 + length * (rise * t - 0.5 * t * t);
    for (let t = 0; t <= 1; t += 1 / length) plot(u0 + side * t * length, twigV(t), 0.55, 0.5, 0.4);
    for (let t = 0.15; t <= 1; t += 0.07 + 0.05 * random(k, 3, 97 + seed)) {
      const tu = u0 + side * t * length, tv = twigV(t);
      const fan = 3 + Math.floor(random(k, t * 100, 98 + seed) * 4);
      for (let l = 0; l < fan; l++) {
        const each = k * 97 + l * 13 + Math.floor(t * 1000);
        const angle = 0.2 - 1.6 * (l + random(each, 0, 99 + seed)) / fan, leafLength = leaf * (5 + 5 * random(each, 1, 99 + seed));
        const dryLeaf = random(each, 2, 99 + seed) < 0.1, shade = 0.75 + 0.5 * random(each, 3, 99 + seed);
        const r = shade * (dryLeaf ? 1.45 : 1), g = shade * (dryLeaf ? 1.2 : 1), b = shade * (dryLeaf ? 0.55 : 1);
        for (let d = 1; d <= leafLength; d++) {
          const droop = 0.04 * d * d / leaf;  // leaves curve down towards their tips
          plot(tu + side * d * Math.cos(angle), tv + d * Math.sin(angle) - droop, r, g, b);
        }
      }
    }
  }
}

// Two pictures of a clump of bamboo far off (bamboo.js), side by side, each half the width: u across
// the square it stands for (6 m), v up from its foot to the top of its tallest stalk; about 10.7
// texels a metre each way, at 12 m. In each, STALKS stalks, 2 texels across, 60-97% of the height,
// leaning a little, darker lower down in the shade of the leaves, ringed at their nodes, and their
// leaves (as the leaves' card, smaller) from 45% of the way up. The colours are shades of the
// leaves' (clump.vert): the stalks paler and yellower. Alpha as the leaves'.
const STALKS = 7;
const CULM_SHADE = [1.35, 1.2, 1.35];  // a stalk, lit, against the leaves' green
function clumps(layer) {
  for (let o = 3; o < layer.length; o += 4) layer[o] = 0;
  for (let picture = 0; picture < 2; picture++) {
    const left = picture * N / 2, plot = plotter(layer, left + 1, left + N / 2 - 2);
    for (let k = 0; k < STALKS; k++) {
      const seed = 10 * (picture * STALKS + k + 1);
      const u0 = left + 8 + (N / 2 - 16) * random(k, picture, 111), top = N * (k === 0 ? 0.97 : 0.6 + 0.35 * random(k, picture, 112));
      const lean = 0.08 * (random(k, picture, 113) - 0.5), node = 3 + random(k, picture, 114);
      for (let v = 0; v < top; v++) {
        const shade = (0.55 + 0.45 * Math.min(v / (0.6 * top), 1)) * (v % node < 1 ? 0.75 : 1);
        for (let w = 0; w < 2; w++) plot(u0 + lean * v + w, v, CULM_SHADE[0] * shade, CULM_SHADE[1] * shade, CULM_SHADE[2] * shade);
      }
      // Its leaves as a far stalk's (farLeaves): as thick as a near one's.
      crossed((u, v, r, g, b) => plot(u + lean * v, v, r, g, b), u0 + 1, plot => sprays(plot, u0 + 1, 0.45 * top, top, 0.17 * top, 0.5, seed));
    }
  }
}

// Clouds, seen from below (u and v along the ground): alpha is how thick they are, in soft-edged
// banks with gaps between, about half the sky.
function clouds(layer) {
  for (let v = 0; v < N; v++) {
    for (let u = 0; u < N; u++) {
      const d = layered(u, v, 32, 4, 101);
      const t = Math.min(Math.max((d + 0.2) / 0.6, 0), 1);
      layer[(v * N + u) * 4 + 3] = t * t * (3 - 2 * t);
    }
  }
}

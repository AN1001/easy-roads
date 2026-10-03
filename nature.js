// The ground cover: grass, wildflowers, reeds, ferns, bushes and rocks, all made here at startup
// (no models or images to load), in the cherry trees' way (trees.js): simple shapes, coloured per
// vertex, the leafy ones wearing the game's own textures (textures.js: LEAF, FLOWERING). Drawn by
// nature.vert / nature.frag, each kind once for all its copies (instanced). (Until 3 Oct 2026, a
// CC0 nature pack's models and texel-art textures: they didn't fit the rest.)
//
// Made to be cheap to draw: the grass, reeds, ferns and rocks are solid triangles (no texture);
// only the bushes' leaves are cut out of cards, laid over a solid core, flat round it rather than
// crossing it, so few are drawn over each other. Far off, each fades out, dithered (nature.frag),
// where the mist's thick enough that it's hardly seen going (shrinking them away, until 3 Oct 2026,
// was: bushes growing in as the car came up to them, and the grass a ring round the car).
//
// The grass (tufts, tall grass, wildflowers, reeds) is off (GRASS): fading out by 30 m, it showed;
// further, it cost too much (asked for, 3 Oct 2026: better none).
//
// Where they grow: scattered over the land by each chunk as it's built (scatter), each on its own
// square of the world (so a chunk and the finer ones that take over from it agree where), at a
// random point in it, kept or not by what the chunk's vertices say is there: how far from the
// road's edge, how thick the bamboo, riverbed or not, how steep.
// - Grass tufts everywhere the ground's open (the verges, the clearings), some tall, wildflowers
//   among them in the clearings; reeds on the river's banks; a few tufts under the bamboo.
// - Ferns under the bamboo and along its edges.
// - Bushes, thickest at the groves' edges, some in flower in the open.
// - Rocks: stones and rocks here and there, more on the river's banks and on steep ground; now and
//   then a boulder, which stops the car (rockWall).
// The grass and ferns from the finest chunks only (to 100 m: terrain.js's DETAIL), bushes and rocks
// from the two finest (to 220 m).

import { CHUNK_QUADS, VERTEX_SHORTS } from './terrain.js';
import { LEAF, FLOWERING } from './textures.js';

export const NATURE_FLOATS = 13;  // per vertex: position, normal, u, v, how much it sways, colour, texture layer (-1 none, -2 rock)
export const INSTANCE_FLOATS = 5;  // per copy: where it stands (x, y, z), how it's turned, its size
const CHUNK_VERTS = CHUNK_QUADS + 1;
const NONE = -1, ROCK = -2;

// Distance fades (m): from the first, dithered out to nothing by the second. (The mist: ~30% at 45 m,
// ~50% at 100, ~65% at 130.)
const GRASS = false;
const GRASS_FADE = [20, 30], FERN_FADE = [40, 55], BUSH_FADE = [95, 130], ROCK_FADE = [80, 110];

// A small random number generator: the same seed, the same shape.
function generator(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const unit = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mix = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
const scale = (a, k) => a.map(x => x * k);

// A model being made: vertices (NATURE_FLOATS each) and triangles (indices).
function builder() {
  const vertices = [], indices = [];
  return {
    vertices, indices,
    vertex(p, n, u, v, sway, color, layer) {
      vertices.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, sway, color[0], color[1], color[2], layer);
      return vertices.length / NATURE_FLOATS - 1;
    },
    triangle(a, b, c) { indices.push(a, b, c); },
    done() { return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) }; },
  };
}

// --- Grass ---

const BLADE_ROOT = [0.07, 0.11, 0.04];  // dark among the blades
const BLADE_TIP = [0.24, 0.33, 0.12], BLADE_DRY = [0.33, 0.32, 0.14];  // the meadow's (terrain.frag), lit
// A blade from (x, 0, z): `height` m, leaning `lean` m out along (dx, dz) at its tip, `width` m at
// its foot: one triangle (more, bent, measured too slow: far off, a blade's under a pixel, and each
// of its triangles costs the GPU a few pixels' shading anyway). Lit mostly as the ground under it
// is (its normal mostly up), so a tuft sits in the meadow rather than standing out of it.
function blade(m, x, z, dx, dz, height, lean, width, root, tip, tallest) {
  const sx = -dz * width / 2, sz = dx * width / 2;  // across it
  const n = unit([dx * 0.4, 1, dz * 0.4]);
  const a0 = m.vertex([x - sx, -0.05, z - sz], n, 0, 0, 0, root, NONE), a1 = m.vertex([x + sx, -0.05, z + sz], n, 0, 0, 0, root, NONE);
  const top = m.vertex([x + dx * lean, height, z + dz * lean], n, 0, 0, (height / tallest) ** 2, tip, NONE);
  m.triangle(a0, a1, top);
}

// A tuft: `blades` blades from round its middle, leaning out every way, `height` m (each a little
// more or less), some tips dry.
function tuft(m, random, blades, height, lean, width, spread = 0.12, root = BLADE_ROOT, green = BLADE_TIP, dry = BLADE_DRY) {
  for (let k = 0; k < blades; k++) {
    const a = (k + 0.5 * random()) / blades * 2 * Math.PI, r = spread * Math.sqrt(random());
    const dx = Math.cos(a), dz = Math.sin(a), h = height * (0.6 + 0.5 * random());
    const tip = scale(mix(green, dry, random() < 0.25 ? 0.4 + 0.6 * random() : 0.2 * random()), 0.8 + 0.35 * random());
    blade(m, dx * r, dz * r, dx, dz, h, lean * h * (0.6 + 0.6 * random()), width * (0.8 + 0.4 * random()), root, tip, height * 1.1);
  }
}

// A flower on a stem: a thin blade, and at its top a five-pointed star facing up and out, its
// petals two triangles each (so it reads as a dot of colour, from above or side on).
function flower(m, random, x, z, height, color) {
  const a = random() * 2 * Math.PI, dx = Math.cos(a), dz = Math.sin(a);
  blade(m, x, z, dx, dz, height, 0.06, 0.02, BLADE_ROOT, BLADE_TIP, height);
  const top = [x + dx * 0.06, height, z + dz * 0.06], n = unit([dx * 0.3, 1, dz * 0.3]);
  // A head: a little four-pointed star, two triangles.
  const size = 0.06 + 0.03 * random(), turn = random() * Math.PI;
  const point = k => { const t = turn + k * Math.PI / 2; return m.vertex([top[0] + Math.cos(t) * size, top[1] + (k % 2) * 0.02, top[2] + Math.sin(t) * size], n, 0, 0, 1, scale(color, k % 2 ? 0.85 : 1), NONE); };
  const ids = [0, 1, 2, 3].map(point);
  m.triangle(ids[0], ids[1], ids[2]); m.triangle(ids[0], ids[2], ids[3]);
}
const FLOWER_COLORS = [[0.85, 0.84, 0.76], [0.85, 0.66, 0.14], [0.52, 0.38, 0.72], [0.82, 0.48, 0.58]];  // white, buttercup, violet, pink

// Reeds: tall, straight, narrow, darker; and one or two bulrushes, each a brown head on a stem.
function reeds(m, random) {
  tuft(m, random, 9, 1.2, 0.25, 0.035, 0.15, [0.06, 0.09, 0.04], [0.20, 0.27, 0.11], [0.30, 0.29, 0.14]);
  const heads = 1 + Math.floor(random() * 2);
  for (let k = 0; k < heads; k++) {
    const x = (random() - 0.5) * 0.15, z = (random() - 0.5) * 0.15, h = 1.2 + 0.3 * random();
    blade(m, x, z, 1, 0, h, 0.04, 0.02, BLADE_ROOT, [0.2, 0.25, 0.1], h);
    // The head: a three-sided spindle, 22 cm long, pointed at both ends.
    const brown = [0.22, 0.13, 0.07], from = h - 0.3, to = h - 0.04, r = 0.035;
    const bottom = m.vertex([x + 0.04, from, z], [0, -1, 0], 0, 0, 1, brown, NONE), tip = m.vertex([x + 0.04, to, z], [0, 1, 0], 0, 0, 1, brown, NONE);
    const ring = [0, 1, 2].map(s => { const a = s / 3 * 2 * Math.PI, n = [Math.cos(a), 0.3, Math.sin(a)]; return m.vertex([x + 0.04 + n[0] * r, (from + to) / 2, z + n[2] * r], n, 0, 0, 1, scale(brown, 1.15), NONE); });
    for (let s = 0; s < 3; s++) { m.triangle(bottom, ring[(s + 1) % 3], ring[s]); m.triangle(ring[s], ring[(s + 1) % 3], tip); }
  }
}

// --- Ferns ---

// A fern: `fronds` fronds arching out from its middle, each a stem with pairs of leaflets along it
// (one triangle each, on the stem's points, shared), longest a third of the way out, dipping towards
// the frond's tip.
const FERN_STEPS = 5;
function fern(m, random, fronds, length) {
  for (let f = 0; f < fronds; f++) {
    const a = (f + 0.4 * random()) / fronds * 2 * Math.PI, dx = Math.cos(a), dz = Math.sin(a);
    const L = length * (0.75 + 0.4 * random()), rise = 0.45 + 0.25 * random();
    const shade = 0.85 + 0.3 * random(), n = unit([dx * 0.3, 1, dz * 0.3]);
    const color = t => scale(mix([0.08, 0.17, 0.05], [0.20, 0.33, 0.10], t), shade);
    const at = t => [dx * L * t, L * rise * Math.sin(Math.PI * t * 0.85) - 0.05, dz * L * t];
    const stem = [];
    for (let s = 0; s <= FERN_STEPS; s++) { const t = s / FERN_STEPS; stem.push(m.vertex(at(t), n, 0, 0, t * t, scale(color(t), 0.85), NONE)); }
    for (let s = 0; s < FERN_STEPS; s++) {
      const t = (s + 0.6) / FERN_STEPS, p = at(t);
      const reach = L * 0.26 * Math.sin(Math.PI * Math.min(t * 1.2, 1)) ** 0.7 + 0.04;
      for (const side of [-1, 1]) {
        const tip = m.vertex([p[0] - dz * side * reach + dx * reach * 0.35, p[1] - reach * 0.35, p[2] + dx * side * reach + dz * reach * 0.35], n, 0, 0, t * t, scale(color(t), 1.1), NONE);
        m.triangle(stem[s], stem[s + 1], tip);
      }
    }
  }
}

// --- Bushes ---

// Leaf cards a bush (22 until 3 Oct 2026, a little smaller: 16 measured as full, and cheaper).
const BUSH_CARDS = 16;
const LEAF_GREENS = [[0.15, 0.25, 0.08], [0.18, 0.28, 0.09], [0.13, 0.22, 0.08], [0.22, 0.28, 0.10]];
// The flowers' colours (nature.frag's uBloom): white, pink, lilac, muted (asked for: 0.85-0.88 at
// first, too vibrant).
const BLOOMS = [[0.52, 0.53, 0.50], [0.56, 0.42, 0.47], [0.47, 0.42, 0.56]];
// The points of an icosahedron (12 points, 20 triangles: `ball.coarse`), and with each edge split
// once: 42 points round a ball, and 80 triangles.
const ball = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let points = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const coarse = { points: points.slice(), faces };
  const middles = new Map();
  const middle = (a, b) => {
    const key = Math.min(a, b) * 64 + Math.max(a, b);
    if (!middles.has(key)) { points.push(unit(mix(points[a], points[b], 0.5))); middles.set(key, points.length - 1); }
    return middles.get(key);
  };
  faces = faces.flatMap(([a, b, c]) => { const ab = middle(a, b), bc = middle(b, c), ca = middle(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  return { points, faces, coarse };
})();
// A lumpy ball: the ball's points out from `centre` by `radii`, each by its own amount (1 ± lumps).
function lumpy(random, centre, radii, lumps, shape = ball) {
  return shape.points.map(p => { const r = 1 + lumps * (random() - 0.5); return [centre[0] + p[0] * radii[0] * r, centre[1] + p[1] * radii[1] * r, centre[2] + p[2] * radii[2] * r]; });
}

// A bush: a dark core (a lumpy ball, `radii` m, its middle at `rise` of its height above the
// ground), and LEAF cards laid round it, `cards` of them, each facing out from the middle (tilted a
// little), so the leaves make its outline; in flower, the cards FLOWERING's (leaves with flowers
// over them) instead. Lit as if facing out from the middle and up, as the cherries' blossom is.
function bush(m, random, radii, cards, flowering = false) {
  const centre = [0, radii[1] * 0.8, 0];
  // (The coarse ball: the cards hide most of it.)
  const core = lumpy(random, centre, radii.map(r => r * 0.82), 0.2, ball.coarse);
  const lit = p => unit([p[0] - centre[0], (p[1] - centre[1]) * 0.6 + 0.5 * radii[1], p[2] - centre[2]]);
  const sway = p => 0.4 * Math.max(p[1] / (2 * radii[1]), 0) ** 2;
  const coreIds = core.map(p => m.vertex(p, lit(p), 0, 0, sway(p), scale([0.06, 0.10, 0.04], 0.8 + 0.4 * random()), NONE));
  for (const [a, b, c] of ball.coarse.faces) m.triangle(coreIds[a], coreIds[b], coreIds[c]);
  for (let k = 0; k < cards; k++) {
    // A point on the core's surface, mostly the upper part.
    const y = -0.45 + 1.45 * random(), a = random() * 2 * Math.PI, r = Math.sqrt(Math.max(1 - y * y, 0));
    const out = unit([r * Math.cos(a), y, r * Math.sin(a)]);
    const point = [centre[0] + out[0] * radii[0] * 0.95, centre[1] + out[1] * radii[1] * 0.95, centre[2] + out[2] * radii[2] * 0.95];
    const facing = unit([out[0] + 0.6 * (random() - 0.5), out[1] + 0.6 * (random() - 0.5), out[2] + 0.6 * (random() - 0.5)]);
    const e1 = unit(cross(facing, Math.abs(facing[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = cross(facing, e1);
    const turn = random() * 2 * Math.PI, c = Math.cos(turn), s = Math.sin(turn);
    const u1 = [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s], u2 = cross(facing, u1);
    const half = 1.15 * (0.5 + 0.25 * random()) * Math.min(1.2, (radii[0] + radii[1]) / 1.1);
    const color = scale(LEAF_GREENS[Math.floor(random() * LEAF_GREENS.length)], 0.8 + 0.4 * random());
    const ids = [[-1, -1, 0, 0], [1, -1, 8, 0], [1, 1, 8, 8], [-1, 1, 0, 8]].map(([i, j, u, v]) => {
      const p = [point[0] + (u1[0] * i + u2[0] * j) * half, point[1] + (u1[1] * i + u2[1] * j) * half, point[2] + (u1[2] * i + u2[2] * j) * half];
      return m.vertex(p, lit(p), u, v, sway(p), color, flowering ? FLOWERING : LEAF);
    });
    m.triangle(ids[0], ids[1], ids[2]); m.triangle(ids[0], ids[2], ids[3]);
  }
}

// --- Rocks ---

const STONE = [0.30, 0.29, 0.27];
// A rock: a lumpy ball, `radii` m, its foot `buried` of its height in the ground, flattened
// underneath; each vertex its own shade of grey. Each face lit partly flat (so it reads as stone,
// faceted) and partly smooth.
function rock(m, random, x, z, radii, buried, lumps = 0.35, shape = ball) {
  const centre = [x, radii[1] * (1 - 2 * buried), z];
  const points = lumpy(random, centre, radii, lumps, shape).map(p => [p[0], Math.max(p[1], centre[1] - radii[1] * 0.6), p[2]]);
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  // A face's normal, turned to point out of the rock.
  const faceNormal = ([a, b, c]) => {
    const n = unit(cross(sub(points[b], points[a]), sub(points[c], points[a]))), out = sub(points[a], centre);
    return n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? scale(n, -1) : n;
  };
  const smooth = points.map(() => [0, 0, 0]);
  for (const f of shape.faces) { const n = faceNormal(f); for (const v of f) for (let k = 0; k < 3; k++) smooth[v][k] += n[k]; }
  const tone = scale(mix(STONE, [0.31, 0.28, 0.24], random()), 0.85 + 0.3 * random());
  const shades = points.map(() => scale(tone, 0.8 + 0.4 * random()));
  for (const f of shape.faces) {
    const n = faceNormal(f);
    const ids = f.map(v => m.vertex(points[v], unit(mix(unit(smooth[v]), n, 0.55)), 0, 0, 0, shades[v], ROCK));
    m.triangle(ids[0], ids[1], ids[2]);
  }
}

// --- The kinds ---

// Squares (m) for each (see scatter).
const TUFT_CELL = 1, FERN_CELL = 3, BUSH_CELL = 6, ROCK_CELL = 5;

// Each: its model, how big each copy is (× the model, from the first to the second at random), how
// far it's seen, how far its top stirs in the wind (m), for a boulder, how far round it stops the
// car (m, × its size), and for one in flower, its flowers' colour. And where it grows (scatter): on
// squares `cell` m across, from the chunks of levels up to `level`.
function make(seed, draw) {
  const m = builder(), random = generator(seed);
  draw(m, random);
  return m.done();
}
const kind = (seed, size, fade, sway, draw, wall = 0) => ({ model: make(seed, draw), size, fade, sway, wall, bloom: null });
const TUFTS = [1, 2, 3, 4].map(k => kind(10 + k, [0.8, 1.3], GRASS_FADE, 0.1, (m, r) => tuft(m, r, 9, 0.35, 0.35, 0.06)));
const TALL = [1, 2].map(k => kind(20 + k, [0.8, 1.2], GRASS_FADE, 0.15, (m, r) => tuft(m, r, 8, 0.7, 0.45, 0.055, 0.15)));
const FLOWERS = FLOWER_COLORS.map((color, k) => kind(30 + k, [0.8, 1.2], GRASS_FADE, 0.1, (m, r) => {
  tuft(m, r, 7, 0.3, 0.35, 0.05);
  for (let f = 0; f < 3 + k % 2; f++) flower(m, r, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, 0.35 + 0.2 * r(), FLOWER_COLORS[(k + (f === 2 ? 1 : 0)) % FLOWER_COLORS.length]);
}));
const REEDS = [1, 2].map(k => kind(40 + k, [0.8, 1.2], GRASS_FADE, 0.12, reeds));
const FERNS = [1, 2, 3].map(k => kind(50 + k, [0.8, 1.4], FERN_FADE, 0.06, (m, r) => fern(m, r, 6 + k, 0.8 + 0.15 * k)));
const BUSHES = [[0.7, 0.6, 0.7], [1.0, 0.5, 0.85], [0.55, 0.85, 0.6], [0.85, 0.7, 0.8]]
  .map((radii, k) => kind(60 + k, [0.9, 1.5], BUSH_FADE, 0.05, (m, r) => bush(m, r, radii, BUSH_CARDS)));
const IN_FLOWER = BLOOMS.map((bloom, k) => ({ ...kind(70 + k, [0.9, 1.4], BUSH_FADE, 0.05, (m, r) => bush(m, r, [0.7 + 0.1 * k, 0.6, 0.7], BUSH_CARDS, true)), bloom }));
const STONES = [1, 2].map(k => kind(80 + k, [0.7, 1.3], ROCK_FADE, 0, (m, r) => {
  for (let s = 0; s < 3 + k; s++) { const a = r() * 6.28, d = 0.2 + 0.35 * r(), size = 0.12 + 0.12 * r(); rock(m, r, Math.cos(a) * d, Math.sin(a) * d, [size * 1.2, size * 0.7, size], 0.25, 0.35, ball.coarse); }
}));
const ROCKS = [1, 2, 3].map(k => kind(90 + k, [0.7, 1.3], ROCK_FADE, 0, (m, r) => rock(m, r, 0, 0, [0.45 + 0.1 * k, 0.32 + 0.05 * k, 0.4], 0.3, 0.3, ball.coarse)));
const SLABS = [kind(100, [0.8, 1.3], ROCK_FADE, 0, (m, r) => rock(m, r, 0, 0, [0.9, 0.25, 0.65], 0.35, 0.25))];
export const BOULDER_RADIUS = 1.0;  // m, at size 1
const BOULDERS = [1, 2].map(k => kind(110 + k, [0.9, 1.3], ROCK_FADE, 0, (m, r) => rock(m, r, 0, 0, [1.15, 0.85 + 0.15 * k, 1.0], 0.25, 0.3), BOULDER_RADIUS));
// (The solid ones first: they hide some of the bushes.)
export const KINDS = [...(GRASS ? [...TUFTS, ...TALL, ...FLOWERS, ...REEDS] : []), ...FERNS, ...STONES, ...ROCKS, ...SLABS, ...BOULDERS, ...BUSHES, ...IN_FLOWER];
for (const [list, cell, level] of [[TUFTS, TUFT_CELL, 0], [TALL, TUFT_CELL, 0], [FLOWERS, TUFT_CELL, 0], [REEDS, TUFT_CELL, 0], [FERNS, FERN_CELL, 0],
  [STONES, ROCK_CELL, 1], [ROCKS, ROCK_CELL, 1], [SLABS, ROCK_CELL, 1], [BOULDERS, ROCK_CELL, 1], [BUSHES, BUSH_CELL, 1], [IN_FLOWER, BUSH_CELL, 1]]) {
  for (const k of list) Object.assign(k, { cell, level });
}
const first = list => KINDS.indexOf(list[0]);
const pick = (list, r) => first(list) + Math.floor(r * list.length);

// Integer hash to 0..1, by a world square and a seed.
function random(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// What the chunk's vertices say at (x, z) (m from its first vertex): the ground's height (on the
// same triangles as the land's drawn), m from the road's edge, the grove's byte (/127: the bamboo's
// thickness, or, negative, how much riverbed), and the ground's normal's y (how level it is).
const at = { height: 0, edge: 0, grove: 0, level: 0 };
function sample(slot, x, z) {
  const v = slot.vertices, s = slot.spacing, S = VERTEX_SHORTS, next = CHUNK_VERTS * S;
  const gx = Math.min(Math.floor(x / s), CHUNK_QUADS - 1), gz = Math.min(Math.floor(z / s), CHUNK_QUADS - 1);
  const fx = x / s - gx, fz = z / s - gz, o = (gz * CHUNK_VERTS + gx) * S;
  const a = v[o], b = v[o + S], c = v[o + next], d = v[o + next + S];
  at.height = 0.01 * (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d - (d - c) * (1 - fx) - (d - b) * (1 - fz));
  const blend = k => { const p = v[o + k], q = v[o + S + k], r = v[o + next + k], t = v[o + next + S + k]; return p + (q - p) * fx + (r - p) * fz + (p - q - r + t) * fx * fz; };
  at.edge = 0.01 * blend(1);
  const g = k => v[k] >> 8;
  const ga = g(o + 3), gb = g(o + S + 3), gc = g(o + next + 3), gd = g(o + next + S + 3);
  at.grove = (ga + (gb - ga) * fx + (gc - ga) * fz + (ga - gb - gc + gd) * fx * fz) / 127;
  at.level = Math.min(v[o + 2] >> 8, v[o + S + 2] >> 8, v[o + next + 2] >> 8, v[o + next + S + 2] >> 8) / 127;
  return at;
}

// How likely a tuft of grass is where `at` says: none on the road or under the water; thick on
// the verges, the river's wet banks (reeds, at the water's edge, however steep) and in the
// clearings; a little under the bamboo; less on steep ground.
function grassy(a) {
  if (a.edge < 0.25) return 0;
  // The riverbed's byte is -1 from the middle of the river to just past the water's edge: there,
  // only on the banks' slope (round the water's edge, in and out of it), not the level bed.
  if (a.grove < 0) return a.grove > -0.6 ? 0.9 : a.level < 0.9 ? 0.6 : 0;
  const p = a.edge < 3 ? 0.85 : 0.06 + 0.85 * (1 - a.grove) ** 2;
  return a.level < 0.6 ? 0.3 * p : a.level < 0.85 ? 0.6 * p : p;
}
// How likely a fern: under the bamboo and along its edges, not on the verge.
function ferny(a) {
  if (a.edge < 2.5 || a.grove < 0.12 || a.level < 0.7) return 0;
  return a.grove < 0.4 ? 0.35 : 0.22;
}
// How likely a bush: thickest along the groves' edges, some in the clearings and on the banks,
// few deep in the bamboo; none on or beside the road, or on steep ground.
function bushy(a) {
  if (a.edge < 2.5 || a.grove < -0.45 || a.level < 0.8) return 0;
  if (a.grove < 0) return 0.3;
  const g = a.grove;
  return g < 0.1 ? 0.12 : g < 0.7 ? 0.4 : 0.06;
}
// How likely a rock: on the river's banks and steep ground more; not on the road, nor in the water.
function rocky(a) {
  if (a.edge < 1.5 || a.grove < -0.6) return 0;
  if (a.grove < 0) return 0.45;
  return a.level < 0.8 ? 0.4 : a.grove < 0.2 ? 0.12 : 0.08;
}

// The ground cover for one chunk: per kind, a list of copies (INSTANCE_FLOATS each), or none.
export function scatter(slot) {
  const lists = KINDS.map(() => null);
  const add = (kind, x, y, z, seed, i, j) => {
    const k = KINDS[kind];
    (lists[kind] ??= []).push(x, y, z, random(i, j, seed + 1) * 2 * Math.PI, k.size[0] + (k.size[1] - k.size[0]) * random(i, j, seed + 2));
  };
  // Over the chunk's squares of `cell` m: `choose(at, i, j)` gives the kind to put there, or -1.
  const over = (cell, seed, choose) => {
    const n = Math.round(slot.size / cell), i0 = Math.round(slot.x / cell), j0 = Math.round(slot.z / cell);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wi = i0 + i, wj = j0 + j;
        const x = (i + 0.1 + 0.8 * random(wi, wj, seed)) * cell, z = (j + 0.1 + 0.8 * random(wi, wj, seed + 3)) * cell;
        if (x >= slot.size || z >= slot.size) continue;
        const a = sample(slot, x, z), kind = choose(a, wi, wj);
        if (kind >= 0) add(kind, slot.x + x, a.height, slot.z + z, seed + 4, wi, wj);
      }
    }
  };
  if (GRASS && slot.level === 0) {
    over(TUFT_CELL, 300, (a, i, j) => {
      if (random(i, j, 310) >= grassy(a)) return -1;
      const r = random(i, j, 311);
      if (a.grove < 0) return pick(REEDS, r);
      // In the open: tall ones and wildflowers among them.
      const open = a.edge > 3 && a.grove < 0.2;
      return open && r < 0.1 ? pick(FLOWERS, r / 0.1) : open && r < 0.25 ? pick(TALL, (r - 0.1) / 0.15) : pick(TUFTS, r);
    });
  }
  if (slot.level === 0) {
    over(FERN_CELL, 320, (a, i, j) => random(i, j, 330) < ferny(a) ? pick(FERNS, random(i, j, 331)) : -1);
  }
  if (slot.level <= 1) {
    over(BUSH_CELL, 340, (a, i, j) => {
      if (random(i, j, 350) >= bushy(a)) return -1;
      // In flower: more often in the open.
      const flowers = random(i, j, 351) < (a.grove < 0.2 ? 0.35 : 0.1);
      return pick(flowers ? IN_FLOWER : BUSHES, random(i, j, 352));
    });
    over(ROCK_CELL, 360, (a, i, j) => {
      if (random(i, j, 370) >= rocky(a)) return -1;
      const r = random(i, j, 371);
      // Boulders well off the road (they stop the car).
      return r < 0.4 ? pick(STONES, r / 0.4) : r < 0.75 ? pick(ROCKS, (r - 0.4) / 0.35) : r < 0.87 || a.edge < 6 ? pick(SLABS, 0) : pick(BOULDERS, (r - 0.87) / 0.13);
    });
  }
  return lists.map(list => list && new Float32Array(list));
}

// How far the point (x, y, z) is inside a boulder (those in `copies`: per boulder kind, its list
// of copies, INSTANCE_FLOATS each): 0 if it isn't; if it is, the way out (straight out from its
// middle) into `normal`. For the car's body (car.js), as treeWall.
export function rockWall(copies, x, y, z, normal) {
  let best = 0;
  for (const { list, count, radius } of copies) {
    for (let o = 0; o < count; o += INSTANCE_FLOATS) {
      const r = radius * list[o + 4], dx = x - list[o], dz = z - list[o + 2];
      if (Math.abs(dx) > r || Math.abs(dz) > r || y > list[o + 1] + 1.6 * r) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= r || r - d <= best) continue;
      best = r - d;
      normal[0] = d > 1e-6 ? dx / d : 1; normal[1] = 0; normal[2] = d > 1e-6 ? dz / d : 0;
    }
  }
  return best;
}

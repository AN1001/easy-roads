// The trees terrain.js finds (in groups by the roads and the rivers): cherries in blossom and
// maples in autumn red, made here; and broadleaf trees, a model from assets/tree_01 (loadBroadleaf, drawn by tree.vert /
// tree.frag, one copy per tree of three shapes); and their trunks, which stop the car (treeWall).
//
// The cherries and maples: Drawn with the bridges' shaders
// (built.vert / built.frag), in the same vertex layout (blocks.js's BLOCK_FLOATS), but a buffer
// of their own, without culling: the blossom's cards are seen from both sides.
//
// Each tree grows from its seed: a short trunk, leaning a little, forking at FORK m into 5 to 7
// limbs that spread out wide (as a cherry's crown does), each splitting into 3 to 5 branches, and
// those into twigs (three times as many as at first, 3 Oct 2026); each a tapered tube of SIDES
// sides (TWIG_SIDES for the twigs), bending a little along its length. At every
// twig's end and along the branches, a cluster of blossom: cards crossed at random, each wearing the
// blossom texture (textures.js), round its point. Under the tree, the fallen petals: cards laid on
// the ground (its heights, from terrain.js) within PETALS_REACH m of the trunk, their texture laid by
// where they are from the trunk (turned by the tree's own angle), so built.frag can thin them out
// towards PETALS_REACH.
//
// A maple (3 Oct 2026, in place of the nature pack's) grows the same way, taller: its trunk forks
// higher (MAPLE_FORK), its limbs fewer and more upright, longer; its crown leaf cards (textures.js's
// LEAF) in the tree's own red, scarlet, orange or gold, each card a shade of its own and now and then
// the next colour along; its fallen leaves under it in the same colours.

import { BARK, BLOSSOM, PETALS, LEAF } from './textures.js';
import { BLOCK_FLOATS } from './blocks.js';

const SIDES = 6, TWIG_SIDES = 4;
const TRUNK_RADIUS = 0.24, TRUNK_TOP_RADIUS = 0.17;  // m
const FORK = 1.7, FORK_MORE = 0.8;                    // m up, and up to this much more
const BURIED = 0.5;                                   // m: the trunk starts below the ground (which isn't level)
const CLUSTER = 0.75;            // m: how far a cluster's cards spread round its point
const CARD = 1.1, CARD_MORE = 0.6;  // m across, and up to this much more
const CARDS = 3;                 // per cluster
const PETALS_REACH = 7;          // m

const MAPLE_FORK = 2.4, MAPLE_CARD = 1.8;  // m

const BARK_COLOR = [0.20, 0.15, 0.14], MAPLE_BARK = [0.22, 0.20, 0.17];
const MAPLE_COLORS = [[0.55, 0.09, 0.06], [0.70, 0.17, 0.06], [0.78, 0.36, 0.07], [0.74, 0.54, 0.12]];  // crimson, scarlet, orange, gold
const BLOSSOM_COLOR = [0.80, 0.56, 0.64];
const PETAL_COLOR = [0.85, 0.66, 0.72];
// What stops the car: the trunk, up to WALL_HEIGHT m, at least WALL_RADIUS round (more than most
// trunks are: the car's wall points, car.js, are up to 0.7 m apart, and a thinner trunk could slip
// between them, as a broadleaf's, 0.16 m round, did).
const WALL_HEIGHT = 2, WALL_RADIUS = 0.36;

// A small random number generator: the same seed, the same tree.
function generator(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

// Where the models are written: typed arrays, reused (pushing onto a plain array, and copying it
// into a typed one at the end, measured 6.5 ms a tree in headless Chrome, a stutter as each came
// into reach); grown if need be. `off`: the vertices aren't written (the tree's shape still grows
// the same, from the same random numbers). The near model's wood and petals, the crown's cards
// (both models'), the far model's wood and petals.
const writer = () => ({ data: new Float32Array(1 << 16), n: 0, off: false });
const nearWood = writer(), cards = writer(), nearPetals = writer(), farWood = writer(), farPetals = writer();

// A vertex, in blocks.js's layout.
function vertex(out, p, n, u, v, color, layer) {
  if (out.off) return;
  if (out.n + BLOCK_FLOATS > out.data.length) { const bigger = new Float32Array(out.data.length * 2); bigger.set(out.data); out.data = bigger; }
  const d = out.data, i = out.n;
  d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = n[0]; d[i + 4] = n[1]; d[i + 5] = n[2];
  d[i + 6] = u; d[i + 7] = v; d[i + 8] = color[0]; d[i + 9] = color[1]; d[i + 10] = color[2]; d[i + 11] = layer;
  out.n = i + BLOCK_FLOATS;
}

// A tapered tube from a (radius ra) to b (radius rb), its bark's v starting at `v0` m up it.
function tube(out, a, b, ra, rb, v0, sides = SIDES, color = BARK_COLOR) {
  const axis = unit(sub(b, a)), length = Math.hypot(...sub(b, a));
  const side = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), other = cross(axis, side);
  if (out.off) return v0 + length;
  // Round each end: the points, their normals, the bark's u.
  const ps = [], qs = [], ns = [], us = [];
  for (let k = 0; k <= sides; k++) {
    const angle = k / sides * 2 * Math.PI, c = Math.cos(angle), s = Math.sin(angle);
    const n = [side[0] * c + other[0] * s, side[1] * c + other[1] * s, side[2] * c + other[2] * s];
    ns.push(n); ps.push(add(a, n, ra)); qs.push(add(b, n, rb)); us.push(angle * TRUNK_RADIUS);
  }
  const v1 = v0 + length;
  for (let k = 0; k < sides; k++) {
    const p0 = ps[k], p1 = ps[k + 1], q0 = qs[k], q1 = qs[k + 1], n0 = ns[k], n1 = ns[k + 1], u0 = us[k], u1 = us[k + 1];
    // Wound anticlockwise seen from outside (unlit from inside: drawn without culling anyway).
    vertex(out, p0, n0, u0, v0, color, BARK); vertex(out, q0, n0, u0, v1, color, BARK); vertex(out, q1, n1, u1, v1, color, BARK);
    vertex(out, p0, n0, u0, v0, color, BARK); vertex(out, q1, n1, u1, v1, color, BARK); vertex(out, p1, n1, u1, v0, color, BARK);
  }
  return v0 + length;
}

// A branch from `from`, along `dir`, `length` m, `radius` thick at its start: in two pieces, bent a
// little between them; then its children, if `depth` is left, and blossom along it and at its end.
// Its limbs and their branches (depths 2 and 1) are also kept in `limbs`, for the far model.
function branch(out, clusters, limbs, random, from, dir, length, radius, depth, v0, bark = BARK_COLOR) {
  const bend = [dir[0] + 0.35 * (random() - 0.5), dir[1] + 0.2 * (random() - 0.5), dir[2] + 0.35 * (random() - 0.5)];
  const middle = add(from, dir, length / 2), end = add(middle, unit(bend), length / 2);
  const rm = radius * 0.85, re = radius * 0.7;
  const sides = depth === 0 ? TWIG_SIDES : SIDES;
  if (depth >= 1) limbs.push([from, middle, end, radius, rm, re]);
  v0 = tube(out, from, middle, radius, rm, v0, sides, bark);
  v0 = tube(out, middle, end, rm, re, v0, sides, bark);
  if (depth === 0) {
    clusters.push(end);
    return;
  }
  if (depth === 1) clusters.push(middle);
  const children = 3 + Math.floor(random() * 3), out1 = unit([bend[0], 0, bend[2]]);
  for (let c = 0; c < children; c++) {
    // Spreading out and a little up, round the parent's way.
    const turn = (c / children + random() * 0.3) * 2 * Math.PI;
    const across = unit(cross(unit(bend), [0, 1, 0]));
    const spread = [across[0] * Math.cos(turn), Math.sin(turn) * 0.5, across[2] * Math.cos(turn)];
    const way = unit(add(add(unit(bend), spread, 0.7), out1, 0.35));
    way[1] = Math.max(way[1], -0.1) + 0.15;
    branch(out, clusters, limbs, random, end, unit(way), length * (0.55 + 0.15 * random()), re * 0.8, depth - 1, v0, bark);
  }
}

// The blossom (or leaves): `cards` cards crossed at random round each of `points`, `grow` times the
// usual size, lit as if facing out from the middle of the crown (`crown`: so it's shaded as a whole,
// lighter on top). Each card in its own shade, so a crown isn't one flat pink (in built.frag, by
// noise, until that measured too slow a pixel: the blossom covers a lot of the screen).
function crownCards(out, random, points, crown, cards, grow, maple, hue) {
  for (const point of points) {
    const normal = unit(add(sub(point, crown), [0, 1.2, 0]));
    for (let c = 0; c < cards; c++) {
      const spread = CLUSTER * grow;
      const centre = add(point, [(random() - 0.5) * spread, (random() - 0.3) * spread, (random() - 0.5) * spread]);
      const a = unit([random() - 0.5, random() - 0.5, random() - 0.5]);
      const b = unit(cross(a, unit([random() - 0.5, random() - 0.5, random() - 0.5])));
      const a2 = cross(b, a), size = grow * ((maple ? MAPLE_CARD : CARD) + CARD_MORE * random()) / 2;
      const corner = (s, t) => add(add(centre, a2, s * size), b, t * size);
      // u, v from 0 to 8 m across the card: the texture once (built.frag's TILE).
      const p = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], uv = [[0, 0], [8, 0], [8, 8], [0, 8]];
      const shade = 0.6 + 0.5 * random();
      const own = maple ? MAPLE_COLORS[Math.min(hue + (random() < 0.3 ? 1 : 0), MAPLE_COLORS.length - 1)] : BLOSSOM_COLOR;
      const color = own.map(c => c * shade);
      for (const k of [0, 1, 2, 0, 2, 3]) vertex(out, p[k], normal, uv[k][0], uv[k][1], color, maple ? LEAF : BLOSSOM);
    }
  }
}

// The fallen petals (or leaves): a card on each square of the ground's grid (every `every`th line
// of it) within PETALS_REACH m, its corners on the ground (2 cm above), the texture laid by where
// it is from the trunk, turned by `angle`, so it runs on from one card to the next.
function fallenCards(out, tree, angle, color, every) {
  if (out.off) return;
  const n = tree.groundSize, step = tree.groundStep, half = (n - 1) / 2, g = tree.ground;
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let b = 0; b + every < n; b += every) {
    for (let a = 0; a + every < n; a += every) {
      if (Math.hypot((a + every / 2 - half) * step, (b + every / 2 - half) * step) > PETALS_REACH + (every - 1) * step / 2) continue;
      const at = (i, j) => [tree.x + (a + i - half) * step, g[(b + j) * n + a + i] + 0.02 * every, tree.z + (b + j - half) * step];
      const p = [at(0, 0), at(every, 0), at(every, every), at(0, every)];
      for (const k of [0, 2, 1, 0, 3, 2]) {
        const dx = p[k][0] - tree.x, dz = p[k][2] - tree.z;
        vertex(out, p[k], [0, 1, 0], c * dx - s * dz, s * dx + c * dz, color, PETALS);
      }
    }
  }
}

// The models of one tree, as BLOCK_FLOATS numbers a vertex, one after the other in `data`: near
// (its wood, its blossom or leaves, its fallen petals or leaves), the first `near` vertices; and far
// (from TREE_LOD m: main.js), the rest: the same crown, card for card, but only the trunk, limbs and
// branches under it (no twigs: hidden in the crown, and most of the vertices), three-sided, and its
// petals on cards twice the size: ~3,400 vertices against ~9,100. (A third of the cards, twice the
// size, until 3 Oct 2026: the tree changed too much as it came near.)
//
// Or, if not `detailed`, only the far model (`near` 0): until a tree comes near, that's all that's
// drawn of it, and it's less to make.
export function treeModel(tree, detailed = true) {
  const clusters = [], limbs = [], random = generator(tree.seed), maple = tree.kind === 'maple';
  for (const w of [nearWood, cards, nearPetals, farWood, farPetals]) w.n = 0;
  nearWood.off = !detailed;
  const bark = maple ? MAPLE_BARK : BARK_COLOR;
  const base = [tree.x, tree.y - BURIED, tree.z];
  const lean = [0.25 * (random() - 0.5), 1, 0.25 * (random() - 0.5)];
  const fork = add(base, unit(lean), BURIED + (maple ? MAPLE_FORK : FORK) + FORK_MORE * random());
  const v0 = tube(nearWood, base, fork, TRUNK_RADIUS * 1.15, TRUNK_TOP_RADIUS, 0, SIDES, bark);
  const limbCount = (maple ? 4 : 5) + Math.floor(random() * 3), turn0 = random() * 2 * Math.PI;
  for (let k = 0; k < limbCount; k++) {
    const turn = turn0 + (k + 0.3 * random()) / limbCount * 2 * Math.PI, up = maple ? 1.0 + 0.5 * random() : 0.55 + 0.35 * random();
    const dir = unit([Math.cos(turn), up, Math.sin(turn)]);
    branch(nearWood, clusters, limbs, random, fork, dir, (maple ? 2.4 : 2.0) + 0.9 * random(), 0.11, 2, v0, bark);
  }
  // A maple's colour: its own, from MAPLE_COLORS.
  const hue = Math.floor(random() * MAPLE_COLORS.length);
  const crown = [fork[0], fork[1] + (maple ? 2.2 : 1.5), fork[2]];
  crownCards(cards, random, clusters, crown, CARDS, 1, maple, hue);
  const angle = random() * 2 * Math.PI, fallen = maple ? MAPLE_COLORS[hue].map(c => c * 1.1) : PETAL_COLOR;
  if (detailed) fallenCards(nearPetals, tree, angle, fallen, 1);
  fallenCards(farPetals, tree, angle, fallen, 2);
  tube(farWood, base, fork, TRUNK_RADIUS * 1.15, TRUNK_TOP_RADIUS, 0, 3, bark);
  for (const [from, middle, end, ra, rm, re] of limbs) {
    tube(farWood, from, middle, ra, rm, 0, 3, bark);
    tube(farWood, middle, end, rm, re, 0, 3, bark);
  }
  const parts = detailed ? [nearWood, cards, nearPetals, farWood, cards, farPetals] : [farWood, cards, farPetals];
  const data = new Float32Array(parts.reduce((n, w) => n + w.n, 0));
  let at = 0;
  for (const w of parts) { data.set(w.data.subarray(0, w.n), at); at += w.n; }
  return { data, near: detailed ? (nearWood.n + cards.n + nearPetals.n) / BLOCK_FLOATS : 0 };
}

// --- Broadleaf trees: the model from assets/tree_01 (bench/tree01.py made it from laubbaum.blend):
// three trees, objects tree_a, tree_b and tree_c, each standing at 0, 0, 0, 720 vertices; one
// texture, its left two thirds a card of twigs and one of leaves, its right third bark. ---

export const BROADLEAF_SHAPES = 3;
export const BROADLEAF_FLOATS = 9;  // per vertex: position, normal, u, v, how much it sways
const BARK_FROM_U = 2 / 3;          // the texture's bark, from here across
const BROADLEAF_SCALE = 0.8, BROADLEAF_SCALE_MORE = 0.4;  // its size, and up to this much more
const BROADLEAF_TRUNK = 0.2;        // m: its trunk's radius at its usual size (measured 0.15-0.23, 0.3-1 m up)

// The three shapes, as triangles, BROADLEAF_FLOATS a vertex: { vertices, count } each. The bark
// smooth-shaded (each vertex's normal the average of its faces'); the leaf and twig cards lit as if
// facing out from the middle of the crown and up, as the cherries' blossom is. How much a vertex
// sways: none on the bark, the leaves more the higher they are.
export async function loadBroadleaf(url = 'assets/tree_01/tree_01.obj') {
  const text = await fetch(url).then(r => r.text());
  const shapes = [];
  let positions = [], uvs = [], faces = [], vBase = 0, tBase = 0;
  const finish = () => {
    if (!faces.length) return;
    const top = Math.max(...positions.map(p => p[1]));
    // The crown's middle: the leaf cards' corners' average.
    const leafy = faces.filter(f => f.every(([, t]) => uvs[t][0] < BARK_FROM_U)).flat().map(([v]) => positions[v]);
    const crown = [0, 1, 2].map(k => leafy.reduce((sum, p) => sum + p[k], 0) / Math.max(leafy.length, 1));
    const smooth = positions.map(() => [0, 0, 0]);
    for (const f of faces) {
      const [a, b, c] = f.map(([v]) => positions[v]);
      const n = cross(sub(b, a), sub(c, a));
      for (const [v] of f) for (let k = 0; k < 3; k++) smooth[v][k] += n[k];
    }
    const out = [];
    for (const f of faces) {
      const bark = f.every(([, t]) => uvs[t][0] >= BARK_FROM_U);
      for (let i = 2; i < f.length; i++) {
        for (const [v, t] of [f[0], f[i - 1], f[i]]) {
          const p = positions[v];
          const n = bark ? unit(smooth[v]) : unit(add(unit(sub(p, crown)), [0, 1, 0]));
          const sway = bark ? 0 : (p[1] / top) ** 2;
          out.push(p[0], p[1], p[2], n[0], n[1], n[2], uvs[t][0], 1 - uvs[t][1], sway);
        }
      }
    }
    shapes.push({ vertices: new Float32Array(out), count: out.length / BROADLEAF_FLOATS });
    vBase += positions.length; tBase += uvs.length;
    positions = []; uvs = []; faces = [];
  };
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'o') finish();
    else if (p[0] === 'v') positions.push(p.slice(1, 4).map(Number));
    else if (p[0] === 'vt') uvs.push([+p[1], +p[2]]);
    else if (p[0] === 'f') faces.push(p.slice(1).map(c => { const [v, t] = c.split('/').map(Number); return [v - 1 - vBase, t - 1 - tBase]; }));
  }
  finish();
  return shapes;
}

// Each broadleaf tree's look, from its seed (kept on the tree, for treeWall): how it's turned, its
// size, and which of the BROADLEAF_SHAPES.
export function broadleafLook(tree) {
  if (!tree.look) {
    const random = generator(tree.seed), angle = random() * 2 * Math.PI, pick = random(), size = random();
    tree.look = { shape: Math.floor(pick * BROADLEAF_SHAPES), angle, scale: BROADLEAF_SCALE + BROADLEAF_SCALE_MORE * size, trunk: BROADLEAF_TRUNK };
  }
  return tree.look;
}

// The trees within `reach` m of (x, z) (along x and along z), into `out` (from the start), in the
// same order; returns how many. For treeWall: once a frame round the car, rather than every tree
// found (hundreds) for every point of the car at every physics step (until 3 Oct 2026).
export function treesNear(trees, x, z, reach, out) {
  let count = 0;
  for (let k = 0; k < trees.length; k++) {
    const t = trees[k];
    if (Math.abs(t.x - x) < reach && Math.abs(t.z - z) < reach) out[count++] = t;
  }
  return count;
}

// How far the point (x, y, z) is inside a tree's trunk (the first `count` of `trees`): 0 if it isn't;
// if it is, the way out of it (straight out from the trunk's middle) into `normal`. For the car's
// body (car.js), as bridgeWall.
export function treeWall(trees, x, y, z, normal, count = trees.length) {
  let best = 0;
  for (let k = 0; k < count; k++) {
    const t = trees[k], dx = x - t.x, dz = z - t.z;
    const look = t.kind === 'broadleaf' ? broadleafLook(t) : null;
    const radius = Math.max(WALL_RADIUS, look ? look.trunk * look.scale : TRUNK_RADIUS);
    if (Math.abs(dx) > radius || Math.abs(dz) > radius || y < t.y - 1 || y > t.y + WALL_HEIGHT) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= radius || radius - d <= best) continue;
    best = radius - d;
    normal[0] = d > 1e-6 ? dx / d : 1; normal[1] = 0; normal[2] = d > 1e-6 ? dz / d : 0;
  }
  return best;
}

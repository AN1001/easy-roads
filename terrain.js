// Endless procedural terrain: forested hills and ridges crossed by a network of dirt lanes. The
// land is built in square chunks around the camera as it moves, a few rows at a time, so no frame
// waits long.
//
// Each vertex is 8 bytes: its height, how far it is from the road's edge (for the shader to paint
// the road), the ground's normal there (for smooth lighting), and how thick the bamboo grows (to
// shade the ground under it). The vertex shader works out x/z from the vertex's index, so the grid
// itself costs no memory. Level 0's chunks also plant the bamboo (bamboo.js draws it).

export const CHUNK_QUADS = 30;            // 1 m grid squares along each side of a chunk
const CHUNK_VERTS = CHUNK_QUADS + 1;      // 31: neighbouring chunks share their edge vertices
const BORDERED = CHUNK_VERTS + 2;         // 33: plus a ring of heights around it, for its normals
export const VERTEX_SHORTS = 4;           // 16-bit numbers per vertex (8 bytes)

// --- Noise ---

// Integer hash: the same whole numbers always give the same "random" 32 bits. Each input is
// multiplied by its own large odd number, the three are added, and the bits of the sum stirred.
const HASH_X = 374761393, HASH_Z = 668265263, HASH_SEED = 1440662683;
function hash(x, z, seed) {
  return stir(Math.imul(x, HASH_X) + Math.imul(z, HASH_Z) + Math.imul(seed, HASH_SEED));
}
function stir(sum) {
  let h = sum | 0;  // the sum's lowest 32 bits
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const random = (x, z, seed) => hash(x, z, seed) / 4294967296;  // 0 to 1

// 16 directions evenly spaced round a circle, as (x, z) pairs.
const GRADIENTS = new Float64Array(32);
for (let k = 0; k < 16; k++) {
  GRADIENTS[2 * k] = Math.cos(k * Math.PI / 8);
  GRADIENTS[2 * k + 1] = Math.sin(k * Math.PI / 8);
}

// Gradient (Perlin) noise: smooth random rises and dips about 1 unit apart, between about -1
// and 1. Each grid point gets a random slope rather than a random height, so unlike the old
// value noise the grid's squares don't show in the shapes.
function noise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  // The 4 corners' hashes. Moving one step along x adds HASH_X to the sum (the same number, in
  // 32 bits, as multiplying xi + 1), so the corners share one set of multiplies: 3 instead of 12.
  const sum = Math.imul(xi, HASH_X) + Math.imul(zi, HASH_Z) + Math.imul(seed, HASH_SEED);
  const a = slope(sum, fx, fz), b = slope(sum + HASH_X, fx - 1, fz);
  const c = slope(sum + HASH_Z, fx, fz - 1), d = slope(sum + HASH_X + HASH_Z, fx - 1, fz - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);  // eases in and out, with no crease
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  return 1.4 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}

// Height at offset (x, z) from a grid point, on its random slope (picked by the point's hash sum).
// Its own function mainly to keep noise small: V8 only inlines functions of up to 460 bytes of
// bytecode, and each call that isn't inlined allocates a box for the number it returns.
function slope(sum, x, z) {
  const g = (stir(sum) & 15) * 2;
  return GRADIENTS[g] * x + GRADIENTS[g + 1] * z;
}

// Layers of noise, each twice as detailed and `gain` times as tall as the one before, and turned
// 37° so their grids don't line up. x and z are in units of the biggest layer.
function layers(x, z, count, gain, seed) {
  let sum = 0, amplitude = 1;
  for (let k = 0; k < count; k++) {
    sum += amplitude * noise(x, z, seed + k);
    const turned = 1.6 * x + 1.2 * z;
    z = 1.6 * z - 1.2 * x;
    x = turned;
    amplitude *= gain;
  }
  return sum;
}

function smoothstep(from, to, x) {
  const t = Math.min(Math.max((x - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

// --- The road network ---
//
// Junctions (nodes) on a loose grid: one per CELL × CELL square, somewhere near its middle, so
// they're a couple of km apart along the roads: rare. Roads join neighbouring nodes east-west,
// north-south, and diagonally across some squares (at most one diagonal each, the shorter, so
// roads never cross between nodes). A few whole east-west and north-south lines of nodes are
// joined by main roads: a little wider and straighter, and they carry straight on through every
// junction. The rest are side roads, each there or not at random. A node whose roads would all
// leave in about the same direction (a dead end, or a sharp V) gets one more.
//
// Between two nodes a road swings out to one side, and it's drawn as a smooth curve through the
// nodes and that swing point; then it meanders and winds from side to side along the way, less
// near the nodes (see wind), and rises and falls with the land (see liftRoad). It's kept as
// straight pieces about PIECE_LENGTH long. At each junction one road can carry straight on (a
// main road, else the straightest pair of side roads), drawn as one smooth curve through it; the
// others stop at its edge.

const CELL = 1600;               // m
const JITTER = 0.3;              // nodes sit up to ±15% of a cell from the middle of their cell
const MAIN_CHANCE = 0.25;        // chance a line of nodes is joined all along by a main road
const SIDE_CHANCE = 0.45;        // chance of a side road between two neighbouring nodes
const DIAGONAL_CHANCE = 0.2;     // chance of a road across a square's diagonal
const MAIN = 0, SIDE = 1, DIAGONAL = 2;           // kinds of road, which differ in:
const SWING = [0.04, 0.1, 0.08];                  // how far they swing sideways, as a fraction of their length
const MEANDER = [12, 36, 36];                     // m (lanes 42 until 30 Sep 2026): how far they meander from side to side in long bends,
const WIND = [3, 10, 10];                         // m (4, 14 until 30 Sep 2026): and wind in short ones (about, at most)
const HALF_WIDTH = [3.25, 2.75, 2.75];            // m: main roads are 6.5 m wide, the others 5.5 m (6 and 5 until 30 Sep 2026)
const MEANDER_WAVE = 260, WIND_WAVE = 55;         // m: roughly the length of each long and short bend
const WIND_EASE = 80;            // m from a node: the bends fade in over this, so junctions keep their angles
const PIECE_LENGTH = 10;         // m, about

// The 8 directions a road can leave a node in, anticlockwise from east (north is +z), as steps to
// the neighbouring node. A road is known by the node it leaves going east, north-east, north or
// north-west (0-3): its first node.
const DI = [1, 1, 0, -1, -1, -1, 0, 1], DJ = [0, 1, 1, 1, 0, -1, -1, -1];

const nodeX = (i, j) => (i + 0.5 + JITTER * (random(i, j, 1) - 0.5)) * CELL;
const nodeZ = (i, j) => (j + 0.5 + JITTER * (random(i, j, 2) - 0.5)) * CELL;
const mainAcross = j => random(j, 0, 101) < MAIN_CHANCE;  // the east-west line of nodes j
const mainUp = i => random(i, 0, 102) < MAIN_CHANCE;      // the north-south line of nodes i

// The kind of road from node (i, j) in direction k (0-3).
const kindOf = (i, j, k) => k === 0 ? (mainAcross(j) ? MAIN : SIDE) : k === 2 ? (mainUp(i) ? MAIN : SIDE) : DIAGONAL;
// The same, for the road leaving node (i, j) in any direction k (0-7).
const armKind = (i, j, k) => k < 4 ? kindOf(i, j, k) : kindOf(i + DI[k], j + DJ[k], k - 4);

// Is there a road by chance from node (i, j) east (k = 0) or north (k = 2)? (Diagonal roads are
// worked out in findRoads.)
function straightRoad(i, j, k) {
  return k === 0 ? mainAcross(j) || random(i, j, 104) < SIDE_CHANCE : mainUp(i) || random(i, j, 105) < SIDE_CHANCE;
}

// Halfway along the road from node (i, j) in direction k (0-3), pushed out to one side.
function swingPoint(i, j, k, out) {
  const ax = nodeX(i, j), az = nodeZ(i, j), bx = nodeX(i + DI[k], j + DJ[k]), bz = nodeZ(i + DI[k], j + DJ[k]);
  const swing = SWING[kindOf(i, j, k)] * (2 * random(i, j, 106 + k) - 1);
  out[0] = (ax + bx) / 2 - (bz - az) * swing;
  out[1] = (az + bz) / 2 + (bx - ax) * swing;
}
// The same, for the road leaving node (i, j) in any direction k (0-7).
function armSwing(i, j, k, out) {
  if (k < 4) swingPoint(i, j, k, out);
  else swingPoint(i + DI[k], j + DJ[k], k - 4, out);
}

// The nodes around an area being searched for roads, and what happens at each: worked out once
// per search (findRoads), into a small grid. Node (i, j) is at index at(i, j).
const NET = 18;  // nodes along each side
const net = {
  i0: 0, j0: 0,                          // the first node's i, j
  x: new Float64Array(NET * NET),        // where each node is
  z: new Float64Array(NET * NET),
  chance: new Uint8Array(NET * NET),     // the roads there by chance: bit k for direction k
  full: new Uint8Array(NET * NET),       // 1: roads east, north, west and south by chance
  extra: new Int8Array(NET * NET),       // a road added so it isn't a dead end or a sharp V: its direction, or -1
  roads: new Uint8Array(NET * NET),      // all its roads
  // Per node and direction (index 8 × node + direction):
  partner: new Int8Array(NET * NET * 8),   // the road that carries on from it through the node, or -1
  cut: new Float64Array(NET * NET * 8 * 3),  // where it's cut off square (see analyse), or NaN
};
const at = (i, j) => (j - net.j0) * NET + i - net.i0;

// A node whose roads by chance all leave within 45° of each other (a dead end, or a sharp V), or
// three within 90° (a fan), gets one more: the east, north, west or south road most nearly
// opposite them, to a node that has roads (so as not to make a dead end there). Returns its
// direction, or -1 if none is needed.
function extraRoad(i, j) {
  const roads = net.chance[at(i, j)];
  if (roads === 0) return -1;
  // The widest gap between roads going round (in 45° steps), and the road after it.
  let count = 0, gap = 0, after = 0;
  for (let k = 0; k < 8; k++) {
    if (!(roads >> k & 1)) continue;
    count++;
    let n = 1;
    while (!(roads >> ((k + n) & 7) & 1)) n++;
    if (n > gap) { gap = n; after = (k + n) & 7; }
  }
  const spread = 8 - gap;  // the roads all lie within this many steps
  if (spread > 2 || (spread === 2 && count < 3)) return -1;
  const opposite = (2 * after + spread + 8) & 15;  // opposite their middle, in half-steps
  let best = -1, bestMiss = Infinity;
  for (let k = 0; k < 8; k += 2) {
    if (roads >> k & 1 || net.chance[at(i + DI[k], j + DJ[k])] === 0) continue;
    const off = Math.abs(2 * k - opposite);
    const miss = Math.min(off, 16 - off) + 0.5 * random(i, j, 110 + k);  // ties broken at random
    if (miss < bestMiss) { bestMiss = miss; best = k; }
  }
  return best;
}

// What happens at node (i, j), into `net`: which road carries on through it, and whether each
// road's end is cut off square, along a line (x, z, offset in net.cut): the parts of it where
// x·px + z·pz > offset are dropped (see setCut). A road ending at one that carries on is cut off
// along that road's middle. Without the cut, its rounded end would reach across to the far edge,
// and the rounding of the corners (see roadDistance) would pull that edge out towards it. (And
// ending well inside, its square corners are well away from the rounded corners at the edge.)
const dirX = new Float64Array(8), dirZ = new Float64Array(8), swingX = new Float64Array(8), swingZ = new Float64Array(8);
const point = new Float64Array(2);
function analyse(i, j) {
  const g = at(i, j), roads = net.roads[g], x = net.x[g], z = net.z[g], o = 8 * g;
  let count = 0;
  for (let k = 0; k < 8; k++) {
    net.partner[o + k] = -1;
    net.cut[3 * (o + k) + 2] = NaN;
    if (!(roads >> k & 1)) continue;
    count++;
    armSwing(i, j, k, point);
    swingX[k] = point[0]; swingZ[k] = point[1];
    const dx = point[0] - x, dz = point[1] - z, l = Math.sqrt(dx * dx + dz * dz);
    dirX[k] = dx / l; dirZ[k] = dz / l;
  }
  const mainAcrossHere = (roads & 0x11) === 0x11 && mainAcross(j), mainUpHere = (roads & 0x44) === 0x44 && mainUp(i);

  // The road that carries on: a main road, or else the straightest pair of roads, if they're
  // straight enough (at least 60° apart for just two, else 135°).
  let a = -1, b = -1;
  if (mainAcrossHere) { a = 0; b = 4; }
  else if (mainUpHere) { a = 2; b = 6; }
  else {
    let straightest = count === 2 ? 0.5 : -0.7;  // cosine of the angle between them
    for (let p = 0; p < 8; p++) {
      for (let q = p + 1; q < 8; q++) {
        if (!(roads >> p & 1) || !(roads >> q & 1)) continue;
        const c = dirX[p] * dirX[q] + dirZ[p] * dirZ[q];
        if (c < straightest) { straightest = c; a = p; b = q; }
      }
    }
  }
  if (a >= 0) { net.partner[o + a] = b; net.partner[o + b] = a; }
  // Its sideways direction at the node (it heads towards one swing point from the other).
  let nx = 0, nz = 0;
  if (a >= 0) {
    const tx = swingX[a] - swingX[b], tz = swingZ[a] - swingZ[b], l = Math.sqrt(tx * tx + tz * tz);
    nx = -tz / l; nz = tx / l;
  }

  if (a < 0) return;
  for (let k = 0; k < 8; k++) {
    if (!(roads >> k & 1) || net.partner[o + k] >= 0) continue;
    const side = nx * dirX[k] + nz * dirZ[k] < 0 ? -1 : 1;  // which side of the through road it's on
    setCut(3 * (o + k), side * nx, side * nz, x, z);
  }
}
// Cut off the parts of a road on the far side of the line through (x, z) square to (nx, nz).
function setCut(c3, nx, nz, x, z) {
  net.cut[c3] = -nx; net.cut[c3 + 1] = -nz; net.cut[c3 + 2] = -nx * x - nz * z;
}

// --- Road pieces ---
//
// Each chunk keeps the pieces of road near it, as flat records of PIECE numbers:
//   0-1 start x, z; 2-3 direction x, z (start to end); 4 1 / length²; 5 lift at the start (m above
//   or below roadLevel: see liftRoad); 6 which group of pieces it's in (see roadDistance);
//   7 half-width; 8 flags; 9-11 the cut, if flagged: x, z and offset (see analyse); 12 lift at the end.
const PIECE = 13;
const CUT = 1;  // cut off square (near a junction)
function createRoadList(maxPieces) {
  return {
    pieces: new Float64Array(maxPieces * PIECE), pieceCount: 0, groupCount: 0,
  };
}

const MAX_SPAN = 150;  // pieces from a node to a swing point
const curve = new Float64Array((2 * MAX_SPAN + 1) * 2);  // a road, as the corners of its pieces
const along = new Float64Array(2 * MAX_SPAN + 1);        // m along it to each corner
const shift = new Float64Array(2 * MAX_SPAN + 1);        // m each corner winds sideways
const lift = new Float64Array(2 * MAX_SPAN + 1);         // m each corner is lifted (see liftRoad)
const lifted = new Float64Array(2 * MAX_SPAN + 1);
// Roads already worked out, kept by their first node and direction: neighbouring chunks mostly
// want the same few, and working one out (its bends, and the land along it for its lift) is most
// of the time spent finding roads. Each road has one slot, by a hash of it, and takes it over from
// whichever road was there. Per slot: the road, its corners, the box they're in, and per corner
// its x and z, m along it and lift.
const CACHED_ROADS = 64, CORNERS = 2 * MAX_SPAN + 1;
const cachedI = new Int32Array(CACHED_ROADS), cachedJ = new Int32Array(CACHED_ROADS);
const cachedK = new Int8Array(CACHED_ROADS).fill(-1), cachedLast = new Int32Array(CACHED_ROADS);
const cachedBox = new Float64Array(CACHED_ROADS * 4);
const cachedCurve = new Float64Array(CACHED_ROADS * CORNERS * 2);
const cachedAlong = new Float64Array(CACHED_ROADS * CORNERS), cachedLift = new Float64Array(CACHED_ROADS * CORNERS);
// The roads found by one search: their ends (node and direction), and which group each is in.
const MAX_ROADS = 256;
const roadNodeA = new Int32Array(MAX_ROADS), roadDirA = new Int8Array(MAX_ROADS);
const roadNodeB = new Int32Array(MAX_ROADS), roadDirB = new Int8Array(MAX_ROADS);
const roadGroup = new Int32Array(MAX_ROADS), groupNumber = new Int32Array(MAX_ROADS);
let roadCount = 0, warnedFull = false;

// Find the pieces of road near the rectangle from (x0, z0) to (x1, z1).
function findRoads(list, x0, z0, x1, z1) {
  // Roads between nodes from ia - 1 to ib + 1 (and ja - 1 to jb + 1). A node sits at most 0.65
  // cells past the start of its cell, and a road bends out less than 0.3 cells beyond its ends
  // (its swing and its winding): so a road from a node further out can't reach the rectangle.
  const ia = Math.floor(x0 / CELL), ib = Math.floor(x1 / CELL);
  const ja = Math.floor(z0 / CELL), jb = Math.floor(z1 / CELL);
  if (ib - ia + 12 > NET || jb - ja + 12 > NET) throw new Error('terrain: road search area too big');
  // The nodes the roads could come from, and what happens at them. Each step needs the one
  // before at the nodes around, so covers a smaller square.
  net.i0 = ia - 6; net.j0 = ja - 6;
  // Where each node is, and its roads east and north by chance.
  for (let j = ja - 6; j <= jb + 5; j++) {
    for (let i = ia - 6; i <= ib + 5; i++) {
      const g = at(i, j);
      net.x[g] = nodeX(i, j); net.z[g] = nodeZ(i, j);
      net.chance[g] = (straightRoad(i, j, 0) ? 1 : 0) | (straightRoad(i, j, 2) ? 4 : 0);
    }
  }
  for (let j = ja - 5; j <= jb + 5; j++) {
    for (let i = ia - 5; i <= ib + 5; i++) {
      const g = at(i, j);
      net.full[g] = (net.chance[g] & 5) === 5 && net.chance[at(i - 1, j)] & 1 && net.chance[at(i, j - 1)] & 4 ? 1 : 0;
    }
  }
  // Diagonal roads: across each square with DIAGONAL_CHANCE, the shorter way, and not to a node
  // that already has 4 roads (it would make 5 there).
  for (let b = ja - 5; b <= jb + 4; b++) {
    for (let a = ia - 5; a <= ib + 4; a++) {
      if (random(a, b, 103) >= DIAGONAL_CHANCE) continue;
      const sw = at(a, b), se = at(a + 1, b), nw = at(a, b + 1), ne = at(a + 1, b + 1);
      const ex = net.x[ne] - net.x[sw], ez = net.z[ne] - net.z[sw], wx = net.x[nw] - net.x[se], wz = net.z[nw] - net.z[se];
      if (ex * ex + ez * ez <= wx * wx + wz * wz) {
        if (!net.full[sw] && !net.full[ne]) { net.chance[sw] |= 1 << 1; net.chance[ne] |= 1 << 5; }
      } else if (!net.full[se] && !net.full[nw]) { net.chance[se] |= 1 << 3; net.chance[nw] |= 1 << 7; }
    }
  }
  // Roads west and south: the neighbours' east and north.
  for (let j = ja - 4; j <= jb + 4; j++) {
    for (let i = ia - 4; i <= ib + 4; i++) {
      const g = at(i, j);
      net.chance[g] |= (net.chance[at(i - 1, j)] & 1) << 4 | (net.chance[at(i, j - 1)] & 4) << 4;
    }
  }
  for (let j = ja - 3; j <= jb + 3; j++) for (let i = ia - 3; i <= ib + 3; i++) net.extra[at(i, j)] = extraRoad(i, j);
  for (let j = ja - 2; j <= jb + 2; j++) {
    for (let i = ia - 2; i <= ib + 2; i++) {
      const g = at(i, j);
      let roads = net.chance[g] | (net.extra[g] >= 0 ? 1 << net.extra[g] : 0);
      for (let k = 0; k < 8; k += 2) if (net.extra[at(i + DI[k], j + DJ[k])] === ((k + 4) & 7)) roads |= 1 << k;
      net.roads[g] = roads;
      analyse(i, j);
    }
  }

  list.pieceCount = 0;
  roadCount = 0;
  for (let j = ja - 1; j <= jb + 1; j++) {
    for (let i = ia - 1; i <= ib + 1; i++) {
      for (let k = 0; k < 4; k++) if (net.roads[at(i, j)] >> k & 1) addRoad(list, x0, z0, x1, z1, i, j, k);
    }
  }

  // Groups: roads that carry on into each other through a node are one smooth curve.
  for (let r = 0; r < roadCount; r++) roadGroup[r] = r;
  for (let r = 0; r < roadCount; r++) {
    for (let end = 0; end < 2; end++) {
      const g = end ? roadNodeB[r] : roadNodeA[r], partner = net.partner[8 * g + (end ? roadDirB[r] : roadDirA[r])];
      if (partner < 0) continue;
      for (let s = 0; s < roadCount; s++) {
        if ((roadNodeA[s] === g && roadDirA[s] === partner) || (roadNodeB[s] === g && roadDirB[s] === partner)) {
          roadGroup[root(r)] = root(s);
        }
      }
    }
  }
  let groups = 0;
  groupNumber.fill(-1, 0, roadCount);
  for (let r = 0; r < roadCount; r++) if (groupNumber[root(r)] < 0) groupNumber[root(r)] = groups++;
  const pieces = list.pieces;
  for (let p = 0; p < list.pieceCount * PIECE; p += PIECE) pieces[p + 6] = groupNumber[root(pieces[p + 6])];

  list.groupCount = groups;
}

function root(r) {
  while (roadGroup[r] !== r) r = roadGroup[r] = roadGroup[roadGroup[r]];
  return r;
}

// Room for one more record in the list: its offset, or -1 if the list is full.
function newPiece(list) {
  if (list.pieceCount * PIECE === list.pieces.length) {
    if (!warnedFull) { console.warn('terrain: too many road pieces near one chunk'); warnedFull = true; }
    return -1;
  }
  return list.pieceCount++ * PIECE;
}

// The pieces near the rectangle of the road from node (i, j) in direction k (0-3).
function addRoad(list, x0, z0, x1, z1, i, j, k) {
  const i2 = i + DI[k], j2 = j + DJ[k], back = k + 4, ga = at(i, j), gb = at(i2, j2);
  const ax = net.x[ga], az = net.z[ga], bx = net.x[gb], bz = net.z[gb];
  swingPoint(i, j, k, point);
  const sx = point[0], sz = point[1];
  const kind = kindOf(i, j, k), halfWidth = HALF_WIDTH[kind];
  // Quick test: the curve stays close to its three points, give or take its bends.
  const margin = 0.2 * Math.max(Math.abs(bx - ax), Math.abs(bz - az)) + halfWidth + 1.5 * (MEANDER[kind] + WIND[kind]);
  if (Math.min(ax, sx, bx) - margin > x1 || Math.max(ax, sx, bx) + margin < x0
    || Math.min(az, sz, bz) - margin > z1 || Math.max(az, sz, bz) + margin < z0) return;

  const slot = hash(i, j, 140 + k) & (CACHED_ROADS - 1);
  if (cachedK[slot] !== k || cachedI[slot] !== i || cachedJ[slot] !== j) cacheRoad(slot, i, j, k);
  const b4 = 4 * slot;
  if (cachedBox[b4] > x1 || cachedBox[b4 + 1] > z1 || cachedBox[b4 + 2] < x0 || cachedBox[b4 + 3] < z0) return;
  const last = cachedLast[slot], c = slot * CORNERS, curve = cachedCurve, along = cachedAlong, lift = cachedLift;
  const length = along[c + last];

  const cutA = Number.isNaN(net.cut[3 * (8 * ga + k) + 2]) ? -1 : 3 * (8 * ga + k);
  const cutB = Number.isNaN(net.cut[3 * (8 * gb + back) + 2]) ? -1 : 3 * (8 * gb + back);
  const road = roadCount;
  let listed = false;
  for (let p = c; p < c + last; p++) {
    const px = curve[2 * p], pz = curve[2 * p + 1], qx = curve[2 * p + 2], qz = curve[2 * p + 3];
    if (Math.min(px, qx) > x1 || Math.max(px, qx) < x0 || Math.min(pz, qz) > z1 || Math.max(pz, qz) < z0) continue;
    const r = newPiece(list);
    if (r < 0) return;
    if (!listed) {
      if (roadCount === MAX_ROADS) { list.pieceCount--; return; }
      roadNodeA[road] = ga; roadDirA[road] = k; roadNodeB[road] = gb; roadDirB[road] = back;
      roadCount++;
      listed = true;
    }
    const cut = cutA >= 0 && along[p] < 40 ? cutA : cutB >= 0 && along[p + 1] > length - 40 ? cutB : -1;
    const pieces = list.pieces, ex = qx - px, ez = qz - pz;
    pieces[r] = px; pieces[r + 1] = pz; pieces[r + 2] = ex; pieces[r + 3] = ez;
    pieces[r + 4] = 1 / Math.max(ex * ex + ez * ez, 1e-9); pieces[r + 5] = lift[p]; pieces[r + 12] = lift[p + 1];
    pieces[r + 6] = road; pieces[r + 7] = halfWidth; pieces[r + 8] = 0;
    if (cut >= 0) {
      pieces[r + 8] = CUT;
      pieces[r + 9] = net.cut[cut]; pieces[r + 10] = net.cut[cut + 1]; pieces[r + 11] = net.cut[cut + 2];
    }
  }
}

// Work out the road from node (i, j) in direction k (0-3), into cache slot `slot`.
function cacheRoad(slot, i, j, k) {
  const i2 = i + DI[k], j2 = j + DJ[k], ga = at(i, j), gb = at(i2, j2);
  const ax = net.x[ga], az = net.z[ga], bx = net.x[gb], bz = net.z[gb];
  swingPoint(i, j, k, point);
  const sx = point[0], sz = point[1], kind = kindOf(i, j, k);
  // Its direction through each node: along the road it carries on into there, if any (from one
  // swing point towards the other), else straight towards its own swing point. And through the
  // swing point, from one node towards the other.
  let tax = sx - ax, taz = sz - az, tbx = bx - sx, tbz = bz - sz;
  const partnerA = net.partner[8 * ga + k], partnerB = net.partner[8 * gb + k + 4];
  if (partnerA >= 0) { armSwing(i, j, partnerA, point); tax = (sx - point[0]) / 2; taz = (sz - point[1]) / 2; }
  if (partnerB >= 0) { armSwing(i2, j2, partnerB, point); tbx = (point[0] - sx) / 2; tbz = (point[1] - sz) / 2; }
  const n1 = Math.min(Math.ceil(Math.hypot(sx - ax, sz - az) / PIECE_LENGTH), MAX_SPAN);
  const n2 = Math.min(Math.ceil(Math.hypot(bx - sx, bz - sz) / PIECE_LENGTH), MAX_SPAN);
  drawSpan(ax, az, tax, taz, sx, sz, (bx - ax) / 2, (bz - az) / 2, n1, 0);
  drawSpan(sx, sz, (bx - ax) / 2, (bz - az) / 2, bx, bz, tbx, tbz, n2, n1);
  const last = n1 + n2;
  measure(last);
  wind(last, kind, hash(i, j, 130 + k) | 0);
  measure(last);
  liftRoad(last);

  cachedI[slot] = i; cachedJ[slot] = j; cachedK[slot] = k; cachedLast[slot] = last;
  const c = slot * CORNERS, b4 = 4 * slot, halfWidth = HALF_WIDTH[kind];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let p = 0; p <= last; p++) {
    const x = curve[2 * p], z = curve[2 * p + 1];
    cachedCurve[2 * (c + p)] = x; cachedCurve[2 * (c + p) + 1] = z;
    cachedAlong[c + p] = along[p]; cachedLift[c + p] = lift[p];
    minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  }
  cachedBox[b4] = minX - halfWidth; cachedBox[b4 + 1] = minZ - halfWidth;
  cachedBox[b4 + 2] = maxX + halfWidth; cachedBox[b4 + 3] = maxZ + halfWidth;
}

// m along the curve to each of its corners, into `along`.
function measure(last) {
  along[0] = 0;
  for (let p = 1; p <= last; p++) {
    along[p] = along[p - 1] + Math.hypot(curve[2 * p] - curve[2 * p - 2], curve[2 * p + 1] - curve[2 * p - 1]);
  }
}

// Bend the curve from side to side: each corner moved across it (square to the line between the
// corners either side), smoothly (two layers of noise along the road, `seed` its own), by up to
// about MEANDER m in long bends and WIND m in short ones for its kind of road, and less within
// WIND_EASE m of either end, so the road still leaves each node as it did.
function wind(last, kind, seed) {
  const length = along[last];
  for (let p = 1; p < last; p++) {
    const s = along[p];
    shift[p] = smoothstep(0, WIND_EASE, s) * smoothstep(0, WIND_EASE, length - s)
      * (MEANDER[kind] * noise(s / MEANDER_WAVE, 0.5, seed) + WIND[kind] * noise(s / WIND_WAVE, 0.5, seed + 1));
  }
  let beforeX = curve[0], beforeZ = curve[1];  // the corner before, where it was
  for (let p = 1; p < last; p++) {
    const x = curve[2 * p], z = curve[2 * p + 1], tx = curve[2 * p + 2] - beforeX, tz = curve[2 * p + 3] - beforeZ;
    const l = Math.sqrt(tx * tx + tz * tz);
    curve[2 * p] = x - tz / l * shift[p];
    curve[2 * p + 1] = z + tx / l * shift[p];
    beforeX = x; beforeZ = z;
  }
}

// A Hermite curve from (px, pz) to (qx, qz), leaving along (mx, mz) and arriving along (nx, nz)
// (a Catmull-Rom curve, when those are half the step between the points either side), as
// `pieces` straight pieces: into `curve` from corner `offset`.
function drawSpan(px, pz, mx, mz, qx, qz, nx, nz, pieces, offset) {
  for (let p = 0; p <= pieces; p++) {
    const t = p / pieces, t2 = t * t, t3 = t2 * t;
    const h0 = 2 * t3 - 3 * t2 + 1, h1 = t3 - 2 * t2 + t, h2 = 3 * t2 - 2 * t3, h3 = t3 - t2;
    curve[2 * (offset + p)] = h0 * px + h1 * mx + h2 * qx + h3 * nx;
    curve[2 * (offset + p) + 1] = h0 * pz + h1 * mz + h2 * qz + h3 * nz;
  }
}

// How far each corner of the road is lifted above (or below) roadLevel, into `lift`: so it rises
// and falls with the land beside it (the land's relief, sampled every LIFT_SAMPLE corners along
// it), smoothed over about LIFT_SMOOTH corners each way, and no steeper than LIFT_GRADE on top of
// roadLevel's own. How much of the way it follows the land changes from place to place (follow):
// in some places the roads climb and dip with the hills, in others they keep lower and flatter.
// At each end, by the land at the node, so every road meeting there agrees. (Where the land at the
// two ends differs by more than the grade allows, the road is steeper just after its start.)
const LIFT_GRADE = 0.06;
const LIFT_SAMPLE = 4;   // corners
const LIFT_SMOOTH = 8;   // corners
const follow = (x, z) => 0.2 + 0.75 * smoothstep(-0.3, 0.3, noise(x / 3000, z / 3000, 90));
function liftRoad(last) {
  for (let p = 0; p <= last; p += LIFT_SAMPLE) lift[p] = landLift(curve[2 * p], curve[2 * p + 1]);
  lift[last] = landLift(curve[2 * last], curve[2 * last + 1]);
  for (let p = 1; p < last; p++) {
    const a = p - p % LIFT_SAMPLE, b = Math.min(a + LIFT_SAMPLE, last);
    if (p !== a) lift[p] = lift[a] + (lift[b] - lift[a]) * (p - a) / (b - a);
  }
  smoothLift(last, LIFT_SMOOTH);
  // No steeper than LIFT_GRADE: going forwards from the start, then back from the end.
  for (let p = 1; p <= last; p++) {
    const most = LIFT_GRADE * (along[p] - along[p - 1]);
    lift[p] = Math.min(Math.max(lift[p], lift[p - 1] - most), lift[p - 1] + most);
  }
  lift[last] = lifted[last];
  for (let p = last - 1; p > 0; p--) {
    const most = LIFT_GRADE * (along[p + 1] - along[p]);
    lift[p] = Math.min(Math.max(lift[p], lift[p + 1] - most), lift[p + 1] + most);
  }
  smoothLift(last, 2);  // rounded over the tops and bottoms, where the limit left corners
}
// The lift the land asks for at (x, z).
const landLift = (x, z) => follow(x, z) * relief(x, z);
// Each corner's lift the average of those up to `reach` corners either side (fewer near the ends,
// so the ends stay as they are). Keeps the unsmoothed ends in `lifted`.
function smoothLift(last, reach) {
  for (let p = 0; p <= last; p++) lifted[p] = lift[p];
  for (let p = 1; p < last; p++) {
    const w = Math.min(reach, p, last - p);
    let sum = 0;
    for (let q = p - w; q <= p + w; q++) sum += lifted[q];
    lift[p] = sum / (2 * w + 1);
  }
}

// --- Where a point is on the roads ---
//
// roadDistance finds, for (x, z), into `found`:
//   EDGE: m from the road's edge (negative on it). Roads join with rounded corners: each group of
//     pieces (one smooth curve of road) has its own distance, and where two
//     groups' are within ROAD_ROUNDING m of each other, a smooth minimum dips a little below both.
//     (Not between pieces of one road: at each joint between two, it would bulge out.) Where the
//     minimum blends two roads, its distance grows less than 1 m per metre (at a sharp corner,
//     much less): it's divided by how fast it grows, so the road's frayed edge (terrain.frag)
//     stays as wide round the corners.
//   LAND_EDGE: the same, more rounded and not divided, for shaping the land (no crease halfway
//     between two roads at a junction's corners).
//   LIFT: how far the nearest road is lifted above roadLevel (see liftRoad), at its nearest point.
//     Where other pieces of road are nearly as near (less than LAND_ROUNDING m further), a blend
//     of theirs, by how near: so it changes smoothly from one road to another, and from one bend
//     of a road to the next (which can be at a different height). The pieces of the nearest road
//     itself (its group) each give their lift carried on along their own line past their ends
//     (up to a piece's length), not stopped there: on a steady grade they all agree, so the blend
//     is that grade, and where it changes, it changes smoothly. (Stopped at their ends, the
//     neighbours pulled the lift towards each joint's: along the road, the grade swung from half
//     to a third more than it was every piece, ~10 m, and the car pitched back and forth.)
const found = new Float64Array(3);
const EDGE = 0, LAND_EDGE = 1, LIFT = 2;
const ROAD_ROUNDING = 8;    // m
const LAND_ROUNDING = 10;   // m
// Past a cut, the distance grows this many times faster than it really does, so the rounding
// doesn't reach from it across the road it joins, and pull out that road's far edge.
const CUT_STEEPNESS = 4;
// Per group: its distance, and which way that grows fastest (a unit vector, but see CUT_STEEPNESS);
// and the square of the distance to the middle of its nearest piece that isn't cut.
const groupEdge = new Float64Array(MAX_ROADS + 64);
const groupX = new Float64Array(MAX_ROADS + 64), groupZ = new Float64Array(MAX_ROADS + 64);
const groupNear = new Float64Array(MAX_ROADS + 64);
// Per piece: m from its edge (not cut), its lift at its nearest point, and carried on along its
// line (see LIFT).
const pieceEdge = new Float64Array(20000), pieceLift = new Float64Array(20000), pieceCarried = new Float64Array(20000);
const order = new Int32Array(MAX_ROADS + 64);  // groups, nearest first
let nearestPiece = -1;  // offset of the nearest record, for nearestRoad (a whole number: a fraction would allocate)
function roadDistance(list, x, z) {
  const pieces = list.pieces, groups = list.groupCount;
  for (let g = 0; g < groups; g++) groupEdge[g] = groupNear[g] = Infinity;
  let nearest = Infinity, nearestEdge = Infinity;
  nearestPiece = -1;
  for (let r = 0, i = 0; r < list.pieceCount * PIECE; r += PIECE, i++) {
    const flags = pieces[r + 8], group = pieces[r + 6] | 0;
    const px = x - pieces[r], pz = z - pieces[r + 1], dx = pieces[r + 2], dz = pieces[r + 3];
    const along = (px * dx + pz * dz) * pieces[r + 4], t = Math.min(Math.max(along, 0), 1);
    const ex = px - t * dx, ez = pz - t * dz, d2 = ex * ex + ez * ez;
    if (d2 < nearest) { nearest = d2; nearestPiece = r; }
    const d = Math.sqrt(d2) || 1e-9;
    let edge = d - pieces[r + 7], gx = ex / d, gz = ez / d;
    const rise = pieces[r + 12] - pieces[r + 5];
    pieceEdge[i] = edge; pieceLift[i] = pieces[r + 5] + t * rise;
    pieceCarried[i] = pieces[r + 5] + Math.min(Math.max(along, -1), 2) * rise;
    if (edge < nearestEdge) nearestEdge = edge;
    // Only a nearer piece than the group's nearest can be nearer its edge (they're all as wide),
    // unless it's cut.
    const cut = (flags & CUT) !== 0;
    if (!cut && !(d2 < groupNear[group])) continue;
    if (!cut) groupNear[group] = d2;
    if (cut) {
      const beyond = CUT_STEEPNESS * (pieces[r + 9] * x + pieces[r + 10] * z - pieces[r + 11]);
      if (beyond > edge) { edge = beyond; gx = CUT_STEEPNESS * pieces[r + 9]; gz = CUT_STEEPNESS * pieces[r + 10]; }
    }
    if (edge < groupEdge[group]) { groupEdge[group] = edge; groupX[group] = gx; groupZ[group] = gz; }
  }
  // Smooth minimums, nearest group first: a chain of them gives a different answer in a
  // different order, and chunks either side of an edge find the same groups in different orders.
  // Keeping track of which way the road's grows fastest (by the chain rule: where a is the
  // smaller, it changes by 1 - h/2 per unit change in a, and h/2 per unit change in b).
  let count = 0;
  for (let g = 0; g < groups; g++) {
    const e = groupEdge[g];
    if (e === Infinity) continue;
    let k = count++;
    for (; k > 0 && groupEdge[order[k - 1]] > e; k--) order[k] = order[k - 1];
    order[k] = g;
  }
  let edge = Infinity, land = Infinity, gx = 0, gz = 0;
  for (let k = 0; k < count; k++) {
    const g = order[k], e = groupEdge[g];
    if (k === 0) { edge = land = e; gx = groupX[g]; gz = groupZ[g]; continue; }
    const h = Math.max(ROAD_ROUNDING - Math.abs(edge - e), 0) / ROAD_ROUNDING, w = edge < e ? h / 2 : 1 - h / 2;
    gx += w * (groupX[g] - gx); gz += w * (groupZ[g] - gz);
    edge = Math.min(edge, e) - h * h * ROAD_ROUNDING / 4;
    const l = Math.max(LAND_ROUNDING - Math.abs(land - e), 0) / LAND_ROUNDING;
    land = Math.min(land, e) - l * l * LAND_ROUNDING / 4;
  }
  found[EDGE] = edge / Math.max(Math.sqrt(gx * gx + gz * gz), 0.25);
  found[LAND_EDGE] = land;
  // The lift: each piece less than LAND_ROUNDING m further than the nearest, weighted by how much
  // less; the nearest road's own pieces, carried on along their lines.
  let lifts = 0, weights = 0;
  const road = nearestPiece < 0 ? -1 : pieces[nearestPiece + 6];
  for (let i = 0; i < list.pieceCount; i++) {
    const w = 1 - (pieceEdge[i] - nearestEdge) / LAND_ROUNDING;
    if (w > 0) { lifts += w * w * (pieces[i * PIECE + 6] === road ? pieceCarried[i] : pieceLift[i]); weights += w * w; }
  }
  found[LIFT] = weights > 0 ? lifts / weights : 0;
  return found[EDGE];
}

// The pieces of `list` that can change what roadDistance finds anywhere within r m of (x, z),
// copied into `into`: roadDistance then finds exactly the same there, faster. A piece can't if,
// everywhere there, its road's edge is at least LAND_ROUNDING m further than some other piece's
// (the smooth minimums and the lift's blend don't reach that far). Returns how near a road's edge
// can come anywhere there.
const edgeFrom = new Float64Array(4000);  // per piece: m from (x, z) to its road's edge
function nearbyRoads(list, into, x, z, r) {
  const pieces = list.pieces, end = list.pieceCount * PIECE;
  // Nowhere there is the edge further than this. (Not from cut pieces: a cut can move their edge
  // further than their distance says.)
  let bound = Infinity, lowest = Infinity;
  for (let p = 0, i = 0; p < end; p += PIECE, i++) {
    const px = x - pieces[p], pz = z - pieces[p + 1], dx = pieces[p + 2], dz = pieces[p + 3];
    const t = Math.min(Math.max((px * dx + pz * dz) * pieces[p + 4], 0), 1), ex = px - t * dx, ez = pz - t * dz;
    const d = Math.sqrt(ex * ex + ez * ez);
    const edge = edgeFrom[i] = d - pieces[p + 7];
    if (!(pieces[p + 8] & CUT) && edge + r < bound) bound = edge + r;
    if (edge - r < lowest) lowest = edge - r;
  }
  const out = into.pieces;
  let q = 0;
  for (let p = 0, i = 0; p < end; p += PIECE, i++) {
    if (edgeFrom[i] - r >= bound + LAND_ROUNDING) continue;
    for (let k = 0; k < PIECE; k++) out[q + k] = pieces[p + k];
    q += PIECE;
  }
  into.pieceCount = q / PIECE;
  into.groupCount = list.groupCount;
  return lowest;
}

// What roadDistance finds wherever every road is at least FAR m away (from its edge). The smooth
// minimums can bring the edge nearer than the nearest road's, but by less than their rounding: so
// the land is still WILD. (FAR is with WILD, below.)
function farFromRoads() {
  found[EDGE] = found[LAND_EDGE] = FAR - LAND_ROUNDING;
  found[LIFT] = 0;
}

// --- The land ---

// Height of the roads, before each is lifted to follow the land (liftRoad): long, gentle hills.
function roadLevel(x, z) {
  return 20 * layers(x / 900, z / 900, 3, 0.35, 10);
}

const VERGE = 4.5;     // m from the road's edge: as flat as the road (4.5-16.5 m)
const RISE = 50;       // m over which the land beyond the verge turns fully wild
const WILD = VERGE + 12 + RISE;  // m from the road's edge: beyond this, roads don't matter
const FAR = WILD + LAND_ROUNDING;  // m: roads this far away change nothing at all (farFromRoads)

// Forest country: rounded hills everywhere, and long ridges winding between broad valleys (where
// the ridge noise crosses 0), rounded along the top and taller in some places than others; and
// smaller ridges, spurs off the big ones and ribs down their sides. The valleys are shallow: the
// land seldom falls far below the roads, which rise and fall with it (liftRoad).
const HILLS = 12;          // m, up or down
const RIDGE_WAVE = 500;    // m: ridges are roughly this far apart
const RIDGE_WIDTH = 0.4;   // how much of the ridge noise's range is ridge, not valley
const RIDGE_HEIGHT = 40;   // m above the valleys, on average (±20 m)
const SPUR_WAVE = 170, SPUR_WIDTH = 0.4, SPUR_HEIGHT = 10;  // m, -, m: the small ridges
const VALLEY = 4;          // m: the valley floors, below roadLevel

// The land's height above roadLevel at (x, z), away from any road.
function relief(x, z) {
  const hills = HILLS * layers(x / 220, z / 220, 3, 0.45, 30);
  const across = noise(x / RIDGE_WAVE, z / RIDGE_WAVE, 40) / RIDGE_WIDTH;  // 0 along a ridge's top
  const top = Math.max(1 - across * across, 0);
  const ridges = (RIDGE_HEIGHT + 20 * noise(x / 1600, z / 1600, 50)) * top * top;
  const spurAcross = noise(x / SPUR_WAVE, z / SPUR_WAVE, 45) / SPUR_WIDTH;
  const spur = Math.max(1 - spurAcross * spurAcross, 0);
  return hills + ridges + SPUR_HEIGHT * spur * spur - VALLEY;
}

// Ground height at (x, z), `road` metres from the nearest road's edge, where that road is lifted
// `lift` m above roadLevel.
function landHeight(x, z, road, lift) {
  const level = roadLevel(x, z) + lift;
  if (road < VERGE) return level;
  // How far the land may stray from the road's level: not at all on the road and its verges,
  // which widen and narrow as the road goes; fully from WILD m, however wide the verge.
  let wild = 1;
  if (road < WILD) {
    const verge = VERGE + 12 * smoothstep(-0.5, 0.5, noise(x / 160, z / 160, 60));
    wild = smoothstep(verge, verge + RISE, road);
    if (wild === 0) return level;
  }
  return level + (relief(x, z) - lift) * wild;
}

// --- Bamboo ---
//
// The forest is bamboo, in groves with clearings between them: how thick it grows at (x, z), 0 to
// 1, from noise on two scales, and none on the road or just beside it (`road`: m from its edge).
// Each vertex keeps it (in its spare byte), for terrain.frag to darken the ground under the groves
// and tint the far land as their tops; and level 0's chunks plant their stalks by it (plantBamboo).
const GROVE_WAVE = 90, CLUMP_WAVE = 20;  // m: groves and clearings, and clumps within them
const GROVE_FROM = 1, GROVE_TO = 5;      // m from the road's edge: none nearer; as thick as it gets from here
function grove(x, z, road) {
  if (road < GROVE_FROM) return 0;
  const n = 0.7 * noise(x / GROVE_WAVE, z / GROVE_WAVE, 110) + 0.3 * noise(x / CLUMP_WAVE, z / CLUMP_WAVE, 111);
  return smoothstep(-0.35, 0.2, n) * smoothstep(GROVE_FROM, GROVE_TO, road);  // ~1/5 clearings, ~2/5 thick
}

// Stalks: in each PLANT × PLANT m square of the world, one or none, at a random point in it, more
// likely the thicker the grove there. Each is 7-15 m tall and 7-16 cm across (the taller the
// thicker), leaning a little any way, and near a road leaning out over it, as bamboo along a lane
// does, towards the light. For the GPU (two texels of a float texture: see bamboo.glsl), per stalk:
// its base (x, y, z) and height, in m; its radius (m), which strip of the culm texture it wears
// (textures.js), and how far it leans along x and along z (the sine of the angle each way).
//
// Planted by the chunks of the first STALK_LEVELS levels (level 0's to ~100 m, level 1's to ~220 m),
// the same stalks whichever: where each is, and whether it grows, come from its square of the world
// and the grove worked out afresh there (not read from the vertices), so a chunk giving way to its
// children, or they to it, changes nothing. Only the height of its foot (from the chunk's own
// vertices, a few cm apart) and its lean out over a road can differ a little. (Level 0's chunks
// alone planted them until 29 Sep 2026, so strands stopped at ~90 m: see bamboo.js.)
export const STALK_LEVELS = 2;
const PLANT = 1.5;                                    // m
const PLANTS = CHUNK_QUADS / PLANT;                   // squares along a level-0 chunk's side (20)
export const MAX_STALKS = PLANTS * PLANTS;            // per level-0 chunk (400); 4 times as many at level 1
export const STALK_FLOATS = 8;
const MAX_LEAN = 0.3;                                 // rad, from both kinds of leaning together
const LEAN = 0.05;                                    // rad, at most, any way
const LEAN_OUT = 0.2, LEAN_REACH = 10;                // rad, m: out over a road, from up to this far from it
const CULM_STRIPS = 32;                               // textures.js: N / CULM_STRIP

// Far off, the bamboo is drawn as clumps (bamboo.js): in each CLUMP × CLUMP m square, one or none,
// a card standing for all the stalks that grow in it, likelier the thicker the grove, and none so
// near a road that the card, turned to face the camera, could stand out over it. Every chunk
// plants them, at every level of detail, on the same squares, with the same random numbers: so when
// a chunk gives way to its finer children, they have (nearly: the grove and the height are read
// from coarser vertices) the same clumps. For the GPU, per clump (a texel of a float texture): its
// foot (x, y, z) and height, in m. A chunk's stalks are kept a square at a time, and each clump
// keeps which of its chunk's squares it's in (numbered along x, then z), so bamboo.js can swap a
// square's stalks for its clump, and skip or take a square's stalks all together.
export const CLUMP = 6;                               // m: a multiple of PLANT, and divides a level-0 chunk (30 m)
export const CLUMP_FLOATS = 4;
const CLUMP_TALL = 8, CLUMP_TALLER = 6;               // m: 8-14 m tall

// --- Chunks ---

// Roads whose middle is within this of a chunk can matter to it: the land beyond WILD m is the
// same whatever the roads, but a road up to LAND_ROUNDING m further than the nearest one still
// rounds off the distance to it. (Leave one out, and the chunks either side of an edge can
// disagree on the heights along it.)
const ROAD_REACH = WILD + LAND_ROUNDING + Math.max(...HALF_WIDTH);

// Levels of detail. Level 0 has a vertex every metre; each level up, they're twice as far apart,
// so its chunks (still 31 × 31 vertices, drawn with the same index list) cover twice as much ground
// each way. The land is smooth enough that coarser squares barely show at a distance: against the
// 1 m mesh, 99.9% of points sampled every 2 m are within 6 cm, and every 4 m within 21 cm (under a
// pixel beyond ~30 m and ~90 m).
//
// Skirts: each chunk also hangs a curtain from its edges, facing out: the last 4 × 31 vertices,
// copies of the edge ones, SKIRT m per m of spacing lower. Where a finer chunk meets a coarser one,
// the finer's edge has vertices between the coarser's, and they needn't lie on its straight edge:
// the skirts fill the cracks. (They measured under 0.5 m: at most 19% of a skirt.)
const VERTICES = CHUNK_VERTS * CHUNK_VERTS;
const SKIRT_VERTICES = 4 * CHUNK_VERTS;
const SKIRT = 2;  // m per m between vertices
// Room for road pieces per chunk: twice the most measured (40, 51 and 83 at levels 0 to 2, over
// ~14,500 chunks). A fuller list drops pieces (and warns).
const ROAD_PIECES = 176;
const FRAY = 0.5;       // m: how far the road's painted edge wanders in and out
const FRAY_WAVE = 2.5;  // m: roughly how far apart its bulges are

// Vertex index of the t-th vertex along side 0 (z = 0), 1 (z = 30), 2 (x = 0) or 3 (x = 30).
function edgeVertex(side, t) {
  return side === 0 ? t : side === 1 ? CHUNK_QUADS * CHUNK_VERTS + t : side === 2 ? t * CHUNK_VERTS : t * CHUNK_VERTS + CHUNK_QUADS;
}

// The land around the camera, built as it moves.
//   draw: m: chunks within this are drawn (the fog's end).
//   ahead: m: chunks are built this much before they're needed: beyond `draw`, and before each
//     change to a finer level.
//   detail: m: where each finer level takes over, finest first. [100, 220]: 1 m squares within
//     100 m, 2 m within 220 m, 4 m beyond. Empty: 1 m squares throughout.
//   radius: at most this many chunks of the coarsest level built each way from the camera's (the
//     benches build a square of them).
// Each level keeps its chunks in a ring of n × n slots: chunk (cx, cz) always uses slot
// (cx mod n, cz mod n), so when the camera moves on, the chunks it leaves behind free exactly the
// slots the new ones need. n is enough for every chunk the level can want at once.
export function createTerrain({ draw = Infinity, ahead = 0, detail = [], radius = Infinity } = {}) {
  const top = detail.length;  // the coarsest level
  const levels = [], slots = [];
  for (let level = 0; level <= top; level++) {
    const spacing = 1 << level, size = CHUNK_QUADS * spacing;
    // How far (to its nearest point) a chunk of this level can be wanted: the top level's, up to
    // `ahead` beyond `draw`; a finer level's, while its parent is that close to where the level
    // takes over, and so up to half the parent's diagonal further.
    const reach = level === top ? draw + ahead : detail[level] + ahead + size * Math.SQRT2;
    const scan = Math.min(radius, Math.ceil(reach / size));  // chunks each way to look through
    const n = Math.min(2 * scan + 1, Math.floor(2 * reach / size) + 2);
    levels.push({ spacing, size, n, scan, first: slots.length, finer: level > 0 ? detail[level - 1] : 0 });
    for (let k = 0; k < n * n; k++) {
      slots.push({
        index: slots.length, level, spacing, size,
        cx: 0, cz: 0,        // which chunk of its level it holds
        x: 0, z: 0,          // world position of its first vertex
        // Per vertex, 4 16-bit numbers: height in cm; cm from the road's edge, frayed (see
        // buildRow); then as bytes, the ground's unit normal x, y, z, each × 127, and how thick the
        // bamboo grows (grove, × 127). Then the skirts' vertices.
        vertices: new Int16Array((VERTICES + SKIRT_VERTICES) * VERTEX_SHORTS),
        // Heights in m, one row and column wider on each side than the chunk: the normals at its
        // edges need the heights just beyond them.
        heights: new Float32Array(BORDERED * BORDERED),
        minY: 0, maxY: 0,    // the box it fits in (skirts included), for culling
        rowsBuilt: -1,       // rows of `heights` done; -1: not started
        ready: false,        // all its rows built
        version: 0,          // goes up each time it's rebuilt, so main.js knows to re-upload it
        roads: createRoadList(ROAD_PIECES),
        // The first STALK_LEVELS levels': its bamboo (plantBamboo), STALK_FLOATS per stalk, a square
        // after another, how many stalks, and where each square's start (and after the last, end).
        stalks: level < STALK_LEVELS ? new Float32Array((size / PLANT) ** 2 * STALK_FLOATS) : null, stalkCount: 0,
        squareStarts: level < STALK_LEVELS ? new Uint16Array((size / CLUMP) ** 2 + 1) : null,
        // Every level's: its far bamboo (plantClumps), CLUMP_FLOATS per clump, how many, and each
        // one's square.
        clumps: new Float32Array((size / CLUMP) ** 2 * CLUMP_FLOATS), clumpCount: 0,
        clumpSquares: new Uint16Array((size / CLUMP) ** 2),
      });
    }
  }

  // One grid square, two triangles: must match the vertex order in terrain.vert. Then the skirts,
  // two triangles per edge square, wound to face out of the chunk.
  const indices = new Uint16Array((CHUNK_QUADS * CHUNK_QUADS + 4 * CHUNK_QUADS) * 6);
  let i = 0;
  for (let z = 0; z < CHUNK_QUADS; z++) {
    for (let x = 0; x < CHUNK_QUADS; x++) {
      const a = z * CHUNK_VERTS + x, b = a + 1, c = a + CHUNK_VERTS, d = c + 1;
      indices[i++] = a; indices[i++] = c; indices[i++] = b;
      indices[i++] = b; indices[i++] = c; indices[i++] = d;
    }
  }
  for (let side = 0; side < 4; side++) {
    for (let t = 0; t < CHUNK_QUADS; t++) {
      const e0 = edgeVertex(side, t), e1 = edgeVertex(side, t + 1);
      const s0 = VERTICES + side * CHUNK_VERTS + t, s1 = s0 + 1;
      if (side === 0 || side === 3) {  // e0 → e1 → s0 faces -z on side 0, +x on side 3
        indices[i++] = e0; indices[i++] = e1; indices[i++] = s0;
        indices[i++] = e1; indices[i++] = s1; indices[i++] = s0;
      } else {
        indices[i++] = e0; indices[i++] = s0; indices[i++] = e1;
        indices[i++] = e1; indices[i++] = s0; indices[i++] = s1;
      }
    }
  }

  const mod = (k, n) => { const m = k % n; return m < 0 ? m + n : m; };
  function slotAt(level, cx, cz) {
    const { first, n } = levels[level];
    return slots[first + mod(cz, n) * n + mod(cx, n)];
  }
  const slotFor = (cx, cz) => slotAt(0, cx, cz);  // level 0's: the physics' and the roads'
  function built(level, cx, cz) {
    const slot = slotAt(level, cx, cz);
    return slot.ready && slot.cx === cx && slot.cz === cz;
  }
  // m from (x, z) to the nearest point of chunk (cx, cz) of `level`.
  function gap(level, cx, cz, x, z) {
    const size = levels[level].size, x0 = cx * size, z0 = cz * size;
    const gx = Math.max(x0 - x, 0, x - x0 - size), gz = Math.max(z0 - z, 0, z - z0 - size);
    return Math.sqrt(gx * gx + gz * gz);
  }

  function assign(slot, cx, cz) {
    slot.cx = cx; slot.cz = cz;
    slot.x = cx * slot.size; slot.z = cz * slot.size;
    slot.rowsBuilt = -1;
    slot.ready = false;
  }

  const STRETCH = 11;  // vertices: a row of 33 is 3 stretches
  const nearby = createRoadList(ROAD_PIECES);

  // Build one row of a chunk's bordered heights (the first call also finds the roads near it).
  // Rows inside the chunk also become vertices; and once the row after a vertex row is done,
  // that row's normals can be worked out from the heights around each vertex. Then, at the levels
  // that plant stalks, a row of its squares' stalks a call (a level-1 chunk plants 1,600 places:
  // all at once, 0.2-0.3 ms past the building's budget); then it's ready.
  function buildRow(slot) {
    if (slot.rowsBuilt >= BORDERED) {
      plantBamboo(slot, slot.rowsBuilt - BORDERED);
      if (++slot.rowsBuilt === BORDERED + slot.size / CLUMP) finish(slot);
      return;
    }
    const s = slot.spacing;
    if (slot.rowsBuilt < 0) {
      findRoads(slot.roads, slot.x - ROAD_REACH, slot.z - ROAD_REACH,
        slot.x + slot.size + ROAD_REACH, slot.z + slot.size + ROAD_REACH);
      slot.minY = Infinity; slot.maxY = -Infinity;
      slot.rowsBuilt = 0;
    }
    const row = slot.rowsBuilt, z = row - 1;  // z: vertex row, from -1 to CHUNK_VERTS
    const v = slot.vertices, heights = slot.heights, wz = slot.z + z * s;
    let far = false;
    for (let x = -1; x <= CHUNK_VERTS; x++) {
      const wx = slot.x + x * s;
      // Only the roads that matter here, a stretch of the row at a time: most of the chunk's are
      // too far from any one stretch to change it (a third of the time building, before).
      // Where they're all too far to change anything, not even that.
      if ((x + 1) % STRETCH === 0) far = nearbyRoads(slot.roads, nearby, wx + (STRETCH - 1) / 2 * s, wz, (STRETCH - 1) / 2 * s) >= FAR;
      if (far) farFromRoads();
      else roadDistance(nearby, wx, wz);
      const height = landHeight(wx, wz, found[LAND_EDGE], found[LIFT]);
      heights[row * BORDERED + x + 1] = height;
      if (x < 0 || x >= CHUNK_VERTS || z < 0 || z >= CHUNK_VERTS) continue;  // the border
      const cm = Math.min(Math.max(Math.round(height * 100), -32767), 32767);
      const o = (z * CHUNK_VERTS + x) * VERTEX_SHORTS;
      v[o] = cm;
      // The road's edge for the shader to paint, frayed: in and out by up to about FRAY m, so the
      // sand wanders into the grass. (Only near it: further out, nothing is painted by it.)
      let edge = found[EDGE];
      if (edge < 8) edge += FRAY * noise(wx / FRAY_WAVE, wz / FRAY_WAVE, 80);
      v[o + 1] = Math.min(Math.max(Math.round(edge * 100), -32767), 32767);
      v[o + 3] = Math.round(127 * grove(wx, wz, found[EDGE])) << 8;  // the grove; its normal's z joins it below
      slot.minY = Math.min(slot.minY, cm / 100);
      slot.maxY = Math.max(slot.maxY, cm / 100);
    }
    if (z >= 1) {
      // Normals of the vertex row before this one: the slope across each vertex, from the
      // heights either side of it. Smooth: each is shared by the 6 triangles round the vertex.
      const nz = z - 1, above = row * BORDERED, below = (row - 2) * BORDERED;
      for (let x = 0; x < CHUNK_VERTS; x++) {
        const slopeX = (heights[(row - 1) * BORDERED + x + 2] - heights[(row - 1) * BORDERED + x]) / (2 * s);
        const slopeZ = (heights[above + x + 1] - heights[below + x + 1]) / (2 * s);
        const scale = 127 / Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ);
        const o = (nz * CHUNK_VERTS + x) * VERTEX_SHORTS;
        v[o + 2] = Math.round(-slopeX * scale) & 255 | Math.round(scale) << 8;
        v[o + 3] = v[o + 3] & 0xff00 | Math.round(-slopeZ * scale) & 255;  // beside the grove's byte
      }
    }
    if (++slot.rowsBuilt === BORDERED) {
      addSkirts(slot);
      if (slot.level >= STALK_LEVELS) finish(slot);
    }
  }
  function finish(slot) {
    plantClumps(slot);
    slot.ready = true;
    slot.version++;
  }

  // The skirts' vertices: the edge ones again, lower.
  function addSkirts(slot) {
    const v = slot.vertices, drop = SKIRT * slot.spacing;
    for (let side = 0; side < 4; side++) {
      for (let t = 0; t < CHUNK_VERTS; t++) {
        const from = edgeVertex(side, t) * VERTEX_SHORTS, to = (VERTICES + side * CHUNK_VERTS + t) * VERTEX_SHORTS;
        for (let k = 0; k < VERTEX_SHORTS; k++) v[to + k] = v[from + k];
        v[to] = Math.max(v[from] - drop * 100, -32767);
      }
    }
    slot.minY -= drop;
  }

  // The chunk's bamboo (see "Bamboo", above), in the squares of row `strip`: the road's edge at each
  // stalk and the ground's height from its finished vertices (the height on the same triangles as
  // heightAt), the grove afresh.
  function plantBamboo(slot, strip) {
    const v = slot.vertices, stalks = slot.stalks, s = slot.spacing, cells = slot.size / PLANT, across = slot.size / CLUMP;
    const S = VERTEX_SHORTS, next = CHUNK_VERTS * VERTEX_SHORTS, perSquare = CLUMP / PLANT;
    let count = strip === 0 ? 0 : slot.squareStarts[strip * across];
    for (let q = strip * across; q < (strip + 1) * across; q++) {
      slot.squareStarts[q] = count;
      for (let k = 0; k < perSquare * perSquare; k++) {
        const i = q % across * perSquare + k % perSquare, j = Math.floor(q / across) * perSquare + Math.floor(k / perSquare);
        const where = hash(slot.cx * cells + i, slot.cz * cells + j, 150);
        const x = (i + (where & 1023) / 1024) * PLANT, z = (j + (where >>> 10 & 1023) / 1024) * PLANT;
        const gx = Math.min(Math.floor(x / s), CHUNK_QUADS - 1), gz = Math.min(Math.floor(z / s), CHUNK_QUADS - 1);
        const fx = x / s - gx, fz = z / s - gz, o = (gz * CHUNK_VERTS + gx) * S;
        const ea = v[o + 1], eb = v[o + S + 1], ec = v[o + next + 1], ed = v[o + next + S + 1];
        const edge = 0.01 * (ea + (eb - ea) * fx + (ec - ea) * fz + (ea - eb - ec + ed) * fx * fz);
        if ((where >>> 20 & 1023) / 1024 >= grove(slot.x + x, slot.z + z, edge)) continue;
        const a = v[o], b = v[o + S], c = v[o + next], d = v[o + next + S];
        const y = 0.01 * (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d - (d - c) * (1 - fx) - (d - b) * (1 - fz));
        const look = hash(slot.cx * cells + i, slot.cz * cells + j, 151), size = (look & 255) / 255;
        // Leaning: a little any way, and out over the road, which is where the edge's distance falls.
        let leanX = LEAN * ((look >>> 13 & 255) / 127.5 - 1), leanZ = LEAN * ((look >>> 21 & 255) / 127.5 - 1);
        if (edge < LEAN_REACH) {
          const slopeX = eb - ea + ed - ec, slopeZ = ec - ea + ed - eb, length = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
          if (length > 0) {
            const out = LEAN_OUT * (1 - edge / LEAN_REACH) / length;
            leanX -= slopeX * out; leanZ -= slopeZ * out;
          }
        }
        const lean = Math.sqrt(leanX * leanX + leanZ * leanZ), within = lean > MAX_LEAN ? MAX_LEAN / lean : 1;
        const f = count * STALK_FLOATS;
        stalks[f] = slot.x + x; stalks[f + 1] = y; stalks[f + 2] = slot.z + z;
        stalks[f + 3] = 7 + 8 * size;                                   // height
        stalks[f + 4] = 0.035 + 0.04 * size + 0.0015 * (look >>> 29);  // radius
        stalks[f + 5] = look >>> 8 & CULM_STRIPS - 1;
        stalks[f + 6] = leanX * within; stalks[f + 7] = leanZ * within;
        count++;
      }
    }
    slot.squareStarts[(strip + 1) * across] = count;
    slot.stalkCount = count;
  }

  // The chunk's clumps (see "Bamboo", above), like its stalks, but on CLUMP squares of the world, at
  // a random point in the middle 60% of each: the grove's thickness and the height there from the
  // chunk's own vertices, however far apart they are.
  function plantClumps(slot) {
    const v = slot.vertices, clumps = slot.clumps, s = slot.spacing, squares = slot.size / CLUMP;
    const S = VERTEX_SHORTS, next = CHUNK_VERTS * VERTEX_SHORTS;
    let count = 0;
    for (let j = 0; j < squares; j++) {
      for (let i = 0; i < squares; i++) {
        const where = hash(slot.cx * squares + i, slot.cz * squares + j, 160);
        const x = (i + 0.2 + 0.6 * (where & 1023) / 1024) * CLUMP, z = (j + 0.2 + 0.6 * (where >>> 10 & 1023) / 1024) * CLUMP;
        const gx = Math.min(Math.floor(x / s), CHUNK_QUADS - 1), gz = Math.min(Math.floor(z / s), CHUNK_QUADS - 1);
        const fx = x / s - gx, fz = z / s - gz, o = (gz * CHUNK_VERTS + gx) * S;
        const g0 = (v[o + 3] >> 8 & 255) + ((v[o + S + 3] >> 8 & 255) - (v[o + 3] >> 8 & 255)) * fx;
        const g1 = (v[o + next + 3] >> 8 & 255) + ((v[o + next + S + 3] >> 8 & 255) - (v[o + next + 3] >> 8 & 255)) * fx;
        if ((where >>> 20 & 1023) / 1024 * 127 >= g0 + (g1 - g0) * fz) continue;
        const ea = v[o + 1], eb = v[o + S + 1], ec = v[o + next + 1], ed = v[o + next + S + 1];
        if (ea + (eb - ea) * fx + (ec - ea) * fz + (ea - eb - ec + ed) * fx * fz < 100 * CLUMP / 2) continue;  // cm from the road
        const a = v[o], b = v[o + S], c = v[o + next], d = v[o + next + S];
        const y = 0.01 * (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d - (d - c) * (1 - fx) - (d - b) * (1 - fz));
        const look = hash(slot.cx * squares + i, slot.cz * squares + j, 161);
        const f = count * CLUMP_FLOATS;
        clumps[f] = slot.x + x; clumps[f + 1] = y; clumps[f + 2] = slot.z + z;
        clumps[f + 3] = CLUMP_TALL + CLUMP_TALLER * (look & 255) / 255;
        slot.clumpSquares[count] = i + j * squares;
        count++;
      }
    }
    slot.clumpCount = count;
  }

  // The unbuilt chunk needed soonest, given a slot; or null if all are built. How soon a chunk is
  // needed: as m the camera is from needing it (negative: it already is). A top-level chunk is
  // needed once it's within `draw`; a finer one once its parent is within where its level takes
  // over. Chunks are wanted `ahead` m sooner, and not once they're `ahead` m inside where their
  // own children take over. (The distances worked out inline: as functions, returning numbers,
  // they made garbage.)
  function mostDue(x, z) {
    let soonest = Infinity, bestLevel = -1, bestX = 0, bestZ = 0;
    for (let level = 0; level <= top; level++) {
      const { size, scan, finer, first, n } = levels[level], cx = Math.floor(x / size), cz = Math.floor(z / size);
      const until = level === top ? draw : detail[level], parent = 2 * size;
      for (let dz = -scan; dz <= scan; dz++) {
        const z0 = (cz + dz) * size, gapZ = Math.max(z0 - z, 0, z - z0 - size);
        const pz0 = ((cz + dz) >> 1) * parent, parentZ = Math.max(pz0 - z, 0, z - pz0 - parent);
        const row = first + mod(cz + dz, n) * n;  // the slots, stepped through as slotAt finds them
        let column = mod(cx - scan, n) - 1;
        for (let dx = -scan; dx <= scan; dx++) {
          if (++column === n) column = 0;
          const x0 = (cx + dx) * size, gapX = Math.max(x0 - x, 0, x - x0 - size);
          const d = Math.sqrt(gapX * gapX + gapZ * gapZ);
          if (level > 0 && d < finer - ahead) continue;  // well inside where its children take over
          let due = d - until;
          if (level < top) {
            const px0 = ((cx + dx) >> 1) * parent, parentX = Math.max(px0 - x, 0, x - px0 - parent);
            due = Math.sqrt(parentX * parentX + parentZ * parentZ) - until;
          }
          if (!(due < ahead && due < soonest)) continue;
          const slot = slots[row + column];
          if (slot.ready && slot.cx === cx + dx && slot.cz === cz + dz) continue;  // built
          soonest = due; bestLevel = level; bestX = cx + dx; bestZ = cz + dz;
        }
      }
    }
    if (bestLevel < 0) return null;
    const slot = slotAt(bestLevel, bestX, bestZ);
    if (slot.cx !== bestX || slot.cz !== bestZ) assign(slot, bestX, bestZ);
    return slot;
  }

  // What to draw from (x, z): into drawList (slot indices, nearest first), drawCount long. From
  // each top-level chunk within `draw`, down: a chunk gives way to its 4 children where the finer
  // level takes over, but only once they (or theirs) can all be drawn, so the land never has a
  // hole while they're built. Where nothing can be drawn, the nearest such hole is noted.
  const drawList = new Int32Array(slots.length), drawGap = new Float64Array(slots.length);
  let drawCount = 0, holeGap = Infinity, holeLevel = 0, holeX = 0, holeZ = 0;
  function covered(level, cx, cz, x, z) {
    if (built(level, cx, cz) || gap(level, cx, cz, x, z) >= draw) return true;
    if (level === 0) return false;
    for (let k = 0; k < 4; k++) if (!covered(level - 1, 2 * cx + (k & 1), 2 * cz + (k >> 1), x, z)) return false;
    return true;
  }
  function visit(level, cx, cz, x, z) {
    const d = gap(level, cx, cz, x, z);
    if (d >= draw) return;
    const here = built(level, cx, cz), finer = level > 0 && d < levels[level].finer;
    // Where the finer level is wanted but this chunk isn't built, its children, holes or not (they
    // are what's needed). Otherwise, if this is where the finer level takes over, or this chunk
    // isn't built, its children only if they can all be drawn.
    let refine = finer && !here;
    if (!refine && level > 0 && (finer || !here)) {
      refine = true;
      for (let k = 0; k < 4 && refine; k++) refine = covered(level - 1, 2 * cx + (k & 1), 2 * cz + (k >> 1), x, z);
    }
    if (refine) {
      for (let k = 0; k < 4; k++) visit(level - 1, 2 * cx + (k & 1), 2 * cz + (k >> 1), x, z);
    } else if (here) {
      let k = drawCount++;
      for (; k > 0 && drawGap[k - 1] > d; k--) { drawList[k] = drawList[k - 1]; drawGap[k] = drawGap[k - 1]; }
      drawList[k] = slotAt(level, cx, cz).index; drawGap[k] = d;
    } else if (d < holeGap) {
      holeGap = d; holeLevel = level; holeX = cx; holeZ = cz;
    }
  }
  function select(x, z) {
    drawCount = 0; holeGap = Infinity;
    if (draw === Infinity) return;  // the benches: nothing to draw
    const { size, scan } = levels[top], cx = Math.floor(x / size), cz = Math.floor(z / size);
    for (let dz = -scan; dz <= scan; dz++) for (let dx = -scan; dx <= scan; dx++) visit(top, cx + dx, cz + dz, x, z);
  }

  // Keep the chunks around (x, z) built, the soonest needed first, a row at a time, for up to
  // `budget` ms; what's left carries on next frame. Then work out what to draw; and any hole in it
  // nearer than `needed` m is filled at once, whatever the budget. Returns rows built.
  //
  // Chunks come into range by distance, not a whole row of them each time the camera crosses
  // into the next chunk, so a few at a time.
  //
  // And no more than ROWS_PER_MS rows per ms of budget. A row takes ~15 µs in Chrome, where the
  // clock stops it first (~66 rows in 1 ms). Firefox's clock is rounded to 1 ms, or much coarser
  // with its fingerprinting protection on: there, waiting for it to tick could build for many ms.
  const ROWS_PER_MS = 100;
  let behind = 0;  // holes filled past the budget, last update
  function update(x, z, budget, needed = 0) {
    const start = performance.now(), most = budget * ROWS_PER_MS;
    let rows = 0, slot = null;
    while (rows < most && performance.now() - start < budget) {
      if (!slot || slot.ready) {
        slot = mostDue(x, z);
        if (!slot) break;  // all built
      }
      buildRow(slot);
      rows++;
    }
    behind = 0;
    for (select(x, z); holeGap < needed; select(x, z)) {
      const hole = slotAt(holeLevel, holeX, holeZ);
      if (hole.cx !== holeX || hole.cz !== holeZ) assign(hole, holeX, holeZ);
      while (!hole.ready) { buildRow(hole); rows++; }
      behind++;
    }
    return rows;
  }

  // Ground height at world position (x, z), from level 0. Uses the same two triangles per square
  // as the mesh, so things placed with it sit exactly on the rendered surface. If `normal` (an
  // array of 3) is given, that triangle's unit normal, pointing out of the ground, is written into
  // it. A chunk that isn't built yet is built on the spot.
  let last = slots[0];  // the chunk the last call found: the car's wheels mostly share one
  function heightAt(wx, wz, normal) {
    let slot = last;
    const gx0 = wx - slot.x, gz0 = wz - slot.z;
    if (!slot.ready || gx0 < 0 || gx0 >= CHUNK_QUADS || gz0 < 0 || gz0 >= CHUNK_QUADS) {
      const cx = Math.floor(wx / CHUNK_QUADS), cz = Math.floor(wz / CHUNK_QUADS);
      slot = last = slotFor(cx, cz);
      if (slot.cx !== cx || slot.cz !== cz) assign(slot, cx, cz);
      while (!slot.ready) buildRow(slot);
    }
    const gx = wx - slot.x, gz = wz - slot.z;
    const x = Math.min(Math.floor(gx), CHUNK_QUADS - 1), z = Math.min(Math.floor(gz), CHUNK_QUADS - 1);
    const fx = gx - x, fz = gz - z;
    const v = slot.vertices, o = (z * CHUNK_VERTS + x) * VERTEX_SHORTS, next = CHUNK_VERTS * VERTEX_SHORTS;
    const a = v[o] * 0.01, b = v[o + VERTEX_SHORTS] * 0.01;  // cm to m
    const c = v[o + next] * 0.01, d = v[o + next + VERTEX_SHORTS] * 0.01;
    // The triangle's slope: height change per metre along x and along z.
    let slopeX, slopeZ, h;
    if (fx + fz <= 1) {  // triangle a, c, b
      slopeX = b - a; slopeZ = c - a;
      h = a + slopeX * fx + slopeZ * fz;
    } else {             // triangle b, c, d
      slopeX = d - c; slopeZ = d - b;
      h = d - slopeX * (1 - fx) - slopeZ * (1 - fz);
    }
    if (normal) {
      const len = Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ);
      normal[0] = -slopeX / len; normal[1] = 1 / len; normal[2] = -slopeZ / len;
    }
    return h;
  }

  // How far (x, z) is from the road's edge as drawn: frayed (see buildRow), and blended across each
  // grid square's two triangles, as the GPU blends vEdge. Negative on the road. For the puddles
  // (painted only more than 0.8 m in from it), which the tyres splash through.
  function edgeAt(wx, wz) {
    heightAt(wx, wz);  // finds the chunk, building it if need be, and leaves it in `last`
    const slot = last, gx = wx - slot.x, gz = wz - slot.z;
    const x = Math.min(Math.floor(gx), CHUNK_QUADS - 1), z = Math.min(Math.floor(gz), CHUNK_QUADS - 1);
    const fx = gx - x, fz = gz - z;
    const v = slot.vertices, o = (z * CHUNK_VERTS + x) * VERTEX_SHORTS + 1, next = CHUNK_VERTS * VERTEX_SHORTS;
    const a = v[o], b = v[o + VERTEX_SHORTS], c = v[o + next], d = v[o + next + VERTEX_SHORTS];
    return 0.01 * (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d - (d - c) * (1 - fx) - (d - b) * (1 - fz));
  }

  // The nearest point on any road's middle to (x, z), and the heading along the road there
  // (either way), as { x, z, heading }. The same object is reused by the next call to
  // nearestRoad, and only by that: copy it before calling again.
  const near = { x: 0, z: 0, heading: 0 };
  const searchList = createRoadList(20000);  // two cells each way: ~60 roads of ~150 pieces
  function nearestRoad(x, z) {
    // The chunk's own road list has every road within WILD m of it: if one is that close, it's
    // the nearest. (The distance returned can be up to ROAD_ROUNDING / 4 short.) Otherwise
    // search the cells around.
    const cx = Math.floor(x / CHUNK_QUADS), cz = Math.floor(z / CHUNK_QUADS), slot = slotFor(cx, cz);
    let list = slot.roads;
    if (slot.cx !== cx || slot.cz !== cz || slot.rowsBuilt < 0 || !(roadDistance(list, x, z) < WILD - 5)) {
      list = searchList;
      findRoads(list, x - CELL, z - CELL, x + CELL, z + CELL);
      roadDistance(list, x, z);
    }
    // The nearest point on the nearest record, as roadDistance found it.
    const pieces = list.pieces, r = nearestPiece;
    const dx = pieces[r + 2], dz = pieces[r + 3];
    const t = Math.min(Math.max(((x - pieces[r]) * dx + (z - pieces[r + 1]) * dz) * pieces[r + 4], 0), 1);
    near.x = pieces[r] + t * dx;
    near.z = pieces[r + 1] + t * dz;
    near.heading = Math.atan2(dx, dz);
    return near;
  }

  // How far (x, z) is from the nearest road's edge (not frayed): negative on it. Infinity if no road is near, or the chunk there isn't being built: for the
  // dust the car kicks up.
  function roadDistanceAt(x, z) {
    const cx = Math.floor(x / CHUNK_QUADS), cz = Math.floor(z / CHUNK_QUADS), slot = slotFor(cx, cz);
    if (slot.cx !== cx || slot.cz !== cz || slot.rowsBuilt < 0) return Infinity;
    return roadDistance(slot.roads, x, z);
  }

  return { slots, indices, update, heightAt, edgeAt, nearestRoad, roadDistanceAt, slotFor, slotAt, drawList,
           get drawCount() { return drawCount; }, get behind() { return behind; } };
}

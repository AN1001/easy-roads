// Things built of blocks: the bridges (bridges.js), made of boxes laid out along a line on the
// ground (a "frame": a start, a direction and a slope), as triangles in one buffer (built.vert /
// built.frag); and a test for a point inside a box, for the solid parts that stop the car (inBox).
//
// Per vertex, BLOCK_FLOATS floats: position, the face's normal, where it is on its texture (m),
// its colour, and which layer of the texture array it wears (-1: none).
export const BLOCK_FLOATS = 12;

import { WOOD } from './textures.js';

// The same triangles (`data`: `floats` numbers a vertex, three vertices a triangle, a Float32Array),
// with each vertex stored once and the triangles as indices into them: { vertices, indices }
// (16-bit indices while they reach). Vertices alike in every number are the same one. Drawn with
// indices, the GPU shades a vertex the triangles round it share once rather than once for each: a
// tube's sides, a card's corners, the petals' cards' shared corners (drawn without, until 3 Oct
// 2026: up to 6 times over).
export function shareVertices(data, floats) {
  const count = data.length / floats, bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
  const size = 2 ** Math.ceil(Math.log2(2 * count + 2)), table = new Int32Array(size).fill(-1);  // where each is kept: open addressing
  const vertices = new Float32Array(data.length), indices = new Uint32Array(count), kept = new Uint32Array(vertices.buffer);
  let unique = 0;
  for (let v = 0; v < count; v++) {
    const from = v * floats;
    let h = 0;
    for (let f = 0; f < floats; f++) h = Math.imul(h ^ bits[from + f], 0x9e3779b1) ^ h >>> 15;
    for (let at = h & size - 1; ; at = at + 1 & size - 1) {
      const u = table[at];
      if (u < 0) {
        table[at] = unique;
        kept.set(bits.subarray(from, from + floats), unique * floats);
        indices[v] = unique++;
        break;
      }
      let same = true;
      for (let f = 0; f < floats && same; f++) same = kept[u * floats + f] === bits[from + f];
      if (same) { indices[v] = u; break; }
    }
  }
  return { vertices: vertices.slice(0, unique * floats), indices: unique < 65536 ? Uint16Array.from(indices) : indices };
}

// Materials: a colour (multiplied by the texture, which averages 1), a layer, and which way the
// texture's grain (its v) runs: up, along the frame, or across it.
export const UP = 0, ALONG = 1, ACROSS = 2;
export const material = (color, layer, grain = UP) => ({ color, layer, grain });
export const PLANKS = material([0.36, 0.28, 0.20], WOOD, ACROSS);
export const BEAM = material([0.26, 0.20, 0.15], WOOD, ALONG);
export const PILE = material([0.24, 0.19, 0.15], WOOD, UP);
export const RAIL = material([0.38, 0.31, 0.24], WOOD, ALONG);
export const POST = material([0.38, 0.31, 0.24], WOOD, UP);

// Where blocks are laid: each vertex's numbers (BLOCK_FLOATS each) and the triangles as their
// vertices' numbers, in typed arrays grown if need be (`n` floats and `ni` indices of them used): each
// face's four corners once, and its two triangles by them. (Each triangle's corners its own, pushed
// onto an array of numbers, until 3 Oct 2026: ~3.3 ms a bridge in Node, a hitch as each came near.)
export function blockWriter() {
  return { vertices: new Float32Array(1 << 16), n: 0, indices: new Uint32Array(1 << 15), ni: 0 };
}

// Lays blocks into `out` (blockWriter's). `frame(ax, ay, az, dx, dz, grade, start)` sets the
// line they're laid along: from (ax, ay, az), along the unit vector (dx, dz), rising `grade` m per
// m; `start` m along a longer run of frames, so textures carry on from one to the next. It returns
// `block(along0, along1, across0, across1, down, up, mat, topMat = mat, level = false)`: a box from
// `along0` to `along1` m along the line, `across0` to `across1` across it (+ to the right, facing
// along it), and from `down` to `up` m above the line there (its top and bottom slope with it), or,
// with `level`, its bottom `down` m above the world's 0 (a pier's foot).
export function frame(out, ax, ay, az, dx, dz, grade, start = 0) {
  const sx = dz, sz = -dx;  // across, to the right
  return (along0, along1, across0, across1, down, up, mat, topMat = mat, level = false) => {
    // The box's 8 corners (bits 1, 2 and 4 of their number: at along1, across1, up): x, y, z, m along
    // the run, m across it.
    for (let k = 0; k < 8; k++) {
      const along = k & 1 ? along1 : along0, across = k & 2 ? across1 : across0, top = k & 4;
      const o = 5 * k;
      box[o] = ax + along * dx + across * sx;
      box[o + 1] = (top ? up : down) + (level && !top ? 0 : ay + grade * along);
      box[o + 2] = az + along * dz + across * sz;
      box[o + 3] = start + along; box[o + 4] = across;
    }
    const middleA = (along0 + along1) / 2, middleB = (across0 + across1) / 2;
    centre[0] = ax + middleA * dx + middleB * sx; centre[1] = (box[1] + box[36]) / 2; centre[2] = az + middleA * dz + middleB * sz;
    face(out, 0, topMat, 4, 6, 7, 5);  // top
    face(out, 0, mat, 0, 1, 3, 2);     // bottom
    face(out, 2, mat, 0, 2, 6, 4);     // start
    face(out, 2, mat, 1, 3, 7, 5);     // end
    face(out, 1, mat, 0, 1, 5, 4);     // one side
    face(out, 1, mat, 2, 3, 7, 6);     // the other
  };
}
const box = new Float64Array(40), centre = new Float64Array(3), order = new Int32Array(4);

// A face of the box (its corners' numbers, in order round it), turned to face out of the block
// (anticlockwise seen from outside, as the GPU takes the front of a triangle to be). `side`: 0 top or
// bottom, 1 a long side (along the line), 2 an end (across it); for which way its texture runs.
function face(out, side, m, k0, k1, k2, k3) {
  const q0 = 5 * k0, q1 = 5 * k1, q2 = 5 * k2, q3 = 5 * k3;
  const ux = box[q1] - box[q0], uy = box[q1 + 1] - box[q0 + 1], uz = box[q1 + 2] - box[q0 + 2];
  const vx = box[q3] - box[q0], vy = box[q3 + 1] - box[q0 + 1], vz = box[q3 + 2] - box[q0 + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const n = Math.hypot(nx, ny, nz); nx /= n; ny /= n; nz /= n;
  order[0] = q0; order[1] = q1; order[2] = q2; order[3] = q3;
  if (nx * (box[q0] + box[q2] - 2 * centre[0]) + ny * (box[q0 + 1] + box[q2 + 1] - 2 * centre[1]) + nz * (box[q0 + 2] + box[q2 + 2] - 2 * centre[2]) < 0) {
    order[1] = q3; order[3] = q1; nx = -nx; ny = -ny; nz = -nz;
  }
  if (out.n + 4 * BLOCK_FLOATS > out.vertices.length) { const bigger = new Float32Array(2 * out.vertices.length); bigger.set(out.vertices); out.vertices = bigger; }
  if (out.ni + 6 > out.indices.length) { const bigger = new Uint32Array(2 * out.indices.length); bigger.set(out.indices); out.indices = bigger; }
  const d = out.vertices, first = out.n / BLOCK_FLOATS;
  for (let k = 0; k < 4; k++) {
    const o = order[k], x = box[o], y = box[o + 1], z = box[o + 2], along = box[o + 3], across = box[o + 4];
    // u across the grain, v along it.
    const u = side === 0 ? (m.grain === ALONG ? across : along) : side === 1 ? (m.grain === ALONG ? y : along) : (m.grain === ACROSS ? y : across);
    const v = side === 0 ? (m.grain === ALONG ? along : across) : side === 1 ? (m.grain === ALONG ? along : y) : (m.grain === ACROSS ? across : y);
    const i = out.n;
    d[i] = x; d[i + 1] = y; d[i + 2] = z; d[i + 3] = nx; d[i + 4] = ny; d[i + 5] = nz;
    d[i + 6] = u; d[i + 7] = v; d[i + 8] = m.color[0]; d[i + 9] = m.color[1]; d[i + 10] = m.color[2]; d[i + 11] = m.layer;
    out.n = i + BLOCK_FLOATS;
  }
  const t = out.indices, j = out.ni;
  t[j] = first; t[j + 1] = first + 1; t[j + 2] = first + 2; t[j + 3] = first; t[j + 4] = first + 2; t[j + 5] = first + 3;
  out.ni = j + 6;
}

// For a run of straight pieces (corners: x, y, z, ... along a road), call `piece(block, length,
// start, p, ax, az, dx, dz)` for each, with its frame's block function; returns the run's length.
export function alongCorners(out, c, piece) {
  let start = 0;
  for (let p = 0, i = 0; i + 3 < c.length; p++, i += 3) {
    const ax = c[i], ay = c[i + 1], az = c[i + 2];
    const length = Math.hypot(c[i + 3] - ax, c[i + 5] - az), dx = (c[i + 3] - ax) / length, dz = (c[i + 5] - az) / length;
    piece(frame(out, ax, ay, az, dx, dz, (c[i + 4] - ay) / length, start), length, start, p, ax, az, dx, dz);
    start += length;
  }
  return start;
}

// The length of a run of corners.
export function runLength(c) {
  let total = 0;
  for (let i = 0; i + 3 < c.length; i += 3) total += Math.hypot(c[i + 3] - c[i], c[i + 5] - c[i + 2]);
  return total;
}

// A point (x, y, z) inside a box, standing on the line from (ax, ay, az) along (dx, dz) rising
// `grade`, from `along0` to `along1` along it, `across0` to `across1` across, `down` to `up` above
// it: how deep it is (to its nearest side, not the top or bottom), and the way out into `normal`;
// else 0. Each side can be left out (`open`: bits 1 start, 2 end, 4 left, 8 right), as where a
// wall carries straight on into the next piece's.
export function inBox(x, y, z, ax, ay, az, dx, dz, grade, along0, along1, across0, across1, down, up, normal, open = 0) {
  const px = x - ax, pz = z - az, along = px * dx + pz * dz, across = px * dz - pz * dx;
  if (along < along0 || along > along1 || across < across0 || across > across1) return 0;
  const base = ay + grade * along;
  if (y < base + down || y > base + up) return 0;
  let depth = Infinity;
  if (!(open & 1) && along - along0 < depth) { depth = along - along0; normal[0] = -dx; normal[2] = -dz; }
  if (!(open & 2) && along1 - along < depth) { depth = along1 - along; normal[0] = dx; normal[2] = dz; }
  if (!(open & 4) && across - across0 < depth) { depth = across - across0; normal[0] = -dz; normal[2] = dx; }
  if (!(open & 8) && across1 - across < depth) { depth = across1 - across; normal[0] = dz; normal[2] = -dx; }
  normal[1] = 0;
  return depth === Infinity ? 0 : depth;
}

// Things built of blocks: the bridges (bridges.js), made of boxes laid out along a line on the
// ground (a "frame": a start, a direction and a slope), as triangles in one buffer (built.vert /
// built.frag); and a test for a point inside a box, for the solid parts that stop the car (inBox).
//
// Per vertex, BLOCK_FLOATS floats: position, the face's normal, where it is on its texture (m),
// its colour, and which layer of the texture array it wears (-1: none).
export const BLOCK_FLOATS = 12;

import { WOOD } from './textures.js';

// Materials: a colour (multiplied by the texture, which averages 1), a layer, and which way the
// texture's grain (its v) runs: up, along the frame, or across it.
export const UP = 0, ALONG = 1, ACROSS = 2;
export const material = (color, layer, grain = UP) => ({ color, layer, grain });
export const PLANKS = material([0.36, 0.28, 0.20], WOOD, ACROSS);
export const BEAM = material([0.26, 0.20, 0.15], WOOD, ALONG);
export const PILE = material([0.24, 0.19, 0.15], WOOD, UP);
export const RAIL = material([0.38, 0.31, 0.24], WOOD, ALONG);
export const POST = material([0.38, 0.31, 0.24], WOOD, UP);

// Lays blocks into `out` (an array of numbers). `frame(ax, ay, az, dx, dz, grade, start)` sets the
// line they're laid along: from (ax, ay, az), along the unit vector (dx, dz), rising `grade` m per
// m; `start` m along a longer run of frames, so textures carry on from one to the next. It returns
// `block(along0, along1, across0, across1, down, up, mat, topMat = mat, level = false)`: a box from
// `along0` to `along1` m along the line, `across0` to `across1` across it (+ to the right, facing
// along it), and from `down` to `up` m above the line there (its top and bottom slope with it), or,
// with `level`, its bottom `down` m above the world's 0 (a pier's foot).
export function frame(out, ax, ay, az, dx, dz, grade, start = 0) {
  const sx = dz, sz = -dx;  // across, to the right
  return (along0, along1, across0, across1, down, up, mat, topMat = mat, level = false) => {
    const corner = (ia, ib, ic) => {
      const along = ia ? along1 : along0, across = ib ? across1 : across0;
      const y = (ic ? up : down) + (level && !ic ? 0 : ay + grade * along);
      return [ax + along * dx + across * sx, y, az + along * dz + across * sz, start + along, across];
    };
    const middleA = (along0 + along1) / 2, middleB = (across0 + across1) / 2;
    const centre = [ax + middleA * dx + middleB * sx, (corner(0, 0, 0)[1] + corner(1, 1, 1)[1]) / 2, az + middleA * dz + middleB * sz];
    // A face: its corners in order round it, turned to face out of the block (anticlockwise seen
    // from outside, as the GPU takes the front of a triangle to be). `side`: 0 top or bottom, 1 a
    // long side (along the line), 2 an end (across it); for which way its texture runs.
    const face = (side, m, q0, q1, q2, q3) => {
      let q = [q0, q1, q2, q3];
      const ux = q1[0] - q0[0], uy = q1[1] - q0[1], uz = q1[2] - q0[2], vx = q3[0] - q0[0], vy = q3[1] - q0[1], vz = q3[2] - q0[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const n = Math.hypot(nx, ny, nz); nx /= n; ny /= n; nz /= n;
      if (nx * (q0[0] + q2[0] - 2 * centre[0]) + ny * (q0[1] + q2[1] - 2 * centre[1]) + nz * (q0[2] + q2[2] - 2 * centre[2]) < 0) {
        q = [q0, q3, q2, q1]; nx = -nx; ny = -ny; nz = -nz;
      }
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, along, across] = q[k];
        // u across the grain, v along it.
        let u, v;
        if (side === 0) [u, v] = m.grain === ALONG ? [across, along] : [along, across];
        else if (side === 1) [u, v] = m.grain === ALONG ? [y, along] : [along, y];
        else [u, v] = m.grain === ACROSS ? [y, across] : [across, y];
        out.push(x, y, z, nx, ny, nz, u, v, m.color[0], m.color[1], m.color[2], m.layer);
      }
    };
    face(0, topMat, corner(0, 0, 1), corner(0, 1, 1), corner(1, 1, 1), corner(1, 0, 1));  // top
    face(0, mat, corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0));     // bottom
    face(2, mat, corner(0, 0, 0), corner(0, 1, 0), corner(0, 1, 1), corner(0, 0, 1));     // start
    face(2, mat, corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1), corner(1, 0, 1));     // end
    face(1, mat, corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1));     // one side
    face(1, mat, corner(0, 1, 0), corner(1, 1, 0), corner(1, 1, 1), corner(0, 1, 1));     // the other
  };
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

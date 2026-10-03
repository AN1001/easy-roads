// The bridges terrain.js finds where roads cross rivers: their models, made of blocks (blocks.js),
// and their railings, which stop the car (bridgeWall). Each bridge is a run of straight pieces
// along the road (its corners: terrain.js); every piece gets its own blocks, and the wood's texture
// (textures.js) runs on from one piece to the next.
//
// Timber, weathered: a deck of planks laid across it on two beams; a railing each side, posts every
// POST_SPACING m with a top rail and a middle one; taller posts at the ends (their caps taken off,
// 2 Oct 2026); and bents of
// two piles and a cross-beam down into the river every BENT_SPACING m.

import { alongCorners, runLength, inBox, PLANKS, BEAM, PILE, RAIL, POST } from './blocks.js';

// What stops the car: each side, a railing from RAIL_INSET m inside the deck's edge to the edge,
// RAIL_HEIGHT m above the deck. (Must match the model below.)
const RAIL_INSET = 0.2, RAIL_HEIGHT = 1.05;

const BENT_SPACING = 7, POST_SPACING = 2;  // m along the bridge
const JOINT = 0.3;     // m: how far each piece's deck and railings run on past its joints
const PIER_BELOW = 4;  // m below the water at the river's middle: the piles go this deep
const BRIDGE_SINK_BELOW = 0.3;  // m: the end posts reach this far below the deck (into the ground, where it sinks: terrain.js)

// Lays the blocks for all of `bridges` into `out` (blocks.js).
export function bridgeBlocks(bridges, out) {
  for (const b of bridges) {
    const c = b.corners, pieces = c.length / 3 - 1, half = b.half, total = runLength(c);
    const bottom = b.water - PIER_BELOW;
    alongCorners(out, c, (block, length, start, p, ax, az, dx, dz) => {
      const first = p === 0, last = p === pieces - 1;
      // The deck and railings run on a little past the joints, closing the wedge between pieces on a bend.
      const a0 = first ? 0 : -JOINT, a1 = last ? length : length + JOINT;
      // Something every `spacing` m along the whole bridge (not within `margin` of its ends) that
      // falls on this piece: `make(along)`.
      const every = (spacing, margin, make) => {
        for (let s = Math.ceil(start / spacing) * spacing; s < start + length; s += spacing) {
          if (s > margin && s < total - margin) make(s - start);
        }
      };
      // The river's middle, if the bridge crosses it on this piece.
      const middle = (b.cx - ax) * dx + (b.cz - az) * dz;
      const onThis = b.crosses && middle >= 0 && middle < length && Math.abs((b.cx - ax) * dz - (b.cz - az) * dx) < 1;

      block(a0, a1, -half, half, -0.25, 0, PLANKS);
      for (const side of [-1, 1]) {
        const at = side * (half - 0.8);
        block(a0, a1, at - 0.15, at + 0.15, -0.75, -0.25, BEAM);
        const [ri, ro] = side > 0 ? [half - RAIL_INSET, half] : [-half, -half + RAIL_INSET];
        block(a0, a1, ri, ro, 0.9, RAIL_HEIGHT, RAIL);
        block(a0, a1, ri + 0.04, ro - 0.04, 0.45, 0.55, RAIL);
        every(POST_SPACING, 0.5, s => block(s - 0.09, s + 0.09, ri + 0.01, ro - 0.01, 0, 0.9, POST));
        // Taller posts at the ends.
        const [ei, eo] = side > 0 ? [half - 0.3, half] : [-half, -half + 0.3];
        const endPost = (e0, e1) => block(e0, e1, ei, eo, -BRIDGE_SINK_BELOW, 1.3, POST);
        if (first) endPost(0, 0.3);
        if (last) endPost(length - 0.3, length);
      }
      // Bents: two piles and a cross-beam.
      const bent = at => {
        block(at - 0.2, at + 0.2, -half + 0.3, half - 0.3, -1.05, -0.75, BEAM);
        for (const side of [-1, 1]) {
          const x = side * (half - 0.8);
          block(at - 0.15, at + 0.15, x - 0.15, x + 0.15, bottom, -1.05, PILE, PILE, true);
        }
      };
      every(BENT_SPACING, 3, bent);
      if (onThis) bent(middle);
    });
  }
}

// How far the point (x, y, z) is inside a bridge's railing: 0 if it isn't. If it is, the way out
// of it (the nearest face: into the bridge, out over its side, or past an end) into `normal`. For
// the car's body (car.js).
export function bridgeWall(bridges, x, y, z, normal) {
  let best = 0;
  for (let k = 0; k < bridges.length; k++) {
    const b = bridges[k];
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const c = b.corners, inner = b.half - RAIL_INSET;
    for (let i = 0; i + 3 < c.length; i += 3) {
      const dx = c[i + 3] - c[i], dz = c[i + 5] - c[i + 2], length = Math.sqrt(dx * dx + dz * dz);
      // The railings carry on into the next piece's: only the bridge's ends are open to hit.
      const open = (i === 0 ? 0 : 1) | (i + 6 >= c.length ? 0 : 2);
      for (let side = -1; side <= 1; side += 2) {
        const depth = inBox(x, y, z, c[i], c[i + 1], c[i + 2], dx / length, dz / length, (c[i + 4] - c[i + 1]) / length,
          0, length, side > 0 ? inner : -b.half, side > 0 ? b.half : -inner, -1, RAIL_HEIGHT, scratch, open);
        if (depth > best) { best = depth; normal[0] = scratch[0]; normal[1] = 0; normal[2] = scratch[2]; }
      }
    }
  }
  return best;
}
const scratch = new Float64Array(3);

// The bamboo: its models; each frame, which stalks and clumps to draw; and how the car bends them.
//
// Not instanced: on this GPU (through Chrome and Metal) an instanced draw measured ~0.16 µs per
// instance whatever its size (a 3-vertex line cost nearly what a 35-vertex tube did). So the
// shaders pull each stalk's numbers from a texture (main.js), and each frame's bamboo is a few
// draws: every vertex number is an entry of this frame's list × the model's stride + the vertex's
// number within the model, which bamboo.glsl turns back into the stalk and the shape. After that,
// the cost is the vertices: ~7 ns each here, whatever the shader (the land's cost the same), so the
// models have as few as they can.
//
// Three levels of detail. Near (within NEAR_FROM-NEAR_BY m), the stalk is a 5-sided tube in 2
// segments (vertices 0-17: 3 rings of 6, the first corner again to wrap the texture) and its leaves 3
// cards crossed at 60°, each 2 quads up, to curve as it sways (0-17, 6 a card). Further, where a
// stalk is about a pixel across, it's a line (2 vertices: GL_LINES are always exactly a pixel wide,
// where a thinner tube would flicker in and out between pixels, drawn without indices) and its
// leaves one card turned to face the camera (0-3). Past PICTURES_FROM-PICTURES_BY m, to the mist's
// end, the stalks give way to clumps (terrain.js plants one for every CLUMP m square where bamboo
// grows): each one card, facing the camera, with a picture of a clump of stalks and leaves
// (textures.js), 4 vertices for the ~10 stalks it stands for. The rest are drawn with indices, which this file makes: each model's
// triangles, repeated for as many stalks as 16-bit vertex numbers reach (or MAX_BATCH).
//
// The cedar plantations' trees (terrain.js) are drawn as stalks too, with the same models: their
// trunks as the tubes and lines, their crowns as the cards, and stands of them far off as the clumps;
// the shaders tell them apart (bamboo.glsl). But the car can't push them aside: it bumps into their
// trunks (cedarWall), as it does a cherry's. And a cedar's trunk, ~40 cm across, is still ~5 pixels
// at 30 m, where a stalk's tube gives way to its pixel-wide line: so they keep their tubes and crossed
// cards out to CEDAR_NEAR_FROM-CEDAR_NEAR_BY m (~2 pixels).

import { boxInFrustum } from './math.js';
import { CHUNK_QUADS, MAX_STALKS, STALK_FLOATS, CLUMP, CLUMP_FLOATS, CEDAR_STRIP } from './terrain.js';

export const SIDES = 5, SEGMENTS = 2, CARD_ROWS = 2;  // must match stalk.vert and leaves.vert
const RING = SIDES + 1;
const MAX_BATCH = 4096;  // stalks

// Each model: how to draw it, its vertices per stalk (stride), and for those with indices, where
// they start (bytes), how many a stalk, and for how many stalks at most at once (batch). A clump is
// drawn with the billboard's.
export function createBambooModel() {
  const tube = [], cards = [], billboard = [0, 1, 2, 1, 3, 2];
  for (let ring = 0; ring < SEGMENTS; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const a = ring * RING + side, b = a + 1, c = a + RING, d = c + 1;
      tube.push(a, c, b, b, c, d);  // facing out
    }
  }
  for (let card = 0; card < 3; card++) {
    for (let row = 0; row < CARD_ROWS; row++) {
      const a = card * 2 * (CARD_ROWS + 1) + 2 * row, b = a + 1, c = a + 2, d = a + 3;  // left, right; up a row
      cards.push(a, b, c, b, d, c);
    }
  }
  const indices = [];
  const indexed = (pattern, stride) => {
    const batch = Math.min(Math.floor(65536 / stride), MAX_BATCH);
    const model = { mode: 'TRIANGLES', stride, offset: 2 * indices.length, count: pattern.length, batch };
    for (let stalk = 0; stalk < model.batch; stalk++) for (const k of pattern) indices.push(stalk * stride + k);
    return model;
  };
  return {
    tube: indexed(tube, RING * (SEGMENTS + 1)),
    cards: indexed(cards, 3 * 2 * (CARD_ROWS + 1)),
    billboard: indexed(billboard, 4),
    line: { mode: 'LINES', stride: 2 },
    indices: new Uint16Array(indices),
  };
}

// This frame's list, for the GPU: an integer texture LIST_WIDTH entries wide (must match
// bamboo.glsl), a 32-bit number each. Its low 20 bits say which stalk or clump: for a stalk, its first
// texel in the stalks' texture; for a clump, its chunk slot, which is its row of the clumps' texture,
// × 1024, + its number in the chunk. BENT marks a stalk the car has bent; and the top 8 bits are how
// much of the stalk or clump is there, 0-255 (all of it): the rest has dissolved (bamboo.glsl). How
// far a bent one is bent, along x and z, as two signed 12-bit fractions (× 2047), is at the same entry
// of `listBends`, for a texture the same shape, of which only what's needed is uploaded: none, mostly. (Two
// numbers an entry until 3 Oct 2026, the bend in every one: twice the bytes uploaded each frame,
// ~74-97 KB.) Near stalks first, then far ones, then clumps, each nearest chunk first, so nearer ones
// hide what's behind. The near ones have the first NEAR_ROOM entries to themselves (~200-400 used):
// the far ones start after, so they can be written straight into place.
export const LIST_WIDTH = 1024, LIST_ROWS = 32;  // 32,768 entries: ~12,000 used, with the near ones' room
const NEAR_ROOM = 2048, BENT = 1 << 20;
// The stalks' texture: STALK_WIDTH texels wide (must match bamboo.glsl), 2 texels a stalk, each
// slot's one after another (stalkBase): a level-0 chunk's in half a row, a level-1 chunk's in two.
export const STALK_WIDTH = 1600;

// Distances from the camera, along the ground. Tubes and crossed cards within NEAR_FROM-NEAR_BY m,
// each stalk at its own distance (a stalk 12 cm across is under 1.8 pixels beyond 30 m, at 360
// rows), the one dissolving into the other. Lines and single cards ("strands") beyond, which look
// the same from there: the card a picture of the crossed ones from the side (textures.js). Then clumps:
// each CLUMP m square of the ground (terrain.js) swaps all its stalks for its clump at once, at its
// own distance (PICTURES_FROM-PICTURES_BY m, from its middle), the one dissolving into the other over
// FADE m: never both, never neither, and so far off that the mist hides three quarters of it
// (sky.glsl), so what changes can hardly be seen. The first two levels' chunks plant the stalks
// (terrain.js), and level 1's are drawn to at least 220 m (DETAIL[1] in main.js): PICTURES_BY +
// FADE / 2 must be within that. (On 29 Sep 2026 the swap was at 70-90 m, where the mist is only half;
// before that each stalk and each clump swapped at its own distance, at 60-80 m or, briefly, 40-55,
// so a square could show both or nothing: trees came and went.)
const NEAR_FROM = 26, NEAR_BY = 34, NEAR_FADE = 4;  // m: the near and far models dissolve into each other over NEAR_FADE
const CEDAR_NEAR_FROM = 60, CEDAR_NEAR_BY = 75;     // m
const PICTURES_FROM = 180, PICTURES_BY = 200;  // m
const FADE = 20;                               // m
const STALKS_TO = PICTURES_BY + FADE / 2, CLUMPS_FROM = PICTURES_FROM - FADE / 2;
// Where the land's chunks come late, a coarser one stands in: for level 1's, a level-2 chunk, with
// only clumps. When a level-1 chunk is first drawn in its place, its squares dissolve from clumps
// into stalks over APPEAR s, rather than trees springing up. (Not in place of its own children, or
// they in place of it: they draw the same stalks.)
const APPEAR = 0.6;  // s
// For culling: how far the bamboo reaches past its chunk's box: up, and sideways (leaning, swaying,
// its leaves); for a stalk, the most a stalk h m tall leans, sways or spreads its leaves, each way.
// (A chunk's box was widened by 4 m until 29 Sep 2026, too little for the tallest: ~3 stalks in a
// view whose tops reached in at its sides were left out.)
const TALLEST = 28.5;  // m: a cedar (the tallest bamboo, 15.5)
const stalkReach = h => 0.5 + 0.5 * h;
const LEAN = stalkReach(TALLEST);
const CLUMP_REACH = 3.5;  // m: half a clump's width (clump.vert's WIDTH), and its sway

// The car bends stalks aside: those nearer than CAR_REACH m to the line from its tail lights to its
// headlight, and not more than CAR_ABOVE m above or below them, lean away far enough to clear its
// roof, CAR_HEIGHT m up. Once it's past, they spring back up, slowly: each is a damped spring,
// SPRING radians a second, DAMPING of the way to not overshooting at all: half way up in 1 s, 90%
// in 2.1 s, overshooting by 0.5%. (Pushed aside, they used to stand again the moment it passed.)
const CAR_REACH = 1.5, CAR_HEIGHT = 1.4, CAR_ABOVE = 2.5;  // m
const SPRING = 1.5, DAMPING = 0.85;
const MAX_MOVING = 4096;  // stalks bent or springing back at once, at most

// What stops the car (cedarWall): a cedar's trunk, up to WALL_HEIGHT m, at least WALL_RADIUS round
// (as trees.js's, for the same reason: the car's wall points are up to 0.7 m apart).
const WALL_HEIGHT = 2, WALL_RADIUS = 0.36;  // m
const MAX_NEAR_CEDARS = 256;

// A random number, 0 to 1, for a square of the ground.
function squareRandom(x, z) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

// `far`: m, the mist's end, past which nothing shows.
export function createBamboo(terrain, far) {
  const slots = terrain.slots;
  const level0 = slots.filter(slot => slot.level === 0).length;  // level 0's slots, which come first
  const list = new Uint32Array(LIST_WIDTH * LIST_ROWS), listBends = new Uint32Array(LIST_WIDTH * LIST_ROWS);
  const capacity = LIST_WIDTH * LIST_ROWS;
  let nearCount = 0, farCount = 0, clumpCount = 0;
  // This frame's bent entries: how many near ones, and the first and last far one (-1: none).
  let nearBent = 0, firstBent = -1, lastBent = -1;

  // Per slot that plants stalks: where its stalks start in their texture (texels, for main.js), and
  // its squares in swapAt and shares.
  const stalkBase = new Int32Array(slots.length).fill(-1), squareBase = new Int32Array(slots.length).fill(-1);
  let texels = 0, squareCount = 0;
  for (const slot of slots) {
    if (!slot.stalks) continue;
    stalkBase[slot.index] = texels;
    texels += 2 * slot.stalks.length / STALK_FLOATS;
    squareBase[slot.index] = squareCount;
    squareCount += (slot.size / CLUMP) ** 2;
  }

  // Per level-0 stalk (a row per level-0 slot, MAX_STALKS each): its bend along x and z (added to
  // its lean, as the sine of the angle each way) and how fast that's changing. Only those moving are
  // visited. (Level 1's are never near the car.)
  const bends = new Float32Array(level0 * MAX_STALKS * 4);
  const moving = new Int32Array(MAX_MOVING), isMoving = new Uint8Array(level0 * MAX_STALKS);
  const movingIn = new Int32Array(level0);  // per level-0 slot: how many of its stalks are moving
  let movingCount = 0;
  // This frame's: how far the car pushed stalks aside, all told (radians), and how many it reached
  // that were standing still (for the rustle and knocks in sound.js).
  let pushed = 0, struck = 0;

  // Per square: where it swaps its stalks for its clump (m), set as it's planted; and this frame's
  // share (see share). Per slot: those shares' sum and the frame it's for; the last frame the land
  // was drawn from it, and when it was first drawn this time (s).
  const swapAt = new Float32Array(squareCount), shares = new Uint8Array(squareCount);
  const shareSums = new Int32Array(slots.length), sharedIn = new Int32Array(slots.length).fill(-1);
  const drawnIn = new Int32Array(slots.length).fill(-2), shownAt = new Float64Array(slots.length);
  let frame = 0;
  // Per slot that plants stalks: how many of them are cedars (replant).
  const cedarsIn = new Int32Array(slots.length);
  // The cedars near the car, found once a frame (cedarsNear): x, z and trunk radius each, and their foot's height.
  const nearCedars = new Float64Array(4 * MAX_NEAR_CEDARS);
  let nearCedarCount = 0;

  // Bend, and let spring back, the stalks round the car. `tail` and `lamp`: xyz of its tail lights
  // and headlight (the Frame block's); `dt`: s since the last frame.
  function bend(tail, lamp, dt) {
    const stiff = SPRING * SPRING, damp = 2 * DAMPING * SPRING;
    pushed = 0; struck = 0;
    for (let m = 0; m < movingCount; m++) {
      const s = moving[m], o = 4 * s;
      let bx = bends[o], bz = bends[o + 1], vx = bends[o + 2], vz = bends[o + 3];
      vx -= (stiff * bx + damp * vx) * dt; vz -= (stiff * bz + damp * vz) * dt;
      bx += vx * dt; bz += vz * dt;
      if (bx * bx + bz * bz < 1e-6 && vx * vx + vz * vz < 1e-6) {  // standing again
        bends[o] = bends[o + 1] = bends[o + 2] = bends[o + 3] = 0;
        isMoving[s] = 0;
        movingIn[Math.floor(s / MAX_STALKS)]--;
        moving[m--] = moving[--movingCount];
        continue;
      }
      bends[o] = bx; bends[o + 1] = bz; bends[o + 2] = vx; bends[o + 3] = vz;
    }
    const ax = tail[0], az = tail[2], ex = lamp[0] - ax, ez = lamp[2] - az, length2 = ex * ex + ez * ez;
    const minX = Math.min(ax, lamp[0]) - CAR_REACH, maxX = Math.max(ax, lamp[0]) + CAR_REACH;
    const minZ = Math.min(az, lamp[2]) - CAR_REACH, maxZ = Math.max(az, lamp[2]) + CAR_REACH;
    for (let cz = Math.floor(minZ / CHUNK_QUADS); cz <= Math.floor(maxZ / CHUNK_QUADS); cz++) {
      for (let cx = Math.floor(minX / CHUNK_QUADS); cx <= Math.floor(maxX / CHUNK_QUADS); cx++) {
        const slot = terrain.slotFor(cx, cz);
        if (slot.cx !== cx || slot.cz !== cz || !slot.ready) continue;
        const stalks = slot.stalks, row = slot.index * MAX_STALKS;
        for (let i = 0; i < slot.stalkCount; i++) {
          const f = i * STALK_FLOATS, x = stalks[f], z = stalks[f + 2];
          if (stalks[f + 5] >= CEDAR_STRIP) continue;  // it stands firm (cedarWall)
          if (x < minX || x > maxX || z < minZ || z > maxZ || Math.abs(stalks[f + 1] - tail[1]) >= CAR_ABOVE) continue;
          // Away from the nearest point of the car's line.
          const t = Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / length2, 0), 1);
          let awayX = x - ax - t * ex, awayZ = z - az - t * ez;
          const gap = Math.sqrt(awayX * awayX + awayZ * awayZ);
          if (gap >= CAR_REACH) continue;
          const s = row + i, o = 4 * s;
          if (!isMoving[s]) {
            if (movingCount === MAX_MOVING) continue;
            isMoving[s] = 1;
            movingIn[slot.index]++;
            moving[movingCount++] = s;
            struck++;
          }
          if (gap > 1e-3) { awayX /= gap; awayZ /= gap; } else { awayX = 1; awayZ = 0; }
          // Leaning away at least this much, and not still moving back towards the car.
          const need = (CAR_REACH - gap) / CAR_HEIGHT, along = bends[o] * awayX + bends[o + 1] * awayZ;
          if (along < need) {
            pushed += need - along;
            bends[o] += awayX * (need - along); bends[o + 1] += awayZ * (need - along);
            const speed = bends[o + 2] * awayX + bends[o + 3] * awayZ;
            if (speed < 0) { bends[o + 2] -= awayX * speed; bends[o + 3] -= awayZ * speed; }
          }
        }
      }
    }
  }

  // A new chunk in a slot that plants stalks: its stalks are new, and stand straight; its squares
  // swap at their own distances (the same, whichever level); and when it's first drawn, it's new.
  function replant(row) {
    const slot = slots[row], across = slot.size / CLUMP, o = squareBase[row];
    if (slot.level === 0) bends.fill(0, 4 * row * MAX_STALKS, 4 * (row + 1) * MAX_STALKS);  // those moving stop next frame
    for (let q = 0; q < across * across; q++) {
      const random = squareRandom(slot.cx * across + q % across, slot.cz * across + Math.floor(q / across));
      swapAt[o + q] = PICTURES_FROM + (PICTURES_BY - PICTURES_FROM) * random;
    }
    drawnIn[row] = -2;
    let cedars = 0;
    for (let i = 0; i < slot.stalkCount; i++) if (slot.stalks[i * STALK_FLOATS + 5] >= CEDAR_STRIP) cedars++;
    cedarsIn[row] = cedars;
  }

  // The cedars within `reach` m (along x and along z) of (x, z), kept for cedarWall: once a frame,
  // round the car, as main.js does the trees.
  function cedarsNear(x, z, reach) {
    nearCedarCount = 0;
    for (let cz = Math.floor((z - reach) / CHUNK_QUADS); cz <= Math.floor((z + reach) / CHUNK_QUADS); cz++) {
      for (let cx = Math.floor((x - reach) / CHUNK_QUADS); cx <= Math.floor((x + reach) / CHUNK_QUADS); cx++) {
        const slot = terrain.slotFor(cx, cz);
        if (slot.cx !== cx || slot.cz !== cz || !slot.ready || !cedarsIn[slot.index]) continue;
        const stalks = slot.stalks;
        for (let i = 0; i < slot.stalkCount && nearCedarCount < MAX_NEAR_CEDARS; i++) {
          const f = i * STALK_FLOATS;
          if (stalks[f + 5] < CEDAR_STRIP || Math.abs(stalks[f] - x) > reach || Math.abs(stalks[f + 2] - z) > reach) continue;
          const o = 4 * nearCedarCount++;
          nearCedars[o] = stalks[f]; nearCedars[o + 1] = stalks[f + 2];
          nearCedars[o + 2] = Math.max(WALL_RADIUS, stalks[f + 4]); nearCedars[o + 3] = stalks[f + 1];
        }
      }
    }
  }

  // How far the point (x, y, z) is inside a cedar's trunk (of those cedarsNear found): 0 if it isn't;
  // if it is, the way out of it (straight out from the trunk's middle) into `normal`. For the car's
  // body (car.js), as trees.js's treeWall.
  function cedarWall(x, y, z, normal) {
    let best = 0;
    for (let k = 0; k < nearCedarCount; k++) {
      const o = 4 * k, dx = x - nearCedars[o], dz = z - nearCedars[o + 1], radius = nearCedars[o + 2], foot = nearCedars[o + 3];
      if (Math.abs(dx) > radius || Math.abs(dz) > radius || y < foot - 1 || y > foot + WALL_HEIGHT) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= radius || radius - d <= best) continue;
      best = radius - d;
      normal[0] = d > 1e-6 ? dx / d : 1; normal[1] = 0; normal[2] = d > 1e-6 ? dz / d : 0;
    }
    return best;
  }

  // Whether a chunk just drawn stands where only clumps were drawn: a level-1 chunk in place of its
  // parent, not of its children.
  function appears(slot) {
    if (slot.level !== 1) return false;
    for (let k = 0; k < 4; k++) {
      const cx = 2 * slot.cx + (k & 1), cz = 2 * slot.cz + (k >> 1), child = terrain.slotAt(0, cx, cz);
      if (child.cx === cx && child.cz === cz && drawnIn[child.index] === frame - 1) return false;
    }
    return true;
  }

  // How much of each square of a chunk that plants stalks is its stalks, from (camX, camZ) at `time`,
  // into its squares of `shares`: 0-255, the rest its clump. Returns their sum: 0, all clumps, to 255
  // × its squares. Once a frame for each chunk: the stalks and the clumps both ask.
  function share(slot, camX, camZ, time) {
    const i = slot.index, o = squareBase[i], size = slot.size, across = size / CLUMP, squares = across * across;
    if (sharedIn[i] === frame) return shareSums[i];
    sharedIn[i] = frame;
    const appear = Math.min((time - shownAt[i]) / APPEAR, 1);
    const gapX = Math.max(slot.x - camX, 0, camX - slot.x - size), gapZ = Math.max(slot.z - camZ, 0, camZ - slot.z - size);
    const farX = Math.max(Math.abs(slot.x - camX), Math.abs(slot.x + size - camX));
    const farZ = Math.max(Math.abs(slot.z - camZ), Math.abs(slot.z + size - camZ));
    let sum = 0;
    if (gapX * gapX + gapZ * gapZ >= STALKS_TO * STALKS_TO) {
      shares.fill(0, o, o + squares);  // all of it past every square's swap
    } else if (appear === 1 && farX * farX + farZ * farZ <= CLUMPS_FROM * CLUMPS_FROM) {
      shares.fill(255, o, o + squares);  // all of it before
      sum = 255 * squares;
    } else {
      const whole = Math.round(255 * appear);
      for (let q = 0, row = 0, column = 0; q < squares; q++, column = column === across - 1 ? (row++, 0) : column + 1) {
        const dx = slot.x + (column + 0.5) * CLUMP - camX, dz = slot.z + (row + 0.5) * CLUMP - camZ;
        const d2 = dx * dx + dz * dz, from = swapAt[o + q] - FADE / 2, to = from + FADE;  // all stalks, to all clump
        sum += shares[o + q] = d2 <= from * from ? whole : d2 >= to * to ? 0 : Math.round(255 * appear * (to - Math.sqrt(d2)) / FADE);
      }
    }
    return shareSums[i] = sum;
  }

  // Of the camera's left, right and near planes (`planes`, as frustumPlanes gives them: 0, 1 and 4;
  // the top and bottom ones rarely cut off anything as tall as a stalk), those in `mask` (bits 1, 2
  // and 4): -1 if the box is entirely outside one of them; else those it reaches across (isn't
  // entirely inside), as bits. A box inside another needs testing only against the planes the other
  // reaches across: a chunk's box, then its squares' (inside it), then their stalks' (inside those).
  // (Until 3 Oct 2026, each against all three, twice: most of the time the list took.)
  function crossing(planes, mask, minX, minY, minZ, maxX, maxY, maxZ) {
    let crossed = 0;
    for (let bit = 1; bit <= 4; bit <<= 1) {
      if (!(mask & bit)) continue;
      const p = bit === 4 ? 16 : 4 * (bit - 1), a = planes[p], b = planes[p + 1], c = planes[p + 2], d = planes[p + 3];
      // The corner furthest to the visible side (outside if even that is), then the furthest from it.
      if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0) return -1;
      if (a * (a > 0 ? minX : maxX) + b * (b > 0 ? minY : maxY) + c * (c > 0 ? minZ : maxZ) + d < 0) crossed |= bit;
    }
    return crossed;
  }
  // The same for a stalk's box (`stalkReach` round its foot, from it to its top) and a clump's
  // (CLUMP_REACH round, as tall as it is), with less work: per plane (left, right, near), a·x + b·y +
  // c·z, and what the box's reach and height add on the visible side (see plan). True if it's
  // entirely outside one of those in `mask`.
  const stalkPlanes = new Float64Array(15), clumpPlanes = new Float64Array(15);
  function plan(planes) {
    for (let k = 0, p = 0; k < 15; k += 5, p += p === 4 ? 12 : 4) {
      const a = planes[p], b = planes[p + 1], c = planes[p + 2], d = planes[p + 3], across = Math.abs(a) + Math.abs(c);
      stalkPlanes[k] = clumpPlanes[k] = a; stalkPlanes[k + 1] = clumpPlanes[k + 1] = b; stalkPlanes[k + 2] = clumpPlanes[k + 2] = c;
      stalkPlanes[k + 3] = 0.5 * across + Math.max(b, 0); stalkPlanes[k + 4] = d + 0.5 * across;  // stalkReach(h) = 0.5 + 0.5 h
      clumpPlanes[k + 3] = Math.max(b, 0); clumpPlanes[k + 4] = d + CLUMP_REACH * across;
    }
  }
  function boxOutside(table, mask, x, y, z, h) {
    for (let k = 0, bit = 1; k < 15; k += 5, bit <<= 1) {
      if (mask & bit && table[k] * x + table[k + 1] * y + table[k + 2] * z + table[k + 3] * h + table[k + 4] < 0) return true;
    }
    return false;
  }

  const bent = s => {  // a stalk's bend, as the low 24 bits of the list's second number
    const o = 4 * s, x = Math.min(Math.max(bends[o], -1), 1), z = Math.min(Math.max(bends[o + 1], -1), 1);
    return Math.round(x * 2047) & 0xfff | (Math.round(z * 2047) & 0xfff) << 12;
  };

  // This frame's list, seen from `camera` ({ x, y, z }) through `planes`, at `time` (s).
  function update(camera, planes, time) {
    nearCount = 0; farCount = 0; clumpCount = 0; nearBent = 0; firstBent = lastBent = -1;
    // Which chunks the land is drawn from (terrain.js's choice, nearest first), and since when.
    // Stalks and clumps are drawn only from those: a chunk can be built while its coarser parent is
    // still drawn in its place (until its three neighbours are built too).
    frame++;
    for (let k = 0; k < terrain.drawCount; k++) {
      const i = terrain.drawList[k];
      if (drawnIn[i] !== frame - 1) shownAt[i] = appears(slots[i]) ? time : -Infinity;
      drawnIn[i] = frame;
    }
    const camX = camera.x, camZ = camera.z;
    plan(planes);

    // Stalks, nearest chunk first.
    for (let k = 0; k < terrain.drawCount; k++) {
      const slot = slots[terrain.drawList[k]];
      if (!slot.stalkCount) continue;
      const size = slot.size, across = size / CLUMP;
      const gapX = Math.max(slot.x - camX, 0, camX - slot.x - size), gapZ = Math.max(slot.z - camZ, 0, camZ - slot.z - size);
      const gap2 = gapX * gapX + gapZ * gapZ;
      if (gap2 > STALKS_TO * STALKS_TO) continue;
      const minX = slot.x - LEAN, minY = slot.minY, minZ = slot.z - LEAN;
      const maxX = slot.x + size + LEAN, maxY = slot.maxY + TALLEST, maxZ = slot.z + size + LEAN;
      if (!boxInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ)) continue;
      if (!share(slot, camX, camZ, time)) continue;  // all clumps
      // Square by square: in view, wholly or partly (then stalk by stalk), and how much of it is stalks.
      const mask = crossing(planes, 7, minX, minY, minZ, maxX, maxY, maxZ), o = squareBase[slot.index];
      if (NEAR_ROOM + farCount + slot.stalkCount > capacity) break;  // never, at ~9,000 stalks
      const stalks = slot.stalks, starts = slot.squareStarts, base = stalkBase[slot.index];
      const nearTo = (cedarsIn[slot.index] ? CEDAR_NEAR_BY : NEAR_BY) + NEAR_FADE / 2, near = gap2 < nearTo * nearTo;
      const bendRow = slot.level === 0 && movingIn[slot.index] > 0 ? slot.index * MAX_STALKS : -1;  // any bent
      let n = NEAR_ROOM + farCount;
      for (let q = 0, row = 0, column = 0; q < across * across; q++, column = column === across - 1 ? (row++, 0) : column + 1) {
        const shown = shares[o + q], from = starts[q], to = starts[q + 1];
        if (!shown || from === to) continue;
        const x0 = slot.x + column * CLUMP - LEAN, z0 = slot.z + row * CLUMP - LEAN;
        let crossed = 0;
        if (mask) {
          crossed = crossing(planes, mask, x0, minY, z0, x0 + CLUMP + 2 * LEAN, maxY, z0 + CLUMP + 2 * LEAN);
          if (crossed < 0) continue;
        }
        // Near stalks only in a square reaching (a metre past) where they can be.
        let nearHere = near;
        if (near) {
          const sx = Math.max(x0 + LEAN - camX, 0, camX - x0 - LEAN - CLUMP), sz = Math.max(z0 + LEAN - camZ, 0, camZ - z0 - LEAN - CLUMP);
          nearHere = sx * sx + sz * sz < (nearTo + 1) * (nearTo + 1);
        }
        if (!crossed && !nearHere && bendRow < 0) {  // all of them, as they come (most of them)
          const second = shown << 24;
          for (let i = from; i < to; i++) list[n++] = second | base + 2 * i;
          continue;
        }
        for (let i = from; i < to; i++) {
          const moved = bendRow >= 0 && isMoving[bendRow + i] === 1;
          if (crossed && !moved) {  // a bent one could be anywhere near
            const f = i * STALK_FLOATS;
            if (boxOutside(stalkPlanes, crossed, stalks[f], stalks[f + 1], stalks[f + 2], stalks[f + 3])) continue;
          }
          const bend = moved ? bent(bendRow + i) : 0;
          let left = shown;
          if (nearHere && nearCount < NEAR_ROOM) {  // each stalk its own distance, from where it stands (the same, whichever level)
            const x = stalks[i * STALK_FLOATS], z = stalks[i * STALK_FLOATS + 2], tree = stalks[i * STALK_FLOATS + 5] >= CEDAR_STRIP;
            const dx = x - camX, dz = z - camZ, r = (x * 0.6180339887 + z * 0.4142135624) % 1;
            const d = tree ? CEDAR_NEAR_FROM + (CEDAR_NEAR_BY - CEDAR_NEAR_FROM) * (r < 0 ? r + 1 : r) : NEAR_FROM + (NEAR_BY - NEAR_FROM) * (r < 0 ? r + 1 : r);
            const t = Math.min(Math.max((d - Math.sqrt(dx * dx + dz * dz)) / NEAR_FADE + 0.5, 0), 1);  // 1: all near
            const nearShown = Math.round(shown * t);
            if (nearShown) {
              list[nearCount] = nearShown << 24 | (bend ? BENT : 0) | base + 2 * i;
              if (bend) { listBends[nearCount] = bend; nearBent++; }
              nearCount++;
            }
            left -= nearShown;
            if (!left) continue;
          }
          list[n] = left << 24 | (bend ? BENT : 0) | base + 2 * i;
          if (bend) { listBends[n] = bend; if (firstBent < 0) firstBent = n; lastBent = n; }
          n++;
        }
      }
      farCount = n - NEAR_ROOM;
    }

    // Clumps, from the land being drawn (nearest first): at every level, and where the chunk plants
    // stalks too, as much of each square as isn't its stalks.
    let n = NEAR_ROOM + farCount;
    for (let k = 0; k < terrain.drawCount && n < capacity; k++) {
      const slot = slots[terrain.drawList[k]];
      if (!slot.clumpCount) continue;
      const x0 = slot.x, z0 = slot.z, size = slot.size;
      const minX = x0 - CLUMP_REACH, minY = slot.minY, minZ = z0 - CLUMP_REACH;
      const maxX = x0 + size + CLUMP_REACH, maxY = slot.maxY + TALLEST, maxZ = z0 + size + CLUMP_REACH;
      if (!boxInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ)) continue;
      let shared = false, o = 0;  // whether any of its squares are partly stalks; where their shares are
      const gapX = Math.max(x0 - camX, 0, camX - x0 - size), gapZ = Math.max(z0 - camZ, 0, camZ - z0 - size);
      if (slot.stalks && gapX * gapX + gapZ * gapZ < STALKS_TO * STALKS_TO) {
        const sum = share(slot, camX, camZ, time);
        if (sum === 255 * (size / CLUMP) ** 2) continue;  // all stalks
        shared = sum > 0;
        o = squareBase[slot.index];
      }
      // What needs checking clump by clump: the mist's end, the view's sides.
      const farX = Math.max(Math.abs(x0 - camX), Math.abs(x0 + size - camX)), farZ = Math.max(Math.abs(z0 - camZ), Math.abs(z0 + size - camZ));
      const allNear = farX * farX + farZ * farZ < far * far;
      const mask = crossing(planes, 7, minX, minY, minZ, maxX, maxY, maxZ);
      const clumps = slot.clumps, squares = slot.clumpSquares, id = slot.index << 10;
      for (let i = 0; i < slot.clumpCount && n < capacity; i++) {
        const shown = shared ? 255 - shares[o + squares[i]] : 255;
        if (!shown) continue;
        const f = i * CLUMP_FLOATS, x = clumps[f], z = clumps[f + 2];
        if (!allNear) {
          const dx = x - camX, dz = z - camZ;
          if (dx * dx + dz * dz > far * far) continue;
        }
        const y = clumps[f + 1];
        if (mask && boxOutside(clumpPlanes, mask, x, y, z, Math.abs(clumps[f + 3]))) continue;  // (a cedars' stand's, negative)
        list[n++] = shown << 24 | id | i;
      }
    }
    clumpCount = n - NEAR_ROOM - farCount;
  }

  return {
    list, listBends, bend, replant, update, cedarsNear, cedarWall, stalkBase, stalkRows: Math.ceil(texels / STALK_WIDTH),
    // The bent entries: how many near ones (from 0), and the first and last far one (-1: none).
    get nearBent() { return nearBent; }, get firstBent() { return firstBent; }, get lastBent() { return lastBent; },
    // Where in the list: the near stalks from 0, the far ones from farFrom, the clumps from clumpsFrom; and
    // how long it is, all told.
    get near() { return nearCount; }, get far() { return farCount; }, get clumps() { return clumpCount; },
    farFrom: NEAR_ROOM, get clumpsFrom() { return NEAR_ROOM + farCount; }, get length() { return NEAR_ROOM + farCount + clumpCount; },
    get moving() { return movingCount; }, get pushed() { return pushed; }, get struck() { return struck; },
  };
}

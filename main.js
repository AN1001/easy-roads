import { loadProgram, loadTexture, createTextureArray } from './gl.js';
import { mat4, multiply, perspective, lookAt, frustumPlanes, boxInFrustum,
  translation, rotationX, rotationY } from './math.js';
import { createTerrain, CHUNK_QUADS, VERTEX_SHORTS, STALK_FLOATS, CLUMP_FLOATS } from './terrain.js';
import { loadCarMeshes, createCar, placeCar, resetCar, updateCar, followTheRoad, WHEEL_RADIUS } from './car.js';
import { createTextures, createPuddles, puddleAt, TEXTURE_SIZE, TEXTURE_LAYERS, PUDDLE_SIZE } from './textures.js';
import { createBambooModel, createBamboo, LIST_WIDTH, LIST_ROWS, STALK_WIDTH } from './bamboo.js';
import { createParticles, updateParticles, kickUp, MAX_PARTICLES, PARTICLE_FLOATS } from './particles.js';
import { createProfiler } from './profiler.js';
import { BLOCK_FLOATS, blockWriter } from './blocks.js';
import { bridgeBlocks, bridgeWall } from './bridges.js';
import { treeModel, treeWall, treesNear, loadBroadleaf, broadleafLook, BROADLEAF_FLOATS } from './trees.js';
import { scatter, rockWall, copiesNear, KINDS, NATURE_FLOATS, INSTANCE_FLOATS } from './nature.js';
import { createSound } from './sound.js';
import { createHint, createJoystick, touchScreen } from './ui.js';

// Profiling options, e.g. ?profile&autodrive&size=3440x1440
//   profile: on-screen frame/GPU timings (window.profiler.report() for full stats)
//   autodrive: drive in circles without touching the keys, for repeatable measurements;
//     autodrive=road follows the road instead, so new terrain keeps being built
//   size: render at a fixed resolution instead of the window's
//   spawn=x,z: start on the road nearest that point, for measuring the same place each time;
//     spawn=x,z,back facing the other way along it
//   aa / nocull: turn antialiasing back on / chunk culling off, to measure what they cost
//   nonature: no ground cover (nature.js: grass, ferns, bushes, rocks), to measure what it costs
//   step=60: each frame moves the game on 1/60 s, however long it took: the same drive frame by
//     frame, however slowly it's drawn (bench/headless.mjs, with a software renderer)
const params = new URLSearchParams(location.search);
const autodrive = params.has('autodrive');
const followRoad = params.get('autodrive') === 'road';
const fixedSize = params.get('size')?.split('x').map(Number);
const cull = !params.has('nocull');
const natureOn = !params.has('nonature');
const fixedStep = params.has('step') ? 1000 / (Number(params.get('step')) || 60) : 0;  // ms

const canvas = document.querySelector('canvas');
// No antialiasing (multisampling): measured to roughly halve the GPU cost per pixel,
// including clearing the screen. Edges get PS2-style jaggies instead.
const gl = canvas.getContext('webgl2', { antialias: params.has('aa') });

const profiler = params.has('profile')
  ? createProfiler(gl, ['clear', 'car', 'stalks', 'terrain', 'leaves', 'clumps', 'particles', 'rain', 'sky', 'trees', 'nature'],
    ['chunks drawn', 'rows built', 'particles', 'stalks near', 'stalks far', 'clumps', 'stalks bent'])
  : null;
window.profiler = profiler;

const loading = Promise.all([
  loadProgram(gl, 'shaders/terrain.vert', 'shaders/terrain.frag'),
  loadProgram(gl, 'shaders/car.vert', 'shaders/car.frag'),
  loadProgram(gl, 'shaders/particles.vert', 'shaders/particles.frag'),
  loadProgram(gl, 'shaders/stalk.vert', 'shaders/stalk.frag'),
  loadProgram(gl, 'shaders/leaves.vert', 'shaders/leaves.frag'),
  loadProgram(gl, 'shaders/rain.vert', 'shaders/rain.frag'),
  loadProgram(gl, 'shaders/sky.vert', 'shaders/sky.frag'),
  loadProgram(gl, 'shaders/clump.vert', 'shaders/clump.frag'),
  loadProgram(gl, 'shaders/built.vert', 'shaders/built.frag'),
  loadProgram(gl, 'shaders/water.vert', 'shaders/water.frag'),
  loadCarMeshes(),
  loadTexture(gl, 'assets/Car 03/car3_zen.png'),  // bench/livery.mjs --zen: car3.png's green, the bumper's brake light
  loadTexture(gl, 'assets/Wheel/wheel.png'),
  loadProgram(gl, 'shaders/tree.vert', 'shaders/tree.frag'),
  loadBroadleaf(),
  loadTexture(gl, 'assets/tree_01/tree_01.png'),
  loadProgram(gl, 'shaders/nature.vert', 'shaders/nature.frag'),
]);
// The textures for the ground, the bamboo and the clouds, and the puddles, are made while those files load.
const texturesStart = performance.now();
const texturePixels = createTextures(), puddleTexels = createPuddles();
console.log(`textures: made in ${(performance.now() - texturesStart).toFixed(1)} ms`);
const [terrainProgram, carProgram, particleProgram, stalkProgram, leavesProgram, rainProgram, skyProgram,
  clumpProgram, builtProgram, waterProgram, carMeshes, bodyTexture, wheelTexture, treeProgram, broadleafShapes, broadleafTexture,
  natureProgram] = await loading;

// --- Terrain ---

// Mist: none within FOG_START m, solid mist from FOG_END m, and in between thickening as real mist
// does: each FOG_THICKNESS m of it hides about two thirds of what's behind (sky.glsl), so ridge after
// ridge fades fainter. Terrain beyond FOG_END looks exactly like the mist, and like the treeline the
// sky draws all round the horizon (sky.frag), so it isn't drawn at all.
const FOG_START = 10;
const FOG_END = 400;
const FOG_THICKNESS = 140;

// Endless terrain, built around the camera in chunks of 31 × 31 vertices, drawn to the fog's end.
// Coarser further away (terrain.js): a vertex every 1 m within DETAIL[0] m (chunks 30 m across),
// every 2 m within DETAIL[1] m (60 m), every 4 m beyond (120 m). Each chunk is built AHEAD m
// before it's needed (at top speed, 30 m/s, ~1.3 s), the soonest needed first, a row at a time,
// for at most BUILD_BUDGET ms per frame; a chunk takes about 0.5 ms, so 1-2 frames. Until finer
// chunks are built, the coarser one stays; and any hole on screen inside SEEN m (after a tow, or
// should the building ever fall that far behind) is filled at once, whatever the budget: beyond
// that the mist hides it (96% mist: sky.glsl's curve, solved for the distance).
const DETAIL = [100, 220];  // m
const AHEAD = 40;           // m
const BUILD_BUDGET = 1;     // ms
const SEEN = FOG_START - FOG_THICKNESS * Math.log(1 - 0.96 * (1 - Math.exp(-(FOG_END - FOG_START) / FOG_THICKNESS)));  // m
// Built in a worker (terrain-worker.js), off the main thread, where one starts (a module worker);
// terrain.js still builds here, at once, what's needed at once: a hole in view, the ground under the
// car. (All of it here, within BUILD_BUDGET a frame, until 3 Oct 2026: ~0.25 ms a frame in Node,
// driving the road, more catching up.)
let builder = null;
try { builder = new Worker(new URL('terrain-worker.js', import.meta.url), { type: 'module' }); } catch {}
const terrain = createTerrain({ draw: FOG_END, ahead: AHEAD, detail: DETAIL, worker: builder });
// By default, the lane nearest (600, -330), near the middle of the world. Copied, since the next
// call to nearestRoad reuses the object it answers with.
const [spawnX, spawnZ, spawnBack] = params.get('spawn')?.split(',') ?? [600, -330];
const spawn = { ...terrain.nearestRoad(Number(spawnX), Number(spawnZ)) };
if (spawnBack === 'back') spawn.heading += Math.PI;
const buildStart = performance.now();
terrain.update(spawn.x, spawn.z, Infinity);
console.log(`terrain: ${terrain.slots.filter(slot => slot.ready).length} chunks built in ${(performance.now() - buildStart).toFixed(1)} ms`);

// --- Meshes. Each gets a Vertex Array Object (VAO), which remembers its buffers and
// layout, so switching mesh each frame is one bind call instead of re-describing it ---

// Every chunk uses the same index list, so it's uploaded once and shared.
const chunkIndexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunkIndexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, terrain.indices, gl.STATIC_DRAW);

// One vertex buffer and VAO per chunk slot, made once and refilled as the slot takes on new
// chunks: no GPU objects are created or deleted while driving. 8 bytes per vertex (see
// terrain.js): 4-byte aligned, which Metal requires, so the browser can hand the buffer over as-is.
const chunkBuffers = [];
const chunkVaos = terrain.slots.map(slot => {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  chunkBuffers.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, slot.vertices.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunkIndexBuffer);
  const stride = VERTEX_SHORTS * 2;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 2, gl.SHORT, stride, 0);        // height, road edge: stay integers
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.BYTE, true, stride, 4);    // normal and grove: -127..127 becomes -1..1
  return vao;
});
const uploadedVersion = new Int32Array(terrain.slots.length);  // 0: nothing uploaded yet

// The rivers' water (water.vert): per slot, its own buffer and VAO, 4 bytes a vertex (the water's
// height and depth), drawn with the land's index list, but not its skirts, for chunks near a river.
const waterBuffers = [];
const waterVaos = terrain.slots.map(slot => {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  waterBuffers.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, slot.water.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunkIndexBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribIPointer(0, 2, gl.SHORT, 4, 0);
  return vao;
});
const WATER_INDICES = CHUNK_QUADS * CHUNK_QUADS * 6;

// Car body and wheel: 5 floats per vertex (x, y, z, u, v; 20 bytes, 4-byte aligned), at the
// attribute locations car.vert fixes. Floats are simplest, and it's only ~300 vertices.
function createModelVao({ vertices, indices }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);   // position
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);  // texture coordinate
  gl.bindVertexArray(null);
  return vao;
}
const bodyVao = createModelVao(carMeshes.body);
const wheelVao = createModelVao(carMeshes.wheel);
const bodyIndexCount = carMeshes.body.indices.length;
const wheelIndexCount = carMeshes.wheel.indices.length;

// The bridges near the camera, built of blocks (blocks.js), in one buffer, refilled (new storage)
// whenever terrain.js finds a different set, every few hundred metres at most. Per vertex:
// position, normal, texture coordinate, colour and texture layer.
// The cherry trees (trees.js) the same way, but each in a buffer of its own, from a pool of
// TREE_SLOTS made at the start: a tree found gets a free one, filled once with its model (~4,000
// vertices, ~0.2 MB), kept while it's near. (All of them in one buffer, refilled whenever one came
// or went, was ~11 MB each time.) Both drawn with indices (blocks.js's shareVertices, trees.js), each
// slot and the bridges' with an index buffer of their own, in their VAO.
const TREE_SLOTS = 48;
// From TREE_LOD m, a tree's far model (trees.js). Each is culled by a box TREE_BOX m either side of
// its trunk, up to TREE_HEIGHT m above its foot.
// Its near model's made once it's within TREE_DETAIL m.
const TREE_LOD = 90, TREE_DETAIL = 115, TREE_BOX = 9, TREE_HEIGHT = 14;
const treesDrawn = [];
let treesWaiting = [], broadleafTrees = [];
function createBuiltVao() {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  [[3, 0], [3, 3], [2, 6], [3, 8], [1, 11]].forEach(([size, at], k) => {
    gl.enableVertexAttribArray(k);
    gl.vertexAttribPointer(k, size, gl.FLOAT, false, BLOCK_FLOATS * 4, 4 * at);
  });
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bindVertexArray(null);
  return { vao, buffer, indices: 0, type: gl.UNSIGNED_SHORT, size: 2 };
}
// Vertices and indices (the first `floats` and `count` of them) into a built VAO, each new storage:
// the last may still be drawn from.
function fillBuilt(built, vertices, indices, floats = vertices.length, count = indices.length) {
  built.indices = count;
  if (!count) return;
  gl.bindVertexArray(built.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, built.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW, 0, floats);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW, 0, count);  // (the VAO's own)
  gl.bindVertexArray(null);
  built.size = indices.BYTES_PER_ELEMENT;
  built.type = built.size === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
}
const bridgeBuilt = createBuiltVao(), bridgeWriter = blockWriter();
// Per slot: its tree, its model's indices (0: none yet) and its near model's (0: only the far one),
// whether it's held back (see below), whether it's new (not drawn yet: whether to hold it back is
// worked out the first time it could be), and whether a model's been asked for (see treeWorker).
const treeSlots = Array.from({ length: TREE_SLOTS }, () => Object.assign(createBuiltVao(), { tree: null, near: 0, held: false, fresh: false, asked: false, range: 0 }));
// A tree's model into its slot: `detailed`, its near one too.
function placeTree(slot, model) {
  fillBuilt(slot, model.vertices, model.indices);
  slot.near = model.near;  // indices
}
function makeTree(slot, tree, detailed) {
  if (slot.tree !== tree) { slot.tree = tree; slot.fresh = true; slot.held = false; }
  placeTree(slot, treeModel(tree, detailed));
}
// The models are made in a worker (tree-worker.js), one asked for at a time, where one starts: ~1 ms
// each (Node), one a frame at most made here until 3 Oct 2026. Here still after a jump (all those
// within SEEN at once: see below), or where the worker can't start.
let treeWorker = null, treeAsked = null, treeAsks = 0;  // the ask in flight: { id, slot, tree }
try { treeWorker = new Worker(new URL('tree-worker.js', import.meta.url), { type: 'module' }); } catch {}
if (treeWorker) {
  treeWorker.onmessage = ({ data }) => {
    const ask = treeAsked;
    if (!ask || ask.id !== data.id) return;
    treeAsked = null;
    ask.slot.asked = false;
    if (ask.slot.tree === ask.tree) placeTree(ask.slot, data);  // (not if its slot's been freed since)
  };
  treeWorker.onerror = () => {  // made here from now on; one asked for and lost goes back to waiting
    treeWorker = null;
    if (treeAsked) { treeAsked.slot.asked = false; if (!treeAsked.slot.indices) treeAsked.slot.tree = null; treeAsked = null; treesVersion = -1; }
  };
}
function askTree(slot, tree, detailed) {
  if (slot.tree !== tree) { slot.tree = tree; slot.fresh = true; slot.held = false; slot.indices = 0; slot.near = 0; }
  slot.asked = true;
  treeAsked = { id: ++treeAsks, slot, tree };
  treeWorker.postMessage({ id: treeAsks, tree: { x: tree.x, y: tree.y, z: tree.z, kind: tree.kind, seed: tree.seed,
    ground: tree.ground, groundStep: tree.groundStep, groundSize: tree.groundSize }, detailed });
}
const freeTreeSlot = () => { for (const slot of treeSlots) if (!slot.tree) return slot; return null; };
const treeInView = tree => boxInFrustum(planes, tree.x - TREE_BOX, tree.y - 1, tree.z - TREE_BOX, tree.x + TREE_BOX, tree.y + TREE_HEIGHT, tree.z + TREE_BOX);
let builtVersion = -1, treesVersion = -1;

// The broadleaf trees (trees.js, tree.vert): their three shapes in one buffer, uploaded once; per
// shape, a VAO reading it, and a buffer of the trees of that shape (where each stands, how it's
// turned, its size: 5 floats), refilled whenever terrain.js finds a different set of trees, each
// drawn with one call for all of them.
// Their indices in one buffer too, each shape's counted from its own first vertex.
const broadleafBuffer = gl.createBuffer(), broadleafIndices = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, broadleafBuffer);
{
  const all = new Float32Array(broadleafShapes.reduce((n, shape) => n + shape.vertices.length, 0));
  const indices = new Uint16Array(broadleafShapes.reduce((n, shape) => n + shape.indices.length, 0));
  let at = 0, i = 0;
  for (const shape of broadleafShapes) {
    shape.first = at / BROADLEAF_FLOATS; all.set(shape.vertices, at); at += shape.vertices.length;
    shape.firstIndex = i; indices.set(shape.indices, i); i += shape.indices.length;
  }
  gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, broadleafIndices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
}
// The ground cover (nature.js): every kind's model in one vertex buffer and one index buffer,
// uploaded once; per kind, a VAO reading its model, and a buffer of its copies (INSTANCE_FLOATS
// each), refilled from what each drawn chunk scattered whenever the chunks drawn change (at most
// every NATURE_REFRESH ms). One draw per kind for all its copies.
const NATURE_REFRESH = 250;
// Copies this much beyond where their kind fades out are still gathered: the camera moves on (up to
// NATURE_MOVE m) before the next gathering. (Every copy of every chunk some of which was within it
// until 3 Oct 2026: ~3 times as many, each through the vertex shader. Ferns, fading out by 55 m:
// those of chunks up to ~110 m off.)
const NATURE_MARGIN = 15;  // m
// Only those copies that may be in view are drawn (all round the camera, before: ~5 times as many):
// as they're gathered, each kind's are sorted into buckets, the nearest (within NATURE_NEAR m) and
// SECTORS sectors round the camera (natureView), and each run of buckets in view is a draw. Gathered
// again too once the camera's NATURE_MOVE m from where they last were. The sectors are counted from
// the way the camera looked then (gatherLook), and the nearest copies' bucket put between the two in
// the middle, where it looks: so those in view are one run of buckets (one draw), not two or three
// (the nearest, and the view's sectors split where the count began: until 3 Oct 2026), unless the
// camera's turned a long way since.
const SECTORS = 16, NATURE_NEAR = 25, NATURE_MOVE = 12, NEAR_BUCKET = SECTORS / 2;
let gatherX = 0, gatherZ = 0, gatherLook = 0;
const natureKinds = (() => {
  const vertexBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
  let vertexCount = 0, indexCount = 0;
  const placed = KINDS.map(kind => {
    const p = { firstVertex: vertexCount, firstIndex: indexCount, count: kind.model.indices.length };
    vertexCount += kind.model.vertices.length / NATURE_FLOATS; indexCount += kind.model.indices.length;
    return p;
  });
  const vertices = new Float32Array(vertexCount * NATURE_FLOATS), indices = new Uint16Array(indexCount);
  KINDS.forEach((kind, k) => {
    vertices.set(kind.model.vertices, placed[k].firstVertex * NATURE_FLOATS); indices.set(kind.model.indices, placed[k].firstIndex);
  });
  console.log(`ground cover: ${KINDS.length} kinds, ${vertexCount} vertices, ${indexCount / 3} triangles`);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return KINDS.map((kind, k) => {
    const p = placed[k], vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    if (k === 0) gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    [[0, 3, 0], [1, 3, 3], [2, 2, 6], [3, 1, 8], [6, 3, 9], [7, 1, 12]].forEach(([a, size, at]) => {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, size, gl.FLOAT, false, NATURE_FLOATS * 4, 4 * (p.firstVertex * NATURE_FLOATS + at));
    });
    const instances = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    [[4, 4, 0], [5, 1, 4]].forEach(([a, size, at]) => {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, size, gl.FLOAT, false, INSTANCE_FLOATS * 4, 4 * at);
      gl.vertexAttribDivisor(a, 1);
    });
    gl.bindVertexArray(null);
    return { kind, vao, instances, indices: p.count, firstIndex: p.firstIndex, copies: 0, list: new Float32Array(1024),
      sorted: new Float32Array(1024), starts: new Int32Array(SECTORS + 2) };
  });
})();
// Ground cover that comes late, its chunk drawn in place of a coarser one that hadn't it only once
// some of it could be seen (the building fell behind), would be seen springing up (asked for, 3 Oct
// 2026: "objects load in dramatically around me ... make them not load in if they are too late"):
// so what of it can be seen then is held back (heldCopies, by kind and square of the world, so the
// finer chunks that later take over hold the same copies) until it's out of view or beyond its
// fade, and drawn from the next gathering on. Never after a jump (the first frame, a tow), when the
// whole picture is new. Which chunks the land was drawn from last frame (drawnIn, by slot), for
// telling: a chunk drawn for the first time, its parent drawn last frame, is late (lateSlots); and
// the version of each slot's chunk last gathered (gatheredVersion). (Typed arrays rather than more
// properties on terrain.js's slots: V8 keeps those objects all one shape.)
const heldCopies = new Map();  // copyKey → [kind, x, y, z]
const copyKey = (k, x, z) => (k * 4194304 + (Math.floor(x / KINDS[k].cell) & 4194303)) * 4194304 + (Math.floor(z / KINDS[k].cell) & 4194303);
const COPY_REACH = 2.5, COPY_HEIGHT = 4;  // m: the most any copy reaches round and above its foot
function copySeen(k, x, y, z) {
  const dx = x - camera.x, dz = z - camera.z, fade = KINDS[k].fade[1];
  return dx * dx + dz * dz < fade * fade && boxInFrustum(planes, x - COPY_REACH, y - 1, z - COPY_REACH, x + COPY_REACH, y + COPY_HEIGHT, z + COPY_REACH);
}
const drawnIn = new Int32Array(terrain.slots.length).fill(-2), drawnVersion = new Int32Array(terrain.slots.length);
const lateSlots = new Uint8Array(terrain.slots.length), gatheredVersion = new Int32Array(terrain.slots.length).fill(-1);
let drawFrame = 0;
// The boulders near, for rockWall: per boulder kind, its copies (as gathered); and of those, the ones
// near the car (see wallAt), found each frame.
const boulders = natureKinds.filter(nk => nk.kind.wall).map(nk => ({ list: nk.list, count: 0, radius: nk.kind.wall, nk }));
const nearBoulders = boulders.map(b => ({ list: new Float32Array(64 * INSTANCE_FLOATS), count: 0, radius: b.radius }));
let natureDirty = true, natureAt = -Infinity, natureSignature = 0;
// Gathers each kind's copies from the drawn chunks, into its buffer. (Nothing made each time: the
// counts, buckets and lists are kept, and grown if need be.)
const natureCounts = new Int32Array(KINDS.length), bucketAt = new Int32Array(SECTORS + 1);
let bucketOf = new Uint8Array(4096);
// `n` floats of `data` from `from` on, onto kind k's list.
function pushCopies(k, data, from, n) {
  const nk = natureKinds[k], at = natureCounts[k], need = at + n;
  if (need > nk.list.length) { const bigger = new Float32Array(Math.max(need, 2 * nk.list.length)); bigger.set(nk.list.subarray(0, at)); nk.list = bigger; }
  if (from === 0 && n === data.length) nk.list.set(data, at);
  else for (let f = 0; f < n; f++) nk.list[at + f] = data[from + f];
  natureCounts[k] = need;
}
function gatherNature() {
  natureCounts.fill(0);
  gatherX = camera.x; gatherZ = camera.z; gatherLook = Math.atan2(-view[10], -view[2]);
  // Only from chunks some of which is nearer than where the kind fades out (and NATURE_MARGIN), and
  // of theirs, only those copies; none held back.
  for (let d = 0; d < terrain.drawCount; d++) {
    const slot = terrain.slots[terrain.drawList[d]], lists = slot.nature;
    if (!lists) continue;
    const half = slot.size / 2, middle = Math.hypot(slot.x + half - gatherX, slot.z + half - gatherZ);
    const range = middle - half * Math.SQRT2, farthest = middle + half * Math.SQRT2;
    const first = gatheredVersion[slot.index] !== slot.version;  // this chunk's first gathering
    gatheredVersion[slot.index] = slot.version;
    for (let k = 0; k < lists.length; k++) {
      const list = lists[k], reach = KINDS[k].fade[1] + NATURE_MARGIN;
      if (!list || range >= reach) continue;
      // Late, and a kind its parent hadn't: what of it can be seen is held back.
      if (first && lateSlots[slot.index] && KINDS[k].level === slot.level) {
        for (let o = 0; o < list.length; o += INSTANCE_FLOATS) {
          if (copySeen(k, list[o], list[o + 1], list[o + 2])) heldCopies.set(copyKey(k, list[o], list[o + 2]), [k, list[o], list[o + 1], list[o + 2]]);
        }
      }
      if (farthest < reach && !heldCopies.size) { pushCopies(k, list, 0, list.length); continue; }
      for (let o = 0; o < list.length; o += INSTANCE_FLOATS) {
        const dx = list[o] - gatherX, dz = list[o + 2] - gatherZ;
        if (dx * dx + dz * dz >= reach * reach || (heldCopies.size && heldCopies.has(copyKey(k, list[o], list[o + 2])))) continue;
        pushCopies(k, list, o, INSTANCE_FLOATS);
      }
    }
  }
  // Each kind's copies sorted by bucket (counting them first, then each into its place): by the way
  // they lie from here, sector by sector, the nearest (NEAR_BUCKET) between the middle two.
  for (let k = 0; k < natureKinds.length; k++) {
    const nk = natureKinds[k], n = natureCounts[k] / INSTANCE_FLOATS, list = nk.list, starts = nk.starts;
    nk.copies = n;
    if (nk.sorted.length < natureCounts[k]) nk.sorted = new Float32Array(nk.list.length);
    if (bucketOf.length < n) bucketOf = new Uint8Array(2 * n);
    starts.fill(0);
    for (let c = 0; c < n; c++) {
      const dx = list[c * INSTANCE_FLOATS] - gatherX, dz = list[c * INSTANCE_FLOATS + 2] - gatherZ;
      let b = NEAR_BUCKET;
      if (dx * dx + dz * dz >= NATURE_NEAR * NATURE_NEAR) {
        const turn = Math.atan2(dz, dx) - gatherLook + Math.PI;  // from straight behind, -π to 3π
        const sector = Math.min(SECTORS - 1, Math.floor((turn - 2 * Math.PI * Math.floor(turn / (2 * Math.PI))) / (2 * Math.PI) * SECTORS));
        b = sector < NEAR_BUCKET ? sector : sector + 1;
      }
      bucketOf[c] = b;
      starts[b + 1]++;
    }
    for (let b = 1; b <= SECTORS + 1; b++) starts[b] += starts[b - 1];
    for (let b = 0; b <= SECTORS; b++) bucketAt[b] = starts[b];
    const sorted = nk.sorted;
    for (let c = 0; c < n; c++) {
      const to = bucketAt[bucketOf[c]]++ * INSTANCE_FLOATS, from = c * INSTANCE_FLOATS;
      for (let f = 0; f < INSTANCE_FLOATS; f++) sorted[to + f] = list[from + f];
    }
    if (!n) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, nk.instances);
    gl.bufferData(gl.ARRAY_BUFFER, sorted, gl.DYNAMIC_DRAW, 0, natureCounts[k]);  // new storage
  }
  for (const b of boulders) { b.list = b.nk.list; b.count = natureOn ? b.nk.copies * INSTANCE_FLOATS : 0; }
}

// Which buckets to draw this frame: the nearest always; a sector if the way it lies (from where
// the copies were gathered) is within the view's reach either side of where the camera looks: as
// far as its corners reach along the ground (the bottom ones further than the sides' middle, the
// camera tilted down), give or take half a sector, how much the camera's moved since (seen from
// here, a copy NATURE_NEAR m or more from there is off by at most asin(moved / NATURE_NEAR)), and
// how wide the biggest copy (COPY_REACH m round) can look from here (it's at least NATURE_NEAR -
// moved m off). (Without the corners and the copies' width, copies close by at the view's edges came
// into view late, until 3 Oct 2026.) As runs of buckets, (first, last + 1) pairs into natureRuns,
// natureRunCount long.
const natureRuns = new Int32Array(2 * (SECTORS + 2));
let natureRunCount = 0;
const CORNERS = [1, 1, 1, -1, -1, 1, -1, -1];
function natureView() {
  const moved = Math.hypot(camera.x - gatherX, camera.z - gatherZ);
  // The view's axes along the ground (lookAt's rows): forward, sideways and up, each x and z.
  const fx = -view[2], fz = -view[10], up = Math.tan(Math.PI / 8), across = up * canvas.width / canvas.height;
  let widest = 0;
  for (let c = 0; c < 8; c += 2) {
    const x = fx + CORNERS[c] * across * view[0] + CORNERS[c + 1] * up * view[1];
    const z = fz + CORNERS[c] * across * view[8] + CORNERS[c + 1] * up * view[9];
    widest = Math.max(widest, Math.abs(Math.atan2(fx * z - fz * x, fx * x + fz * z)));
  }
  const look = Math.atan2(fz, fx);
  const reach = moved < NATURE_NEAR - 2 * COPY_REACH
    ? widest + Math.PI / SECTORS + Math.asin(moved / NATURE_NEAR) + Math.asin(COPY_REACH / (NATURE_NEAR - moved))
    : Math.PI;
  natureRunCount = 0;
  let open = -1;
  for (let b = 0; b <= SECTORS; b++) {
    let seen = b === NEAR_BUCKET;
    if (!seen) {
      const sector = b < NEAR_BUCKET ? b : b - 1, middle = gatherLook + (sector + 0.5) / SECTORS * 2 * Math.PI - Math.PI;
      const off = Math.abs(((middle - look) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      seen = off <= reach;
    }
    if (seen && open < 0) open = b;
    if (!seen && open >= 0) { natureRuns[2 * natureRunCount] = open; natureRuns[2 * natureRunCount + 1] = b; natureRunCount++; open = -1; }
  }
  if (open >= 0) { natureRuns[2 * natureRunCount] = open; natureRuns[2 * natureRunCount + 1] = SECTORS + 1; natureRunCount++; }
}

const broadleaf = broadleafShapes.map(shape => {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, broadleafBuffer);
  [[3, 0], [3, 3], [2, 6], [1, 8]].forEach(([size, at], k) => {
    gl.enableVertexAttribArray(k);
    gl.vertexAttribPointer(k, size, gl.FLOAT, false, BROADLEAF_FLOATS * 4, 4 * (shape.first * BROADLEAF_FLOATS + at));
  });
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, broadleafIndices);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  [[4, 4, 0], [5, 1, 4]].forEach(([k, size, at]) => {
    gl.enableVertexAttribArray(k);
    gl.vertexAttribPointer(k, size, gl.FLOAT, false, 5 * 4, 4 * at);
    gl.vertexAttribDivisor(k, 1);
  });
  gl.bindVertexArray(null);
  return { vao, instances, indices: shape.indices.length, firstIndex: shape.firstIndex, count: 0, list: new Float32Array(0) };
});

// Bamboo (bamboo.js): no vertex buffers, just a list of indices for the models, which the shaders
// turn into the stalk or clump and the vertex of its model, from this frame's list (an integer
// texture, refilled each frame). The stalks themselves are in a float texture, STALK_WIDTH texels
// wide, 2 texels (STALK_FLOATS) per stalk, each slot's where bamboo.js says (level 0's and level
// 1's slots plant stalks); the clumps in another, a row per slot of every level, a texel
// (CLUMP_FLOATS) each; both refilled with the chunk.
const bambooModel = createBambooModel();
const bamboo = createBamboo(terrain, FOG_END);
const bambooVao = gl.createVertexArray();
gl.bindVertexArray(bambooVao);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bambooModel.indices, gl.STATIC_DRAW);
gl.bindVertexArray(null);
function dataTexture(unit, format, width, height) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  // Filled with zeros once: Firefox otherwise clears a texture itself before the first upload to
  // part of it, slowly, warning each time (1 Oct 2026).
  const float = format === gl.RGBA32F;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, float ? gl.RGBA : gl.RG_INTEGER, float ? gl.FLOAT : gl.UNSIGNED_INT,
    float ? new Float32Array(width * height * 4) : new Uint32Array(width * height * 2));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);  // read with texelFetch, but
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);  // float textures can't filter
  gl.activeTexture(gl.TEXTURE0);
  return texture;
}
dataTexture(2, gl.RGBA32F, STALK_WIDTH, bamboo.stalkRows);
const clumpWidth = Math.max(...terrain.slots.map(slot => slot.clumps.length)) / 4;  // texels
dataTexture(3, gl.RGBA32F, clumpWidth, terrain.slots.length);

// Nothing the GPU may still be reading is written to. Refilling a buffer or texture that the last
// frame or two drew with (the GPU runs a frame or two behind) makes some drivers stop and wait for
// the GPU to catch up: macOS's OpenGL among them, which Firefox and Zen draw with (Chrome's Metal
// doesn't). So what's refilled every frame (this list, the frame's uniforms, the particles) takes
// TURNS turns, a copy for each, and is refilled when its turn comes round again; a finished
// chunk's rows of the bamboo's textures go through a buffer of their own (uploadTexels).
const TURNS = 3;
let turn = 0;
const listTextures = Array.from({ length: TURNS }, () => dataTexture(4, gl.RG32UI, LIST_WIDTH, LIST_ROWS));

// `count` texels from `data` into the float texture on `unit`, `width` texels wide, from texel
// `start` on (along its rows, on to the next where one ends). Copied into a new buffer, which the
// GPU then copies into the texture in its own time, after the draws already sent that read it.
const rowBuffer = gl.createBuffer();
function uploadTexels(unit, width, start, data, count) {
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, rowBuffer);
  gl.bufferData(gl.PIXEL_UNPACK_BUFFER, data, gl.STREAM_DRAW, 0, count * 4);  // new storage each time
  gl.activeTexture(gl.TEXTURE0 + unit);
  for (let done = 0; done < count;) {
    const at = start + done, x = at % width, n = Math.min(width - x, count - done);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, Math.floor(at / width), n, 1, gl.RGBA, gl.FLOAT, done * 16);
    done += n;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
}

// The rain and the sky need no vertex data at all: their shaders work from gl_VertexID. (WebGL 2
// can draw with no attributes; this VAO is just one with none.)
const emptyVao = gl.createVertexArray();
const RAIN_DROPS = 5000;  // in the box round the camera (rain.vert): about one per 6 m³

// Dust, smoke and water: a buffer (one for each turn), refilled each frame with the live particles,
// as points.
const particles = createParticles();
const particleBuffers = [], particleVaos = [];
for (let k = 0; k < TURNS; k++) {
  particleVaos.push(gl.createVertexArray());
  gl.bindVertexArray(particleVaos[k]);
  particleBuffers.push(gl.createBuffer());
  gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffers[k]);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * PARTICLE_FLOATS * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PARTICLE_FLOATS * 4, 0);   // centre, size
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, PARTICLE_FLOATS * 4, 16);  // opacity, colour, dither shift
}
gl.bindVertexArray(null);

// The texture array stays on texture unit 1 for good; the car's take turns on unit 0.
gl.activeTexture(gl.TEXTURE1);
createTextureArray(gl, texturePixels, TEXTURE_SIZE, TEXTURE_LAYERS);
// The puddles (textures.js) on unit 5, for the land. Up close, sharp texels, like the ground's; where
// a pixel spans many, the share of them that are puddle, blurred from the mipmaps along the ground
// as far as it reaches, as the GPU can (anisotropic filtering), rather than every way as far as the
// most: the road seen at a slant, a pixel reaches far along it and hardly across.
gl.activeTexture(gl.TEXTURE5);
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texStorage2D(gl.TEXTURE_2D, Math.log2(PUDDLE_SIZE) + 1, gl.RG8, PUDDLE_SIZE, PUDDLE_SIZE);
gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PUDDLE_SIZE, PUDDLE_SIZE, gl.RG, gl.UNSIGNED_BYTE, puddleTexels);
gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');
if (anisotropic) {
  gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
    Math.min(16, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
}
// The broadleaf trees' texture on unit 6, with mipmaps (blended between levels, and within them:
// it's a photo, not texel art), so the leaves don't shimmer far off.
gl.activeTexture(gl.TEXTURE6);
gl.bindTexture(gl.TEXTURE_2D, broadleafTexture);
gl.generateMipmap(gl.TEXTURE_2D);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.useProgram(treeProgram);
gl.uniform1i(gl.getUniformLocation(treeProgram, 'uTree'), 6);
const natureUniforms = { fade: gl.getUniformLocation(natureProgram, 'uFade'), sway: gl.getUniformLocation(natureProgram, 'uSway'),
  bloom: gl.getUniformLocation(natureProgram, 'uBloom') };
gl.activeTexture(gl.TEXTURE0);
for (const program of [terrainProgram, stalkProgram, leavesProgram, skyProgram, builtProgram, natureProgram]) {
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uGround'), 1);
}
gl.useProgram(terrainProgram);
gl.uniform1i(gl.getUniformLocation(terrainProgram, 'uPuddles'), 5);
gl.useProgram(clumpProgram);
gl.uniform1i(gl.getUniformLocation(clumpProgram, 'uGround'), 1);
const [stalkUniforms, leavesUniforms, clumpUniforms] = [stalkProgram, leavesProgram, clumpProgram].map(program => {
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uStalks'), 2);
  gl.uniform1i(gl.getUniformLocation(program, 'uClumps'), 3);
  gl.uniform1i(gl.getUniformLocation(program, 'uList'), 4);
  return { first: gl.getUniformLocation(program, 'uFirst'), stride: gl.getUniformLocation(program, 'uStride') };
});

const uChunk = gl.getUniformLocation(terrainProgram, 'uChunk');
const uWaterChunk = gl.getUniformLocation(waterProgram, 'uChunk');
const uModel = gl.getUniformLocation(carProgram, 'uModel');
const uPointScale = gl.getUniformLocation(particleProgram, 'uPointScale');

// --- Per-frame values shared by every shader: one Uniform Buffer Object (UBO), uploaded
// once per frame, instead of setting the same uniforms on each program separately ---

// Must match the `Frame` block in shaders/frame.glsl. std140 layout: mat4 + 6 × vec4
// (camera, fog, headlight position, headlight direction, tail lights, time, weather).
const frameData = new Float32Array(44);
const viewProj = frameData.subarray(0, 16);  // the matrix maths writes straight into it
frameData[20] = FOG_START;
frameData[21] = FOG_END;
frameData[22] = FOG_THICKNESS;
// The weather (fixed for now; to change over a drive later): rain, and the car's lights on, at dusk
// (sky.glsl). RAIN 0 and LIGHTS 0, with sky.glsl's day colours (in its comments), were a sunny
// day, briefly on 2 Oct 2026.
const RAIN = 1, LIGHTS = 1;
frameData[40] = RAIN;
frameData[41] = LIGHTS;

// One for each turn: bound to binding point 0 in its turn.
const frameUbos = Array.from({ length: TURNS }, () => {
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, frameData.byteLength, gl.DYNAMIC_DRAW);
  return ubo;
});
for (const program of [terrainProgram, carProgram, particleProgram, stalkProgram, leavesProgram, rainProgram, skyProgram, clumpProgram, builtProgram, waterProgram, treeProgram, natureProgram]) {
  gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'Frame'), 0);
}
// The headlight's and the tail lights' positions in it, which bend the bamboo (bamboo.js).
const lamp = frameData.subarray(24, 27), tail = frameData.subarray(32, 35);

// Matrices are allocated once here and overwritten each frame.
const proj = mat4();
const view = mat4();
const planes = new Float32Array(24);  // the camera's 6 view-volume planes, for culling
const spinMatrix = mat4(), steerMatrix = mat4(), wheelOffset = translation(mat4(), 0, 0, 0);
const wheelLocal = mat4(), wheelModel = mat4();

gl.enable(gl.DEPTH_TEST);  // nearer things hide further ones
// Or as near: the sky is drawn at the far plane, depth 1, the same as the cleared depth, and shows
// wherever that's still all there is.
gl.depthFunc(gl.LEQUAL);
gl.enable(gl.CULL_FACE);   // skip faces pointing away from the camera
gl.clearColor(10 / 31, 12 / 31, 14 / 31, 1);  // SKY in shaders/sky.glsl (the sky covers it, but just in case)

// --- Car and chase camera ---

const car = createCar();
placeCar(car, spawn.x, spawn.z, spawn.heading, terrain.groundAt);  // dropped onto a road

const CAMERA_DISTANCE = 9;   // m behind the car
const CAMERA_HEIGHT = 3.5;   // m above it
const camera = { x: 0, y: 0, z: 0 };
// The camera jumps straight to the car instead of easing there: on the first frame, and after a
// tow (easing, it would sail across the map, through hills, with the land popping in behind it).
let cut = true;

// Headlight: one lamp at the front of the car, pointing along it, dipped towards the road.
const LAMP_FORWARD = 2;      // m ahead of the car's centre (its front bumper)
const LAMP_HEIGHT = 0.6;     // m above the ground
const LAMP_DIP = 0.1;        // m down per m forward (about 6°)
const LAMP_AIM = 1 / Math.hypot(1, LAMP_DIP);  // makes the dipped direction unit length
// Tail lights: one light between the two, at the back of the car. Always on (the texture's own red)
// and three times as bright braking, past what red can show (car.frag). They light nothing else.
const TAIL_BACK = 1.95;      // m behind the car's centre (its back bumper)
const TAIL_HEIGHT = 0.72;    // m above the ground
const TAIL_LIGHT = 1.0, BRAKE_LIGHT = 3.0;

// What the sound follows (sound.js), worked out each frame.
const heard = { rain: 0, speed: 0, rev: 0, throttle: 0, grip: 0, rough: 0, slide: 0, wet: 0, push: 0, swaying: 0, struck: 0 };
const under = { road: 0, puddle: 0 };  // the tyres on the road and in puddles: kickUp's

// --- Input: keys currently held, by physical position (works on any keyboard layout); on touch
// screens, buttons that hold the same keys (ui.js) ---

const held = new Set();
const sound = createSound();
const hint = createHint();
// The keys that do something once, from the keyboard or a button. Any press also starts the sound
// (browsers keep a page silent until then) and starts the hint's countdown.
function press(code) {
  sound.start();
  hint.pressed();
  if (code === 'KeyR') resetCar(car, terrain.groundAt);  // back on its wheels
  if (code === 'KeyT') {  // towed back to the nearest road, facing along it
    const road = terrain.nearestRoad(car.x, car.z);
    if (Number.isFinite(road.x)) {  // NaN: no road within 3 km (never found), so stay put
      const heading = road.heading + (Math.cos(road.heading - car.heading) < 0 ? Math.PI : 0);
      placeCar(car, road.x, road.z, heading, terrain.groundAt);
      cut = true;
    }
  }
  if (code === 'KeyF') {  // full screen: the canvas alone, not the whole page
    if (document.fullscreenElement) document.exitFullscreen();
    else canvas.requestFullscreen?.();
  }
  if (code === 'KeyM') sound.toggleMute();
  if (code === 'KeyH') hint.toggle();
}
addEventListener('keydown', e => {
  held.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();  // don't scroll the page
  if (!e.repeat) press(e.code);
});
addEventListener('keyup', e => held.delete(e.code));
const stick = touchScreen ? createJoystick() : null;  // the only control on touch screens
// A touch on the game itself starts the sound too; and a touch only lets a page make sound once
// the finger lifts (touchend, for older Safaris), so those wake it again.
for (const type of ['pointerdown', 'pointerup', 'touchend']) addEventListener(type, () => sound.start());
addEventListener('blur', () => held.clear());  // no stuck keys after switching windows
const autopilot = { throttle: 0, steer: 0 };  // ?autodrive=road's pedals and steering

// --- Resize: only when the window changes, since resizing the canvas reallocates it ---

// Render low-res and let the browser blow each pixel up into a square block while
// compositing, which it does anyway. The block size comes from the whole screen (about 360
// rows of blocks when fullscreen), not the window, so a smaller window shows fewer blocks
// rather than smaller ones. Each block is a whole number of screen pixels, so they're all the
// same size; the canvas may overhang the window's right and bottom edges by less than one
// block. Fewer pixels is also this GPU's biggest saving (see NOTES.md).
const FULLSCREEN_ROWS = 360;

function resize() {
  if (fixedSize) {
    canvas.width = fixedSize[0];
    canvas.height = fixedSize[1];
  } else {
    // Screen pixels per block: 5 on the Retina laptop (1800 / 360), 4 on the ultrawide (1440 / 360).
    // (The screen's shorter side: on a phone held sideways, screen.height is still its long side.)
    const scale = Math.max(1, Math.round(Math.min(screen.width, screen.height) * devicePixelRatio / FULLSCREEN_ROWS));
    canvas.width = Math.ceil(innerWidth * devicePixelRatio / scale);
    canvas.height = Math.ceil(innerHeight * devicePixelRatio / scale);
    canvas.style.width = `${canvas.width * scale / devicePixelRatio}px`;
    canvas.style.height = `${canvas.height * scale / devicePixelRatio}px`;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  perspective(proj, Math.PI / 4, canvas.width / canvas.height, 0.3, FOG_END);
  const pixelsPerMetre = canvas.height / 2 * proj[5];  // 1 m in front of the camera; proj[5]: 1 / tan(half the field of view)
  gl.useProgram(particleProgram);
  gl.uniform1f(uPointScale, pixelsPerMetre);
  frameData[37] = 1 / pixelsPerMetre;
}
addEventListener('resize', resize);

// Moving the window to a display with a different pixel density (Retina 2× <-> ultrawide 1×)
// doesn't fire 'resize': the window's size in CSS pixels stays the same. So also watch for
// the density changing from its current value, and re-watch from the new one each time.
function onPixelRatioChange() {
  resize();
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
    .addEventListener('change', onPixelRatioChange, { once: true });
}
onPixelRatioChange();

// If the GPU process restarts, every buffer, shader and VAO is gone. Rather than rebuild
// them all, start again: preventDefault asks the browser for a new context, then reload.
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

// --- Culling: skip chunks the camera can't see ---

function chunkVisible(chunk) {
  const maxX = chunk.x + chunk.size, maxZ = chunk.z + chunk.size;
  // Nearest point of the chunk's box to the camera: past the fog's end, it's all mist.
  const dx = Math.max(chunk.x - camera.x, 0, camera.x - maxX);
  const dy = Math.max(chunk.minY - camera.y, 0, camera.y - chunk.maxY);
  const dz = Math.max(chunk.z - camera.z, 0, camera.z - maxZ);
  if (dx * dx + dy * dy + dz * dz > FOG_END * FOG_END) return false;
  // Behind the camera or off the sides of the screen.
  return boxInFrustum(planes, chunk.x, chunk.minY, chunk.z, maxX, chunk.maxY, maxZ);
}

// This frame's bamboo with `program` (the stalks' or the leaves'): the near stalks with the `near`
// model (bamboo.js), then the far ones with the `far` one; bamboo.js says where each starts in the list.
function drawBamboo(program, uniforms, near, far) {
  gl.useProgram(program);
  drawList(uniforms, near, 0, bamboo.near);
  drawList(uniforms, far, bamboo.farFrom, bamboo.farFrom + bamboo.far);
}
// The list's entries `from` up to `to` with `model`: with indices, as many at a time as they reach.
function drawList(uniforms, model, from, to) {
  if (to <= from) return;
  gl.uniform1i(uniforms.stride, model.stride);
  if (model.count) {
    for (let first = from; first < to; first += model.batch) {
      gl.uniform1i(uniforms.first, first);
      gl.drawElements(gl[model.mode], Math.min(model.batch, to - first) * model.count, gl.UNSIGNED_SHORT, model.offset);
    }
  } else {
    gl.uniform1i(uniforms.first, from);
    gl.drawArrays(gl[model.mode], 0, (to - from) * model.stride);
  }
}

// What the car's body bumps against: the bridges' railings, the trees' trunks and the boulders,
// the deepest. Only the trees and boulders within WALL_REACH m of the car, found once a frame
// (nearTrees, nearBoulders): the car's points are at most ~2.5 m from it, a trunk or boulder at most
// 1.3 m round, and in a frame (0.1 s at most) the car goes no more than ~3.5 m. (Every tree found,
// for every point of the car, at every physics step, until 3 Oct 2026: ~0.05 ms a frame in Node.)
const WALL_REACH = 10;  // m
const treeNormal = new Float64Array(3), nearTrees = [];
let nearTreeCount = 0;
const wallAt = (x, y, z, normal) => {
  let deepest = bridgeWall(terrain.bridges, x, y, z, normal);
  const tree = treeWall(nearTrees, x, y, z, treeNormal, nearTreeCount);
  if (tree > deepest) { deepest = tree; normal[0] = treeNormal[0]; normal[1] = treeNormal[1]; normal[2] = treeNormal[2]; }
  const rock = rockWall(nearBoulders, x, y, z, treeNormal);
  if (rock > deepest) { deepest = rock; normal[0] = treeNormal[0]; normal[1] = treeNormal[1]; normal[2] = treeNormal[2]; }
  return deepest;
};

// What particles.js asks about the ground under a tyre.
const ground = {
  roadDistanceAt: terrain.roadDistanceAt,
  edgeAt: terrain.edgeAt,
  puddleAt: (x, z) => RAIN > 0 && puddleAt(puddleTexels, x, z),  // dry: no puddles
};

// --- Game loop: the browser calls this before every screen refresh ---

let lastTime = -1, steps = 0;

function frame(realMs) {
  profiler?.frameStart(realMs);
  const timeMs = fixedStep ? steps++ * fixedStep : realMs;

  // Seconds since last frame, capped so a paused tab doesn't launch the car on return.
  const first = lastTime < 0;
  const dt = first ? 0 : Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;

  let throttle = autodrive || held.has('ArrowUp') || held.has('KeyW') ? 1 : 0;
  let brake = held.has('ArrowDown') || held.has('KeyS') ? 1 : 0;
  let steer = autodrive ? 0.5 : (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0)
                              - (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0);
  if (followRoad) {
    followTheRoad(car, terrain.nearestRoad, autopilot);
    throttle = autopilot.throttle;
    steer = autopilot.steer;
  }
  if (stick && (stick.x || stick.y)) {  // the joystick: pushed up or down past a third, the pedals
    throttle = stick.y > 0.33 ? 1 : 0;
    brake = stick.y < -0.33 ? 1 : 0;
    steer = Math.abs(stick.x) > 0.1 ? -stick.x : 0;  // as far as it's pushed (left is +)
  }
  const handbrake = held.has('Space') ? 1 : 0;
  if (nearTrees.length < terrain.trees.length) nearTrees.length = terrain.trees.length;
  nearTreeCount = treesNear(terrain.trees, car.x, car.z, WALL_REACH, nearTrees);
  for (let k = 0; k < boulders.length; k++) {
    const b = boulders[k], near = nearBoulders[k];
    if (near.list.length < b.count) near.list = new Float32Array(b.count);
    near.count = copiesNear(b.list, b.count, car.x, car.z, WALL_REACH, near.list);
  }
  updateCar(car, throttle, brake, handbrake, steer, dt, terrain.groundAt, wallAt, terrain.waterAt);
  const m = car.model;  // columns: side (0-2), up (4-6), forward (8-10), position (12-14)
  for (let k = 0; k < 3; k++) {
    lamp[k] = m[12 + k] + LAMP_FORWARD * m[8 + k] + LAMP_HEIGHT * m[4 + k];
    frameData[28 + k] = (m[8 + k] - LAMP_DIP * m[4 + k]) * LAMP_AIM;
    tail[k] = m[12 + k] - TAIL_BACK * m[8 + k] + TAIL_HEIGHT * m[4 + k];
  }
  bamboo.bend(tail, lamp, dt);
  updateParticles(particles, dt);
  kickUp(particles, car, throttle, dt, ground, under);

  // The sound: the engine by the driven (back) wheels' speed, the tyres by the car's and what
  // they're on, the bamboo by how much of it the car is pushing aside.
  const v = car.body.velocity;
  heard.speed = Math.hypot(v[0], v[1], v[2]);
  let grip = 0, slide = 0, spin = 0;
  for (const wheel of car.wheels) {
    if (wheel.onGround) { grip++; slide = Math.max(slide, wheel.slip); }
    if (!wheel.front) spin += Math.abs(wheel.spinRate) / 2;
  }
  heard.rev = spin * WHEEL_RADIUS / 30;  // 30 m/s: top speed
  heard.throttle = throttle;
  heard.grip = grip / 4;
  heard.rough = grip ? 0.4 + 0.6 * under.road / grip : 0;  // grit on the road; grass and leaves, softer
  heard.slide = slide;
  heard.wet = under.puddle ? 1 : 0;
  heard.rain = RAIN;
  heard.push = dt > 0 ? bamboo.pushed / dt : 0;
  heard.swaying = bamboo.moving;
  heard.struck = bamboo.struck;
  sound.update(heard, dt);

  // Camera eases towards a spot behind and above the car (or jumps there), and never dips into a hill.
  const ease = cut ? 1 : 1 - Math.exp(-dt * 4);
  const s = Math.sin(car.heading), c = Math.cos(car.heading);
  camera.x += (car.x - s * CAMERA_DISTANCE - camera.x) * ease;
  camera.z += (car.z - c * CAMERA_DISTANCE - camera.z) * ease;
  camera.y += (car.y + CAMERA_HEIGHT - camera.y) * ease;
  camera.y = Math.max(camera.y, terrain.groundAt(camera.x, camera.z) + 1.5, terrain.waterAt(camera.x, camera.z) + 1);  // and out of the water
  lookAt(view, camera.x, camera.y, camera.z, car.x, car.y + 1.2, car.z);

  // Build the chunks coming into range, and upload any that are finished. After a cut the whole
  // view is new: what's on screen (inside SEEN) is built at once, as any hole there always is, in
  // one long frame where the picture changes completely anyway; the rest, off screen or in the
  // mist, over the next few seconds. (Building everything at once, as until 1 Oct 2026, took
  // several times as long.)
  multiply(viewProj, proj, view);
  frustumPlanes(planes, viewProj);
  const rows = terrain.update(camera.x, camera.z, BUILD_BUDGET, SEEN, planes);
  const jumped = cut;  // the first frame, or a tow: the whole picture's new
  cut = false;
  profiler?.count(1, rows);
  for (let i = 0; i < terrain.slots.length; i++) {
    const slot = terrain.slots[i];
    if (slot.version === uploadedVersion[i] || !slot.ready) continue;
    // New storage, rather than refilling what the slot's last chunk may still be drawn from.
    gl.bindBuffer(gl.ARRAY_BUFFER, chunkBuffers[i]);
    gl.bufferData(gl.ARRAY_BUFFER, slot.vertices, gl.DYNAMIC_DRAW);
    if (slot.wet) {
      gl.bindBuffer(gl.ARRAY_BUFFER, waterBuffers[i]);
      gl.bufferData(gl.ARRAY_BUFFER, slot.water, gl.DYNAMIC_DRAW);
    }
    if (slot.stalkCount) uploadTexels(2, STALK_WIDTH, bamboo.stalkBase[i], slot.stalks, slot.stalkCount * STALK_FLOATS / 4);
    if (slot.stalks) bamboo.replant(i);
    slot.nature = slot.level <= 1 ? scatter(slot) : null;
    if (slot.clumpCount) uploadTexels(3, clumpWidth, i * clumpWidth, slot.clumps, slot.clumpCount * CLUMP_FLOATS / 4);
    uploadedVersion[i] = slot.version;
  }
  if (terrain.bridgesVersion !== builtVersion) {
    bridgeWriter.n = bridgeWriter.ni = 0;
    bridgeBlocks(terrain.bridges, bridgeWriter);
    fillBuilt(bridgeBuilt, bridgeWriter.vertices, bridgeWriter.indices, bridgeWriter.n, bridgeWriter.ni);
    builtVersion = terrain.bridgesVersion;
  }
  if (terrain.treesVersion !== treesVersion) {
    // Free the slots of trees no longer near; the newly found wait for one, nearest first.
    const near = new Set(terrain.trees);
    for (const slot of treeSlots) if (slot.tree && !near.has(slot.tree)) { slot.tree = null; slot.indices = slot.near = 0; slot.held = false; }
    treesWaiting = terrain.trees.filter(tree => tree.kind !== 'broadleaf' && !treeSlots.some(slot => slot.tree === tree));
    treesWaiting.sort((a, b) => Math.hypot(b.x - camera.x, b.z - camera.z) - Math.hypot(a.x - camera.x, a.z - camera.z));
    // The broadleaf trees, by shape (new storage each time, as the last set may still be drawn).
    broadleafTrees = terrain.trees.filter(tree => tree.kind === 'broadleaf');
    broadleaf.forEach(shape => { if (shape.list.length < broadleafTrees.length * 5) shape.list = new Float32Array(broadleafTrees.length * 10); });
    treesVersion = terrain.treesVersion;
  }
  // The broadleaf trees in view, by shape (new storage each frame, as the last set may still be
  // drawn from). (All of them, in view or not: the trees measured 2.5 ms of GPU at the usual
  // spot; in view only, 1.1.)
  for (const shape of broadleaf) shape.count = 0;
  for (const tree of broadleafTrees) {
    if (!boxInFrustum(planes, tree.x - TREE_BOX, tree.y - 1, tree.z - TREE_BOX, tree.x + TREE_BOX, tree.y + TREE_HEIGHT, tree.z + TREE_BOX)) continue;
    const look = broadleafLook(tree), shape = broadleaf[look.shape], o = 5 * shape.count++;
    shape.list[o] = tree.x; shape.list[o + 1] = tree.y; shape.list[o + 2] = tree.z; shape.list[o + 3] = look.angle; shape.list[o + 4] = look.scale;
  }
  for (const shape of broadleaf) {
    if (!shape.count) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, shape.instances);
    gl.bufferData(gl.ARRAY_BUFFER, shape.list.subarray(0, 5 * shape.count), gl.DYNAMIC_DRAW);
  }
  // One tree's model a frame at most (all at once, as a group came into reach, was a stutter: up
  // to 21 ms each in headless Chrome, before trees.js wrote them faster), or one asked of the worker
  // at a time: first, the nearest tree coming within TREE_DETAIL m that has only its far model, its
  // near one too; else the nearest newly found tree, its far model only. But after a jump, every
  // tree within SEEN m at once (near ones whole), here, in the one long frame where the picture
  // changes completely anyway: one a frame, nearest first, they sprang up round the car (until 3 Oct
  // 2026). And a newly found tree whose model came while it's in view, not deep in the mist, came
  // late and would be seen appearing: it's held back (not drawn) until it's out of view or beyond
  // SEEN (worked out the first time it could be drawn: below).
  if (jumped) {
    for (let tree = treesWaiting.pop(); tree; tree = treesWaiting.pop()) {
      const range = Math.hypot(tree.x - camera.x, tree.z - camera.z), slot = freeTreeSlot();
      if (range > SEEN || !slot) { treesWaiting.push(tree); break; }
      makeTree(slot, tree, range < TREE_DETAIL);
      slot.fresh = false;  // (seen at once: the whole picture's new)
    }
  }
  if (!treeAsked) {
    let detail = null;
    for (const slot of treeSlots) {
      if (!slot.tree || !slot.indices || slot.near || slot.asked) continue;
      const range = Math.hypot(slot.tree.x - camera.x, slot.tree.z - camera.z);
      if (range < TREE_DETAIL && (!detail || range < detail.range)) { detail = slot; detail.range = range; }
    }
    const free = detail ? null : treesWaiting.length ? freeTreeSlot() : null;  // (none: more than TREE_SLOTS near, the rest wait)
    if (detail) {
      if (treeWorker) askTree(detail, detail.tree, true); else makeTree(detail, detail.tree, true);
    } else if (free) {
      const tree = treesWaiting.pop();
      if (treeWorker) askTree(free, tree, false); else makeTree(free, tree, false);
    }
  }
  // The ground cover: when the chunks drawn change, or a tree comes or goes.
  let signature = terrain.drawCount;
  for (let d = 0; d < terrain.drawCount; d++) {
    const slot = terrain.slots[terrain.drawList[d]];
    signature = (signature * 31 + slot.index * 7 + slot.version) | 0;
  }
  // Which are late (see heldCopies), and which held back can now be let in: then (and after a
  // jump) gathered at once.
  drawFrame++;
  for (let d = 0; d < terrain.drawCount; d++) {
    const i = terrain.drawList[d], slot = terrain.slots[i];
    if (drawnIn[i] !== drawFrame - 1 || drawnVersion[i] !== slot.version) {
      const px = slot.cx >> 1, pz = slot.cz >> 1, parent = slot.level < DETAIL.length ? terrain.slotAt(slot.level + 1, px, pz) : null;
      lateSlots[i] = !jumped && parent !== null && parent.cx === px && parent.cz === pz && drawnIn[parent.index] === drawFrame - 1 ? 1 : 0;
    }
    drawnIn[i] = drawFrame; drawnVersion[i] = slot.version;
  }
  let natureNow = jumped;
  if (heldCopies.size) {
    for (const [key, held] of heldCopies) {
      if (copySeen(held[0], held[1], held[2], held[3])) continue;
      heldCopies.delete(key);
      natureDirty = natureNow = true;
    }
  }
  const natureMoved = Math.hypot(camera.x - gatherX, camera.z - gatherZ) > NATURE_MOVE;
  if ((natureDirty || natureMoved || signature !== natureSignature) && (natureNow || timeMs - natureAt > NATURE_REFRESH)) {
    gatherNature();
    natureDirty = false; natureSignature = signature; natureAt = timeMs;
  }
  frameData[16] = camera.x; frameData[17] = camera.y; frameData[18] = camera.z;
  frameData[35] = car.braking ? BRAKE_LIGHT : TAIL_LIGHT;
  frameData[36] = timeMs / 1000;
  turn = (turn + 1) % TURNS;
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, frameUbos[turn]);
  gl.bufferSubData(gl.UNIFORM_BUFFER, 0, frameData);  // one upload for all shaders
  bamboo.update(camera, planes, timeMs / 1000);
  const entries = bamboo.length;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, listTextures[turn]);
  if (entries) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LIST_WIDTH, Math.ceil(entries / LIST_WIDTH), gl.RG_INTEGER, gl.UNSIGNED_INT, bamboo.list);
  }
  gl.activeTexture(gl.TEXTURE0);

  // Colour and depth, even though most pixels get drawn over: Chrome clears the colour
  // buffer every frame anyway, so clearing only depth and drawing the sky last measured
  // slower (see NOTES.md).
  profiler?.begin(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  profiler?.end();

  // Car first: it's nearest, so the terrain pixels it covers fail the depth test
  // and are never shaded.
  gl.useProgram(carProgram);
  profiler?.begin(1);
  gl.bindTexture(gl.TEXTURE_2D, bodyTexture);
  gl.bindVertexArray(bodyVao);
  gl.uniformMatrix4fv(uModel, false, car.model);
  gl.drawElements(gl.TRIANGLES, bodyIndexCount, gl.UNSIGNED_SHORT, 0);
  // Wheels: each spun about its axle and moved to where its spring holds it; the front two
  // also steer.
  gl.bindTexture(gl.TEXTURE_2D, wheelTexture);
  gl.bindVertexArray(wheelVao);
  rotationY(steerMatrix, car.steerAngle);
  for (let i = 0; i < 4; i++) {
    const wheel = car.wheels[i];
    rotationX(spinMatrix, wheel.spin);
    if (wheel.front) multiply(spinMatrix, steerMatrix, spinMatrix);
    wheelOffset[12] = wheel.x; wheelOffset[13] = wheel.y; wheelOffset[14] = wheel.z;
    multiply(wheelLocal, wheelOffset, spinMatrix);
    multiply(wheelModel, car.model, wheelLocal);
    gl.uniformMatrix4fv(uModel, false, wheelModel);
    gl.drawElements(gl.TRIANGLES, wheelIndexCount, gl.UNSIGNED_SHORT, 0);
  }
  profiler?.end();

  // The bridges: few, and in front of the land under them.
  if (bridgeBuilt.indices) {
    gl.useProgram(builtProgram);
    gl.bindVertexArray(bridgeBuilt.vao);
    gl.drawElements(gl.TRIANGLES, bridgeBuilt.indices, bridgeBuilt.type, 0);
  }
  // The cherry and maple trees: both sides of the blossom's and leaves' cards.
  profiler?.begin(9);
  gl.useProgram(builtProgram);
  gl.disable(gl.CULL_FACE);
  // Those in view, nearest first (so the nearer hide what's behind them before it's shaded), each
  // its near model or, from TREE_LOD m, its far one.
  // (One held back: out of sight now, it's drawn from now on, as any other.)
  treesDrawn.length = 0;
  for (const slot of treeSlots) {
    const tree = slot.tree;
    if (!tree || !slot.indices) continue;
    const inView = treeInView(tree);
    slot.range = Math.hypot(tree.x - camera.x, tree.z - camera.z);
    if (slot.fresh) { slot.held = inView && slot.range < SEEN; slot.fresh = false; }
    if (slot.held) {
      if (inView && slot.range < SEEN) continue;
      slot.held = false;
    }
    if (!inView) continue;
    // Into place, nearest first (by insertion: a handful, and nothing made, as sort can).
    let k = treesDrawn.length;
    treesDrawn.push(slot);
    for (; k > 0 && treesDrawn[k - 1].range > slot.range; k--) treesDrawn[k] = treesDrawn[k - 1];
    treesDrawn[k] = slot;
  }
  for (const slot of treesDrawn) {
    gl.bindVertexArray(slot.vao);
    if (slot.range < TREE_LOD && slot.near) gl.drawElements(gl.TRIANGLES, slot.near, slot.type, 0);
    else gl.drawElements(gl.TRIANGLES, slot.indices - slot.near, slot.type, slot.near * slot.size);
  }
  gl.useProgram(treeProgram);
  for (const shape of broadleaf) {
    if (!shape.count) continue;
    gl.bindVertexArray(shape.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, shape.indices, gl.UNSIGNED_SHORT, 2 * shape.firstIndex, shape.count);
  }
  profiler?.end();
  // The ground cover: ferns, rocks, then bushes (both sides of the fronds and cards).
  profiler?.begin(10);
  gl.useProgram(natureProgram);
  natureView();
  for (const nk of natureKinds) {
    if (!nk.copies || !natureOn) continue;
    gl.uniform2f(natureUniforms.fade, nk.kind.fade[0], nk.kind.fade[1]);
    gl.uniform1f(natureUniforms.sway, nk.kind.sway);
    if (nk.kind.bloom) gl.uniform3fv(natureUniforms.bloom, nk.kind.bloom);
    gl.bindVertexArray(nk.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, nk.instances);
    for (let r = 0; r < natureRunCount; r++) {
      const from = nk.starts[natureRuns[2 * r]], count = nk.starts[natureRuns[2 * r + 1]] - from;
      if (!count) continue;
      // (WebGL2 can't start an instanced draw part way through: the copies' attributes moved instead.)
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, from * INSTANCE_FLOATS * 4);
      gl.vertexAttribPointer(5, 1, gl.FLOAT, false, INSTANCE_FLOATS * 4, (from * INSTANCE_FLOATS + 4) * 4);
      gl.drawElementsInstanced(gl.TRIANGLES, nk.indices, gl.UNSIGNED_SHORT, 2 * nk.firstIndex, count);
    }
  }
  profiler?.end();
  gl.enable(gl.CULL_FACE);

  // Bamboo stalks, nearest first: they hide much of the land behind them.
  gl.bindVertexArray(bambooVao);
  profiler?.begin(2);
  drawBamboo(stalkProgram, stalkUniforms, bambooModel.tube, bambooModel.line);
  profiler?.end();
  profiler?.count(3, bamboo.near);
  profiler?.count(4, bamboo.far);
  profiler?.count(5, bamboo.clumps);
  profiler?.count(6, bamboo.moving);

  // The bamboo's leaves (both sides of each card), then the far clumps: before the land, which the
  // leaves hide much of. Their pixels between the leaves are discarded, and the GPU can't know
  // which before shading them; but the land's pixels behind the rest still fail the depth test.
  // (Drawn after the land, measured 3% slower in all.)
  gl.disable(gl.CULL_FACE);
  profiler?.begin(4);
  drawBamboo(leavesProgram, leavesUniforms, bambooModel.cards, bambooModel.billboard);
  profiler?.end();
  gl.useProgram(clumpProgram);
  profiler?.begin(5);
  drawList(clumpUniforms, bambooModel.billboard, bamboo.clumpsFrom, bamboo.clumpsFrom + bamboo.clumps);
  profiler?.end();
  gl.enable(gl.CULL_FACE);

  // Terrain, nearest chunks first, for the same reason as the car: terrain.update listed them
  // in that order. Per visible chunk, 3 calls (bind its VAO, say where it is, draw).
  gl.useProgram(terrainProgram);
  profiler?.begin(3);
  let drawn = 0;
  for (let k = 0; k < terrain.drawCount; k++) {
    const i = terrain.drawList[k], chunk = terrain.slots[i];
    if (cull && !chunkVisible(chunk)) continue;
    gl.bindVertexArray(chunkVaos[i]);
    gl.uniform3f(uChunk, chunk.x, chunk.z, chunk.spacing);
    gl.drawElements(gl.TRIANGLES, terrain.indices.length, gl.UNSIGNED_SHORT, 0);
    drawn++;
  }
  profiler?.end();
  profiler?.count(0, drawn);

  // The rivers' water, over the land (and the bridges' piles) it's blended with; it hides nothing
  // behind it, so it doesn't write depth.
  let wet = 0;
  for (let k = 0; k < terrain.drawCount; k++) {
    const i = terrain.drawList[k], chunk = terrain.slots[i];
    if (!chunk.wet || (cull && !chunkVisible(chunk))) continue;
    if (!wet++) {
      gl.useProgram(waterProgram);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    gl.bindVertexArray(waterVaos[i]);
    gl.uniform3f(uWaterChunk, chunk.x, chunk.z, chunk.spacing);
    gl.drawElements(gl.TRIANGLES, WATER_INDICES, gl.UNSIGNED_SHORT, 0);
  }
  if (wet) {
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // Dust, smoke and water, then the rain: the depth test has the pixels already drawn in front of
  // them, so only those that show get shaded. The first frame has none yet, but draws one anyway,
  // of the buffer's zeros (no opacity: every pixel discarded): some browsers (Firefox's and Zen's
  // OpenGL on macOS) only finish making a program the first time it draws, and that's better done
  // behind the first picture than when the first dust or exhaust appears.
  profiler?.begin(6);
  if (particles.count || first) {
    gl.useProgram(particleProgram);
    gl.bindVertexArray(particleVaos[turn]);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffers[turn]);
    if (particles.count) gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.gpu, 0, particles.count * PARTICLE_FLOATS);
    gl.drawArrays(gl.POINTS, 0, Math.max(particles.count, 1));
  }
  profiler?.end();
  profiler?.count(2, particles.count);
  profiler?.begin(7);
  if (RAIN > 0) {
    gl.useProgram(rainProgram);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.LINES, 0, RAIN_DROPS * 2);
  }
  profiler?.end();

  // The sky, last, wherever nothing else was drawn: only those pixels pass the depth test.
  gl.useProgram(skyProgram);
  profiler?.begin(8);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  profiler?.end();

  profiler?.frameEnd();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

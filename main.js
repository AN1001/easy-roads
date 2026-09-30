import { loadProgram, loadTexture, createTextureArray } from './gl.js';
import { mat4, multiply, perspective, lookAt, frustumPlanes, boxInFrustum,
  translation, rotationX, rotationY } from './math.js';
import { createTerrain, VERTEX_SHORTS, STALK_FLOATS, CLUMP_FLOATS } from './terrain.js';
import { loadCarMeshes, createCar, placeCar, resetCar, updateCar, followTheRoad } from './car.js';
import { createTextures, createPuddles, puddleAt, TEXTURE_SIZE, TEXTURE_LAYERS, PUDDLE_SIZE } from './textures.js';
import { createBambooModel, createBamboo, LIST_WIDTH, LIST_ROWS, STALK_WIDTH } from './bamboo.js';
import { createParticles, updateParticles, kickUp, rainOnGround, MAX_PARTICLES, PARTICLE_FLOATS } from './particles.js';
import { createProfiler } from './profiler.js';

// Profiling options, e.g. ?profile&autodrive&size=3440x1440
//   profile: on-screen frame/GPU timings (window.profiler.report() for full stats)
//   autodrive: drive in circles without touching the keys, for repeatable measurements;
//     autodrive=road follows the road instead, so new terrain keeps being built
//   size: render at a fixed resolution instead of the window's
//   spawn=x,z: start on the road nearest that point, for measuring the same place each time
//   aa / nocull: turn antialiasing back on / chunk culling off, to measure what they cost
const params = new URLSearchParams(location.search);
const autodrive = params.has('autodrive');
const followRoad = params.get('autodrive') === 'road';
const fixedSize = params.get('size')?.split('x').map(Number);
const cull = !params.has('nocull');

const canvas = document.querySelector('canvas');
// No antialiasing (multisampling): measured to roughly halve the GPU cost per pixel,
// including clearing the screen. Edges get PS2-style jaggies instead.
const gl = canvas.getContext('webgl2', { antialias: params.has('aa') });

const profiler = params.has('profile')
  ? createProfiler(gl, ['clear', 'car', 'stalks', 'terrain', 'leaves', 'clumps', 'particles', 'rain', 'sky'],
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
  loadCarMeshes(),
  loadTexture(gl, 'assets/Car 03/car3_zen.png'),  // bench/livery.mjs --zen: car3.png's green, the bumper's brake light
  loadTexture(gl, 'assets/Wheel/wheel.png'),
]);
// The textures for the ground, the bamboo and the clouds, and the puddles, are made while those files load.
const texturesStart = performance.now();
const texturePixels = createTextures(), puddleTexels = createPuddles();
console.log(`textures: made in ${(performance.now() - texturesStart).toFixed(1)} ms`);
const [terrainProgram, carProgram, particleProgram, stalkProgram, leavesProgram, rainProgram, skyProgram,
  clumpProgram, carMeshes, bodyTexture, wheelTexture] = await loading;

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
// chunks are built, the coarser one stays; and any hole inside SEEN m (should the building ever
// fall that far behind) is filled at once, whatever the budget: beyond that the mist hides it
// (96% mist: sky.glsl's curve, solved for the distance).
const DETAIL = [100, 220];  // m
const AHEAD = 40;           // m
const BUILD_BUDGET = 1;     // ms
const SEEN = FOG_START - FOG_THICKNESS * Math.log(1 - 0.96 * (1 - Math.exp(-(FOG_END - FOG_START) / FOG_THICKNESS)));  // m
const terrain = createTerrain({ draw: FOG_END, ahead: AHEAD, detail: DETAIL });
// By default, the lane nearest (600, -330), near the middle of the world. Copied, since the next
// call to nearestRoad reuses the object it answers with.
const [spawnX, spawnZ] = params.get('spawn')?.split(',').map(Number) ?? [600, -330];
const spawn = { ...terrain.nearestRoad(spawnX, spawnZ) };
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
gl.activeTexture(gl.TEXTURE0);
for (const program of [terrainProgram, stalkProgram, leavesProgram, skyProgram]) {
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
const uModel = gl.getUniformLocation(carProgram, 'uModel');
const uPointScale = gl.getUniformLocation(particleProgram, 'uPointScale');

// --- Per-frame values shared by every shader: one Uniform Buffer Object (UBO), uploaded
// once per frame, instead of setting the same uniforms on each program separately ---

// Must match the `Frame` block in shaders/frame.glsl. std140 layout: mat4 + 6 × vec4
// (camera, fog, headlight position, headlight direction, tail lights, time).
const frameData = new Float32Array(40);
const viewProj = frameData.subarray(0, 16);  // the matrix maths writes straight into it
frameData[20] = FOG_START;
frameData[21] = FOG_END;
frameData[22] = FOG_THICKNESS;

// One for each turn: bound to binding point 0 in its turn.
const frameUbos = Array.from({ length: TURNS }, () => {
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, frameData.byteLength, gl.DYNAMIC_DRAW);
  return ubo;
});
for (const program of [terrainProgram, carProgram, particleProgram, stalkProgram, leavesProgram, rainProgram, skyProgram, clumpProgram]) {
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
placeCar(car, spawn.x, spawn.z, spawn.heading, terrain.heightAt);  // dropped onto a road

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
// and three times as bright braking, past what red can show (car.frag), when the brake light up the
// back window comes on too. They light nothing else.
const TAIL_BACK = 1.95;      // m behind the car's centre (its back bumper)
const TAIL_HEIGHT = 0.72;    // m above the ground
const TAIL_LIGHT = 1.0, BRAKE_LIGHT = 3.0;

// --- Input: keys currently held, by physical position (works on any keyboard layout) ---

const held = new Set();
addEventListener('keydown', e => {
  held.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();  // don't scroll the page
  if (e.code === 'KeyR' && !e.repeat) resetCar(car, terrain.heightAt);  // back on its wheels
  if (e.code === 'KeyT' && !e.repeat) {  // towed back to the nearest road, facing along it
    const road = terrain.nearestRoad(car.x, car.z);
    const heading = road.heading + (Math.cos(road.heading - car.heading) < 0 ? Math.PI : 0);
    placeCar(car, road.x, road.z, heading, terrain.heightAt);
    cut = true;
  }
  if (e.code === 'KeyF' && !e.repeat) {  // full screen: the canvas alone, not the whole page
    if (document.fullscreenElement) document.exitFullscreen();
    else canvas.requestFullscreen();
  }
});
addEventListener('keyup', e => held.delete(e.code));
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
    const scale = Math.max(1, Math.round(screen.height * devicePixelRatio / FULLSCREEN_ROWS));
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

// What particles.js asks about the ground under a tyre.
const ground = {
  roadDistanceAt: terrain.roadDistanceAt,
  edgeAt: terrain.edgeAt,
  puddleAt: (x, z) => puddleAt(puddleTexels, x, z),
};

// --- Game loop: the browser calls this before every screen refresh ---

let lastTime = -1;

function frame(timeMs) {
  profiler?.frameStart(timeMs);

  // Seconds since last frame, capped so a paused tab doesn't launch the car on return.
  const dt = lastTime < 0 ? 0 : Math.min((timeMs - lastTime) / 1000, 0.1);
  lastTime = timeMs;

  let throttle = autodrive || held.has('ArrowUp') || held.has('KeyW') ? 1 : 0;
  const brake = held.has('ArrowDown') || held.has('KeyS') ? 1 : 0;
  let steer = autodrive ? 0.5 : (held.has('ArrowLeft') || held.has('KeyA') ? 1 : 0)
                              - (held.has('ArrowRight') || held.has('KeyD') ? 1 : 0);
  if (followRoad) {
    followTheRoad(car, terrain.nearestRoad, autopilot);
    throttle = autopilot.throttle;
    steer = autopilot.steer;
  }
  const handbrake = held.has('Space') ? 1 : 0;
  updateCar(car, throttle, brake, handbrake, steer, dt, terrain.heightAt);
  const m = car.model;  // columns: side (0-2), up (4-6), forward (8-10), position (12-14)
  for (let k = 0; k < 3; k++) {
    lamp[k] = m[12 + k] + LAMP_FORWARD * m[8 + k] + LAMP_HEIGHT * m[4 + k];
    frameData[28 + k] = (m[8 + k] - LAMP_DIP * m[4 + k]) * LAMP_AIM;
    tail[k] = m[12 + k] - TAIL_BACK * m[8 + k] + TAIL_HEIGHT * m[4 + k];
  }
  bamboo.bend(tail, lamp, dt);
  updateParticles(particles, dt);
  kickUp(particles, car, throttle, dt, ground);
  rainOnGround(particles, car, dt, terrain.heightAt);

  // Camera eases towards a spot behind and above the car (or jumps there), and never dips into a hill.
  const ease = cut ? 1 : 1 - Math.exp(-dt * 4);
  const s = Math.sin(car.heading), c = Math.cos(car.heading);
  camera.x += (car.x - s * CAMERA_DISTANCE - camera.x) * ease;
  camera.z += (car.z - c * CAMERA_DISTANCE - camera.z) * ease;
  camera.y += (car.y + CAMERA_HEIGHT - camera.y) * ease;
  camera.y = Math.max(camera.y, terrain.heightAt(camera.x, camera.z) + 1.5);
  lookAt(view, camera.x, camera.y, camera.z, car.x, car.y + 1.2, car.z);

  // Build the chunks coming into range, and upload any that are finished. After a cut the whole
  // view is new, so it's all built at once, like at startup: one long frame (~40 ms) where the
  // picture changes completely anyway, rather than the land popping in around the car for 2 s.
  const rows = terrain.update(camera.x, camera.z, cut ? Infinity : BUILD_BUDGET, SEEN);
  cut = false;
  profiler?.count(1, rows);
  for (let i = 0; i < terrain.slots.length; i++) {
    const slot = terrain.slots[i];
    if (slot.version === uploadedVersion[i] || !slot.ready) continue;
    // New storage, rather than refilling what the slot's last chunk may still be drawn from.
    gl.bindBuffer(gl.ARRAY_BUFFER, chunkBuffers[i]);
    gl.bufferData(gl.ARRAY_BUFFER, slot.vertices, gl.DYNAMIC_DRAW);
    if (slot.stalkCount) uploadTexels(2, STALK_WIDTH, bamboo.stalkBase[i], slot.stalks, slot.stalkCount * STALK_FLOATS / 4);
    if (slot.stalks) bamboo.replant(i);
    if (slot.clumpCount) uploadTexels(3, clumpWidth, i * clumpWidth, slot.clumps, slot.clumpCount * CLUMP_FLOATS / 4);
    uploadedVersion[i] = slot.version;
  }
  multiply(viewProj, proj, view);
  frustumPlanes(planes, viewProj);
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

  // Dust, smoke and water, then the rain: the depth test has the pixels already drawn in front of
  // them, so only those that show get shaded.
  profiler?.begin(6);
  if (particles.count) {
    gl.useProgram(particleProgram);
    gl.bindVertexArray(particleVaos[turn]);
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffers[turn]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.gpu, 0, particles.count * PARTICLE_FLOATS);
    gl.drawArrays(gl.POINTS, 0, particles.count);
  }
  profiler?.end();
  profiler?.count(2, particles.count);
  gl.useProgram(rainProgram);
  gl.bindVertexArray(emptyVao);
  profiler?.begin(7);
  gl.drawArrays(gl.LINES, 0, RAIN_DROPS * 2);
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

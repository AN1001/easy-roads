// The game itself (main.js), frame by frame, in Node: all of a frame's JS, as in the browser, but
// drawing into a WebGL context that does nothing, with no page round it. For timing the JS a frame
// takes, to the µs, the same drive every time (no GPU, no other tabs, no rounded clock), and with
// `count`, counting its WebGL calls, draws, vertices and uploads (bench/count.js, as
// bench/headless.mjs does in the browser: it slows the JS, so time it without).
//
//   node bench/loop.mjs [frames] [query] [count|garbage|noworker]
//     frames:   how many to time, after as many again to warm up (default 1500)
//     query:    the page's (main.js), default 'autodrive=road'; e.g. 'autodrive=road&spawn=-1000,-400'
//     count:    count the WebGL work too
//     garbage:  where the garbage is made: the functions allocating the most, sampled (V8's sampling
//               heap profiler, counting what's collected again too)
//     noworker: no Worker, so the land's built on the main thread, as where a worker can't start
// The workers (terrain-worker.js, tree-worker.js) are played by this file: what main.js asks of them
// is made between frames, untimed, as if on another core, and comes back before the next.
//   node --cpu-prof bench/loop.mjs ...   also writes a CPU profile, to open in Chrome's DevTools
//
// Frames come every 1/60 s of the game's time, as fast as Node runs them. V8, as in Chrome: Firefox
// (Zen) runs the same JS slower, so compare one version with another, not with frame budgets.

import { readFileSync } from 'fs';
import { Session } from 'inspector/promises';
import { GCProfiler } from 'v8';

const [frameArg = 1500, query = 'autodrive=road', mode] = process.argv.slice(2), frames = Number(frameArg);
const ROOT = new URL('../', import.meta.url);

// --- A page, as little of one as main.js needs ---

const noop = () => {};
const element = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, append: noop, addEventListener: noop });
const canvas = { ...element(), width: 300, height: 150, getContext: () => gl, requestFullscreen: noop };
Object.assign(globalThis, {
  window: globalThis, location: { search: `?${query}`, reload: noop },
  document: { querySelector: () => canvas, createElement: element, body: element(), documentElement: element(), addEventListener: noop, hidden: false },
  screen: { width: 1440, height: 900 }, devicePixelRatio: 2, innerWidth: 1440, innerHeight: 900,
  addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
  createImageBitmap: async () => ({ width: 1, height: 1 }),
  fetch: async url => {
    const file = new URL(decodeURI(String(url)), ROOT);
    return { text: async () => readFileSync(file, 'utf8'), blob: async () => readFileSync(file), arrayBuffer: async () => readFileSync(file).buffer };
  },
});
let callback = null;
globalThis.requestAnimationFrame = f => { callback = f; return 1; };
const { newSlot, buildChunk, packChunk, CHUNK_BYTES } = await import(new URL('terrain.js', ROOT));
const { treeModel } = await import(new URL('trees.js', ROOT));
const workers = [];
if (mode !== 'noworker') {
  globalThis.Worker = class {
    constructor(url) { this.trees = String(url).endsWith('tree-worker.js'); this.slots = []; this.spares = []; this.asked = []; workers.push(this); }
    postMessage(data) { this.asked.push(data); }
    work() {  // the worker's onmessage, for each ask
      for (const data of this.asked.splice(0)) {
        if (this.trees) { this.onmessage({ data: { id: data.id, ...treeModel(data.tree, data.detailed) } }); continue; }
        if (data.spare) this.spares.push(data.spare);
        const slot = this.slots[data.level] ??= newSlot(0, data.level);
        buildChunk(slot, data.cx, data.cz);
        this.onmessage({ data: packChunk(slot, this.spares.pop() ?? new ArrayBuffer(CHUNK_BYTES)) });
      }
    }
  };
}

// --- WebGL 2 that does nothing: every method main.js may call, and the constants (their real
// values: bench/count.js tells types and formats apart by them) ---

const CONSTANTS = {
  DEPTH_BUFFER_BIT: 0x100, COLOR_BUFFER_BIT: 0x4000, POINTS: 0, LINES: 1, TRIANGLES: 4, SRC_ALPHA: 0x302, ONE_MINUS_SRC_ALPHA: 0x303,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, PIXEL_UNPACK_BUFFER: 0x88ec, UNIFORM_BUFFER: 0x8a11, COPY_READ_BUFFER: 0x8f36,
  COPY_WRITE_BUFFER: 0x8f37, STREAM_DRAW: 0x88e0, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8, CULL_FACE: 0xb44, BLEND: 0xbe2,
  DEPTH_TEST: 0xb71, LEQUAL: 0x203, BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404,
  UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140b, RED: 0x1903, RGB: 0x1907, RGBA: 0x1908, RG: 0x8227, RG_INTEGER: 0x8228,
  RED_INTEGER: 0x8d94, RGBA_INTEGER: 0x8d99, RGBA8: 0x8058, RG8: 0x822b, RGBA32F: 0x8814, RGBA16F: 0x881a, RG32UI: 0x823c,
  RGBA32UI: 0x8d70, R32F: 0x822e, FRAGMENT_SHADER: 0x8b30, VERTEX_SHADER: 0x8b31, LINK_STATUS: 0x8b82, NEAREST: 0x2600,
  LINEAR: 0x2601, NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703, TEXTURE_MAG_FILTER: 0x2800, TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, CLAMP_TO_EDGE: 0x812f, TEXTURE_2D: 0xde1, TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE0: 0x84c0, TEXTURE1: 0x84c1, TEXTURE2: 0x84c2, TEXTURE3: 0x84c3, TEXTURE4: 0x84c4, TEXTURE5: 0x84c5, TEXTURE6: 0x84c6,
  TEXTURE7: 0x84c7, QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867, SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911a,
  CONDITION_SATISFIED: 0x911c, SYNC_FLUSH_COMMANDS_BIT: 0x1, TIMEOUT_EXPIRED: 0x911b, WAIT_FAILED: 0x911d,
};
const RETURNS = {
  getProgramParameter: () => true, getShaderParameter: () => true, getUniformLocation: () => ({}), getUniformBlockIndex: () => 0,
  getExtension: () => null, getParameter: () => 0, getShaderInfoLog: () => '', getProgramInfoLog: () => '', getError: () => 0,
  getQueryParameter: () => 0, getAttribLocation: () => 0, isContextLost: () => false, clientWaitSync: () => CONSTANTS.ALREADY_SIGNALED,
  getSyncParameter: () => 0x9119,
};
const METHODS = ['activeTexture', 'attachShader', 'beginQuery', 'bindBuffer', 'bindBufferBase', 'bindBufferRange', 'bindTexture',
  'bindFramebuffer', 'bindRenderbuffer', 'blitFramebuffer', 'createFramebuffer', 'createRenderbuffer', 'framebufferRenderbuffer',
  'framebufferTexture2D', 'renderbufferStorageMultisample', 'bindVertexArray', 'blendFunc', 'bufferData', 'bufferSubData', 'clear', 'clearColor', 'clientWaitSync', 'colorMask', 'compileShader',
  'copyBufferSubData', 'createBuffer', 'createProgram', 'createQuery', 'createShader', 'createTexture', 'createVertexArray', 'deleteBuffer',
  'deleteQuery', 'deleteSync', 'deleteTexture', 'deleteVertexArray', 'depthFunc', 'depthMask', 'disable', 'disableVertexAttribArray',
  'drawArrays', 'drawArraysInstanced', 'drawElements', 'drawElementsInstanced', 'drawRangeElements', 'enable', 'enableVertexAttribArray',
  'endQuery', 'fenceSync', 'flush', 'generateMipmap', 'getAttribLocation', 'getBufferSubData', 'getError', 'getExtension', 'getParameter',
  'getProgramInfoLog', 'getProgramParameter', 'getQueryParameter', 'getShaderInfoLog', 'getShaderParameter', 'getSyncParameter',
  'getUniformBlockIndex', 'getUniformLocation', 'isContextLost', 'linkProgram', 'pixelStorei', 'shaderSource', 'texImage2D', 'texImage3D',
  'texParameterf', 'texParameteri', 'texStorage2D', 'texStorage3D', 'texSubImage2D', 'texSubImage3D', 'uniform1f', 'uniform1fv',
  'uniform1i', 'uniform1iv', 'uniform2f', 'uniform2fv', 'uniform2i', 'uniform3f', 'uniform3fv', 'uniform4f', 'uniform4fv', 'uniform4i',
  'uniformBlockBinding', 'uniformMatrix4fv', 'useProgram', 'vertexAttribDivisor', 'vertexAttribIPointer', 'vertexAttribPointer', 'viewport'];
class WebGL2RenderingContext {}
Object.assign(WebGL2RenderingContext, CONSTANTS);
Object.assign(WebGL2RenderingContext.prototype, CONSTANTS);
for (const name of METHODS) WebGL2RenderingContext.prototype[name] = RETURNS[name] ?? (name.startsWith('create') || name === 'fenceSync' ? () => ({}) : noop);
globalThis.WebGL2RenderingContext = WebGL2RenderingContext;
if (mode === 'count') (0, eval)(readFileSync(new URL('count.js', import.meta.url), 'utf8'));
const gl = new WebGL2RenderingContext();
gl.canvas = canvas;

// --- The game ---

const started = performance.now();
await import(new URL('main.js', ROOT));
console.log(`startup ${(performance.now() - started).toFixed(0)} ms`);

const session = new Session();
if (mode === 'garbage') session.connect();
const gc = new GCProfiler();
const times = new Float64Array(frames);
for (let f = 0, time = 0; f < 2 * frames; f++, time += 1000 / 60) {
  if (f === frames) {
    gc.start();
    globalThis.__counts?.reset();
    if (mode === 'garbage') {
      await session.post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    }
  }
  const run = callback, start = performance.now();
  run(time);
  if (f >= frames) times[f - frames] = performance.now() - start;
  for (const worker of workers) worker.work();
}
const { statistics } = gc.stop();
const sorted = Array.from(times).sort((a, b) => a - b), mean = sorted.reduce((s, t) => s + t, 0) / frames;
const at = q => sorted[Math.min(frames - 1, Math.floor(q * frames))].toFixed(3);
console.log(`${query}: ${frames} frames, JS ms a frame: mean ${mean.toFixed(3)}, p50 ${at(0.5)}, p90 ${at(0.9)}, p99 ${at(0.99)}, max ${at(1)}`);
// Garbage: what the collections found dead, all told (each minor one empties the young generation).
const minor = statistics.filter(s => s.gcType === 'Scavenge'), freed = statistics.reduce((sum, s) => sum + s.beforeGC.heapStatistics.usedHeapSize - s.afterGC.heapStatistics.usedHeapSize, 0);
console.log(`  garbage: ${(freed / frames / 1024).toFixed(1)} KB a frame; ${statistics.length} collections (${minor.length} minor), ${(statistics.reduce((sum, s) => sum + s.cost, 0) / 1000 / frames).toFixed(3)} ms a frame`);
if (mode === 'garbage') {
  const { profile } = await session.post('HeapProfiler.stopSampling');
  const self = new Map();
  const walk = node => {
    const { functionName, url, lineNumber } = node.callFrame;
    const name = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + node.selfSize);
    node.children.forEach(walk);
  };
  walk(profile.head);
  for (const [name, bytes] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(bytes / frames / 1024).toFixed(2).padStart(8)} KB a frame  ${name}`);
}
if (globalThis.__counts) console.log(JSON.stringify(globalThis.__counts.report(), null, 1));

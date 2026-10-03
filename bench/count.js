// Counts the game's GPU work, frame by frame, without a GPU timer: every WebGL call, the draws, the
// vertices and copies they draw, and the bytes uploaded. bench/headless.mjs injects it before the
// page's own scripts (`"count": true` on its command line; see there), and reads
// `window.__counts.report()`. It wraps every WebGL 2 call, which slows the page's JS: time JS in a
// run without it.
//
// Per frame (a frame ends when a requestAnimationFrame callback that made WebGL calls returns: the
// game's, not a bench's own): `calls`, every
// gl.* call; `draws`; `indices` (indexed draws' indices, × copies); `vertices`, the vertex shader's
// runs if every vertex an indexed draw names were shaded once (a perfect cache: the least it can
// be; drawArrays' are all shaded); `copies` (instanced draws' instances); `uploaded`, bytes sent
// from JS (bufferData / bufferSubData / texSubImage / texImage from arrays: what a pixel buffer
// then copies into a texture isn't counted again). And the same per program, named by its
// vertex shader (`programs`).

(() => {
  const proto = WebGL2RenderingContext.prototype;
  const NAMES = [[/built of blocks/, 'built'], [/Car body/, 'car'], [/clump of bamboo/, 'clump'], [/stalk's leaves/, 'leaves'],
    [/ground cover/, 'nature'], [/Dust, smoke/, 'particles'], [/^\/\/ Rain/m, 'rain'], [/The sky/, 'sky'], [/A bamboo stalk:/, 'stalk'],
    [/terrain vertex/, 'terrain'], [/broadleaf/, 'tree'], [/rivers' water/, 'water']];
  const sources = new WeakMap(), attached = new WeakMap(), names = new WeakMap();
  const vaoIndices = new Map();  // VAO (null: the default one) -> its index buffer
  const indexData = new WeakMap();  // index buffer -> a copy of its indices
  const uniqueCache = new Map();  // "buffer id:offset:count" -> unique vertices
  const bufferIds = new WeakMap();
  let nextId = 1, vao = null, program = null;
  const counts = () => ({ calls: 0, draws: 0, indices: 0, vertices: 0, copies: 0, uploaded: 0 });
  let frame = counts(), programs = new Map();
  const frames = [];

  const bytesPer = { [WebGL2RenderingContext.UNSIGNED_BYTE]: 1, [WebGL2RenderingContext.UNSIGNED_SHORT]: 2,
    [WebGL2RenderingContext.SHORT]: 2, [WebGL2RenderingContext.UNSIGNED_INT]: 4, [WebGL2RenderingContext.INT]: 4,
    [WebGL2RenderingContext.FLOAT]: 4 };
  const channels = { [WebGL2RenderingContext.RGBA]: 4, [WebGL2RenderingContext.RGBA_INTEGER]: 4, [WebGL2RenderingContext.RG]: 2,
    [WebGL2RenderingContext.RG_INTEGER]: 2, [WebGL2RenderingContext.RED]: 1, [WebGL2RenderingContext.RED_INTEGER]: 1,
    [WebGL2RenderingContext.RGB]: 3 };

  function perProgram() {
    const name = program ? names.get(program) ?? '?' : 'none';
    let p = programs.get(name);
    if (!p) programs.set(name, p = counts());
    return p;
  }
  function drew(indices, vertices, copies) {
    for (const c of [frame, perProgram()]) { c.draws++; c.indices += indices; c.vertices += vertices; c.copies += copies; }
  }
  // (Uploads belong to the frame, not to whichever program is bound.)
  function uploaded(bytes) { frame.uploaded += bytes; }
  // The unique vertices among `count` indices of `type` from byte `offset` of the bound index buffer.
  function unique(count, type, offset) {
    const buffer = vaoIndices.get(vao), data = buffer && indexData.get(buffer);
    if (!data) return count;
    const key = `${bufferIds.get(buffer)}:${offset}:${count}:${type}`;
    let n = uniqueCache.get(key);
    if (n === undefined) {
      const view = type === WebGL2RenderingContext.UNSIGNED_INT ? new Uint32Array(data.buffer, data.byteOffset + offset, count)
        : type === WebGL2RenderingContext.UNSIGNED_SHORT ? new Uint16Array(data.buffer, data.byteOffset + offset, count)
          : new Uint8Array(data.buffer, data.byteOffset + offset, count);
      n = new Set(view).size;
      uniqueCache.set(key, n);
    }
    return n;
  }

  for (const key of Object.getOwnPropertyNames(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (typeof descriptor.value !== 'function' || key === 'constructor') continue;
    const original = descriptor.value;
    proto[key] = function (...args) { frame.calls++; perProgram().calls++; return original.apply(this, args); };
  }
  const wrap = (key, before) => {
    const inner = proto[key];
    proto[key] = function (...args) { before.apply(this, args); return inner.apply(this, args); };
  };
  wrap('shaderSource', (shader, source) => sources.set(shader, source));
  wrap('attachShader', (p, shader) => { if (!attached.has(p)) attached.set(p, []); attached.get(p).push(shader); });
  wrap('linkProgram', p => {
    const source = (attached.get(p) ?? []).map(s => sources.get(s) ?? '').find(s => /gl_Position/.test(s)) ?? '';
    const head = source.split('\n').slice(0, 3).join('\n');
    names.set(p, NAMES.find(([pattern]) => pattern.test(head))?.[1] ?? head.slice(0, 40));
  });
  wrap('useProgram', p => { program = p; });
  wrap('bindVertexArray', v => { vao = v; });
  wrap('bindBuffer', (target, buffer) => {
    if (buffer && !bufferIds.has(buffer)) bufferIds.set(buffer, nextId++);
    if (target === WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER) vaoIndices.set(vao, buffer);
  });
  wrap('bufferData', function (target, data, usage, srcOffset = 0, length = 0) {
    if (typeof data === 'number' || !data) return;
    const size = data.BYTES_PER_ELEMENT ?? 1, bytes = length ? length * size : data.byteLength - srcOffset * size;
    uploaded(bytes);
    if (target === WebGL2RenderingContext.ELEMENT_ARRAY_BUFFER) {
      const buffer = vaoIndices.get(vao);
      if (buffer) {
        indexData.set(buffer, new Uint8Array(data.buffer.slice(data.byteOffset + srcOffset * size, data.byteOffset + srcOffset * size + bytes)));
        for (const k of uniqueCache.keys()) if (k.startsWith(`${bufferIds.get(buffer)}:`)) uniqueCache.delete(k);
      }
    }
  });
  wrap('bufferSubData', (target, offset, data, srcOffset = 0, length = 0) => {
    const size = data.BYTES_PER_ELEMENT ?? 1;
    uploaded(length ? length * size : data.byteLength - srcOffset * size);
  });
  wrap('texSubImage2D', (target, level, x, y, width, height, format, type, pixels) => {
    if (typeof pixels === 'object' && pixels && 'BYTES_PER_ELEMENT' in pixels) uploaded(width * height * (channels[format] ?? 4) * (bytesPer[type] ?? 1));
  });
  wrap('drawArrays', (mode, first, count) => drew(0, count, 0));
  wrap('drawElements', (mode, count, type, offset) => drew(count, unique(count, type, offset), 0));
  wrap('drawArraysInstanced', (mode, first, count, copies) => drew(0, count * copies, copies));
  wrap('drawElementsInstanced', (mode, count, type, offset, copies) => drew(count * copies, unique(count, type, offset) * copies, copies));

  // Frame boundaries: each of the game's frames is one requestAnimationFrame callback.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => raf(time => {
    callback(time);
    if (!frame.calls) return;
    frames.push({ ...frame, programs });
    if (frames.length > 4000) frames.shift();
    frame = counts(); programs = new Map();
  });

  window.__counts = {
    // Means per frame over the last `last` frames (all, if not given), and per program.
    report(last = frames.length) {
      const from = frames.slice(-last), mean = {}, byProgram = {};
      for (const key of Object.keys(counts())) mean[key] = Math.round(from.reduce((s, f) => s + f[key], 0) / from.length);
      for (const f of from) {
        for (const [name, c] of f.programs) {
          byProgram[name] ??= counts();
          for (const key of Object.keys(c)) byProgram[name][key] += c[key] / from.length;
        }
      }
      for (const c of Object.values(byProgram)) for (const key of Object.keys(c)) c[key] = Math.round(c[key]);
      return { frames: from.length, perFrame: mean, programs: byProgram };
    },
    reset() { frames.length = 0; },
  };
})();

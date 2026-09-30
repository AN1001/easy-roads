// Frame-pacing profile for the cube scene.
//
// Runs the scene under several settings, one after another, and reports for each:
// how evenly frames arrive (worst case included), time spent in our JS, how late the
// browser started our frame, and GPU time from timer queries. It also measures what
// individual WebGL calls cost.
//
// Open http://localhost:8001/bench/frames.html and leave the machine alone until the
// results table appears (about 3 minutes). Add ?seconds=40 to record longer per setting,
// and ?only=2 to run just one setting (numbered from 0 in the list below).

import { loadProgram } from '../gl.js';
import { mat4, multiply, perspective, translation, rotationX, rotationY } from '../math.js';

const params = new URLSearchParams(location.search);
const RUN_MS = (Number(params.get('seconds')) || 20) * 1000;
const WARMUP_MS = 2000;
const MAX_FRAMES = 1 << 14;

const SETTINGS = [
  { name: 'Empty loop, no WebGL', webgl: false },
  { name: 'Clear only, window size', drawCube: false },
  { name: 'Game as-is, window size' },
  { name: 'Game, 3440x1440', size: [3440, 1440] },
  { name: 'Game, 3440x1440, antialias off', size: [3440, 1440], attrs: { antialias: false } },
  { name: 'Game, 3440x1440, alpha off', size: [3440, 1440], attrs: { alpha: false } },
  { name: 'Game, 3440x1440, AA + alpha off', size: [3440, 1440], attrs: { antialias: false, alpha: false } },
  { name: 'Game, 1720x720, AA + alpha off', size: [1720, 720], attrs: { antialias: false, alpha: false } },
];
const settings = params.has('only') ? [SETTINGS[Number(params.get('only'))]] : SETTINGS;

const status = document.getElementById('status');

// --- Sample buffers: preallocated, so recording creates no garbage ---

const frameTimes = new Float64Array(MAX_FRAMES);  // rAF timestamp of each frame
const jsTimes = new Float64Array(MAX_FRAMES);     // ms spent in our frame code
const lateness = new Float64Array(MAX_FRAMES);    // ms between frame start and our code running
const gpuTimes = new Float64Array(MAX_FRAMES);    // ms of GPU work, NaN if not measured

// Main-thread blocks of 50 ms+, as reported by the browser.
const longFrames = [];
new PerformanceObserver(list => {
  for (const e of list.getEntries()) longFrames.push({ start: e.startTime, ms: e.duration });
}).observe({ type: 'long-animation-frame' });

// --- The same cube as main.js ---

async function createCube(gl, drawCube) {
  const program = await loadProgram(gl, '../shaders/cube.vert', '../shaders/cube.frag');
  gl.useProgram(program);

  const corners = new Int8Array([
    -1, -1, -1,   1, -1, -1,   1,  1, -1,  -1,  1, -1,
    -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,
  ]);
  const indices = new Uint8Array([
    4, 5, 6,  4, 6, 7,   1, 0, 3,  1, 3, 2,   5, 1, 2,  5, 2, 6,
    0, 4, 7,  0, 7, 3,   7, 6, 2,  7, 2, 3,   0, 1, 5,  0, 5, 4,
  ]);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.BYTE, false, 0, 0);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const proj = perspective(mat4(), Math.PI / 4, gl.canvas.width / gl.canvas.height, 0.1, 100);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProj'), false, proj);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 1);

  const model = mat4(), rotX = mat4(), rotY = mat4();
  const pushBack = translation(mat4(), 0, 0, -5);

  return function render(timeMs) {
    const t = timeMs / 1000;
    rotationX(rotX, t * 0.7);
    rotationY(rotY, t);
    multiply(model, rotX, rotY);
    multiply(model, pushBack, model);
    gl.uniformMatrix4fv(uModel, false, model);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (drawCube) gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_BYTE, 0);
  };
}

// --- GPU timing: timer queries, whose results arrive a few frames later without stalling ---

function createGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const SLOTS = 8;
  const queries = [];
  for (let i = 0; i < SLOTS; i++) queries.push(gl.createQuery());
  const frameOf = new Int32Array(SLOTS).fill(-1);  // frame each query measured, -1 = free

  return {
    begin(frame) {
      const slot = frame % SLOTS;
      if (frameOf[slot] >= 0) return false;  // previous result not back yet: skip this frame
      gl.beginQuery(ext.TIME_ELAPSED_EXT, queries[slot]);
      frameOf[slot] = frame;
      return true;
    },
    end() {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
    },
    collect() {
      for (let i = 0; i < SLOTS; i++) {
        if (frameOf[i] < 0 || !gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) continue;
        gpuTimes[frameOf[i]] = gl.getQueryParameter(queries[i], gl.QUERY_RESULT) / 1e6;
        frameOf[i] = -1;
      }
    },
    pending() {
      for (let i = 0; i < SLOTS; i++) if (frameOf[i] >= 0) return true;
      return false;
    },
    // True if the GPU changed clocks/state since the last call, making timings unreliable.
    disjoint() {
      return gl.getParameter(ext.GPU_DISJOINT_EXT);
    },
  };
}

// --- Recording ---

function record(render, gpu) {
  return new Promise(resolve => {
    let start = -1, n = 0, drainFrames = 0;
    function frame(now) {
      if (start < 0) start = now;
      const elapsed = now - start;
      if (elapsed < WARMUP_MS + RUN_MS && n < MAX_FRAMES) {
        const recording = elapsed >= WARMUP_MS;
        const timed = recording && gpu !== null && gpu.begin(n);
        const t0 = performance.now();
        if (render) render(now);
        const t1 = performance.now();
        if (timed) gpu.end();
        if (recording) {
          frameTimes[n] = now;
          jsTimes[n] = t1 - t0;
          lateness[n] = t0 - now;
          n++;
        }
        if (gpu) gpu.collect();
        requestAnimationFrame(frame);
      } else if (gpu && gpu.pending() && drainFrames++ < 30) {
        gpu.collect();  // wait for the last timer queries
        requestAnimationFrame(frame);
      } else {
        resolve(n);
      }
    }
    requestAnimationFrame(frame);
  });
}

function addCanvas(size) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  canvas.width = size ? size[0] : canvas.clientWidth;
  canvas.height = size ? size[1] : canvas.clientHeight;
  return canvas;
}

function removeCanvas(canvas, gl) {
  if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (canvas) canvas.remove();
}

async function profile(setting) {
  let canvas = null, gl = null, render = null, gpu = null;
  if (setting.webgl !== false) {
    canvas = addCanvas(setting.size);
    gl = canvas.getContext('webgl2', setting.attrs);
    render = await createCube(gl, setting.drawCube !== false);
    gpu = createGpuTimer(gl);
    gpu?.disjoint();  // reading the flag clears it
  }
  gpuTimes.fill(NaN);
  const n = await record(render, gpu);
  const disjoint = gpu ? gpu.disjoint() : false;
  removeCanvas(canvas, gl);
  return summarize(setting, n, disjoint, canvas);
}

// --- Statistics (allocating is fine here: recording has finished) ---

function stats(values) {
  const sorted = values.filter(v => !Number.isNaN(v)).sort();
  if (sorted.length === 0) return null;
  let sum = 0;
  for (const v of sorted) sum += v;
  const at = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { mean: sum / sorted.length, p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1] };
}

function summarize(setting, n, disjoint, canvas) {
  const intervals = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) intervals[i - 1] = frameTimes[i] - frameTimes[i - 1];
  const interval = stats(intervals);
  const period = interval.p50;  // the display's refresh interval

  // A frame is dropped when it arrives 1.5+ refresh intervals after the previous one.
  const drops = [];
  let missed = 0, onTimeSum = 0, onTimeSq = 0, onTime = 0;
  for (let i = 1; i < n; i++) {
    const d = frameTimes[i] - frameTimes[i - 1];
    if (d > period * 1.5) {
      missed += Math.round(d / period) - 1;
      drops.push({
        at: Math.round(performance.timeOrigin + frameTimes[i]),  // wall clock, to match system samples
        ms: d,
        prevJs: jsTimes[i - 1],
        prevGpu: gpuTimes[i - 1],
        late: lateness[i],
      });
    } else {
      onTimeSum += d; onTimeSq += d * d; onTime++;
    }
  }
  const mean = onTimeSum / onTime;
  const start = frameTimes[0], end = frameTimes[n - 1];
  return {
    name: setting.name,
    size: canvas ? `${canvas.width}x${canvas.height}` : '-',
    frames: n,
    seconds: (end - start) / 1000,
    fps: (n - 1) / ((end - start) / 1000),
    periodMs: period,
    interval,
    jitterMs: Math.sqrt(Math.max(0, onTimeSq / onTime - mean * mean)),
    dropped: drops.length,
    missedRefreshes: missed,
    worstDrops: drops.sort((a, b) => b.ms - a.ms).slice(0, 8),
    js: stats(jsTimes.subarray(0, n)),
    late: stats(lateness.subarray(0, n)),
    gpu: stats(gpuTimes.subarray(0, n)),
    gpuDisjoint: disjoint,
    longFrames: longFrames.filter(f => f.start >= start && f.start <= end),
    wallStart: Math.round(performance.timeOrigin + start),
    wallEnd: Math.round(performance.timeOrigin + end),
  };
}

// --- Cost of individual calls ---

async function measureCallCosts() {
  const canvas = addCanvas();
  const gl = canvas.getContext('webgl2');
  await createCube(gl, true);
  gl.viewport(0, 0, 1, 1);  // 1 pixel, so draws measure submission cost, not shading
  const uModel = gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM), 'uModel');
  const m = mat4(), rx = mat4(), ry = mat4(), back = translation(mat4(), 0, 0, -5);

  const tests = [
    ['Frame maths (2 rotations, 2 multiplies)', 200_000, n => {
      for (let i = 0; i < n; i++) { rotationX(rx, i); rotationY(ry, i); multiply(m, rx, ry); multiply(m, back, m); }
    }],
    ['new Float32Array(16)', 1_000_000, n => {
      let s = 0;
      for (let i = 0; i < n; i++) s += new Float32Array(16).length;
      return s;
    }],
    ['gl.uniformMatrix4fv', 200_000, n => { for (let i = 0; i < n; i++) gl.uniformMatrix4fv(uModel, false, m); }],
    ['gl.drawElements (cube)', 20_000, n => { for (let i = 0; i < n; i++) gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_BYTE, 0); }],
    ['gl.getError (waits for GPU process)', 2_000, n => { for (let i = 0; i < n; i++) gl.getError(); }],
  ];

  const results = [];
  for (const [label, count, fn] of tests) {
    fn(Math.ceil(count / 10));  // warm up so V8 optimises it first
    gl.finish();
    const t0 = performance.now();
    fn(count);
    const ms = performance.now() - t0;
    gl.finish();
    results.push({ label, ns: ms * 1e6 / count });
  }
  removeCanvas(canvas, gl);
  return results;
}

function timerResolution() {
  let smallest = Infinity;
  for (let i = 0; i < 50; i++) {
    const a = performance.now();
    let b = a;
    while (b === a) b = performance.now();
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}

// --- Output ---

const f = (v, digits = 2) => (v === undefined || v === null || Number.isNaN(v) ? '-' : v.toFixed(digits));

function report(env, calls, runs) {
  const lines = [];
  lines.push(`${env.browser} | ${env.renderer}`);
  lines.push(`window ${env.window} @${env.dpr}x | timer resolution ${f(env.timerMs, 3)} ms`, '');
  lines.push('CALL COSTS');
  for (const c of calls) lines.push(`  ${c.label.padEnd(42)} ${f(c.ns, 0).padStart(9)} ns`);
  lines.push('', 'FRAMES (ms)                            fps   p50   p99   max  dropped  jitter  js avg/max  late p99/max  gpu avg/p99/max');
  for (const r of runs) {
    lines.push(
      `  ${r.name.padEnd(34)}` +
      `${f(r.fps, 1).padStart(6)}${f(r.interval.p50, 1).padStart(6)}${f(r.interval.p99, 1).padStart(6)}${f(r.interval.max, 1).padStart(6)}` +
      `${String(r.dropped).padStart(9)}${f(r.jitterMs).padStart(8)}` +
      `  ${f(r.js?.mean, 3)}/${f(r.js?.max)}`.padEnd(14) +
      `  ${f(r.late?.p99)}/${f(r.late?.max)}`.padEnd(14) +
      `  ${f(r.gpu?.mean, 3)}/${f(r.gpu?.p99, 3)}/${f(r.gpu?.max, 3)}${r.gpuDisjoint ? ' (disjoint!)' : ''}`
    );
  }
  return lines.join('\n');
}

// --- Run everything ---

const probe = document.createElement('canvas').getContext('webgl2');
const info = probe.getExtension('WEBGL_debug_renderer_info');
const env = {
  when: new Date().toISOString(),
  browser: (navigator.userAgent.match(/(Chrome|Firefox|Version)\/[\d.]+/g) || []).join(' '),
  renderer: info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : probe.getParameter(probe.RENDERER),
  window: `${innerWidth}x${innerHeight}`,
  dpr: devicePixelRatio,
  timerMs: timerResolution(),
};
probe.getExtension('WEBGL_lose_context')?.loseContext();

status.textContent = 'Measuring call costs…';
const calls = await measureCallCosts();

const runs = [];
for (let i = 0; i < settings.length; i++) {
  status.textContent = `Recording ${i + 1}/${settings.length}: ${settings[i].name}\nDon't touch anything.`;
  runs.push(await profile(settings[i]));
}

status.textContent = report(env, calls, runs);
document.body.style.overflow = 'auto';
window.profile = { env, calls, runs };
console.log(JSON.stringify(window.profile));

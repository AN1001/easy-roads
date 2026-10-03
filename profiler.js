// Opt-in frame profiler: add ?profile to the URL.
//
// Records every frame into preallocated arrays (no garbage while running): the gap since
// the previous frame, our JS time, GPU time for each named pass via timer queries, and
// any named counters (e.g. chunks drawn).
// Shows a one-line summary once a second; window.profiler.report() gives full stats.

const FRAMES = 1 << 13;  // ring buffer: the last ~160 s at 50 fps
const SLOTS = 8;         // frames of timer queries in flight (results arrive a few frames late)

export function createProfiler(gl, passNames, counterNames = []) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const P = passNames.length, C = counterNames.length;
  const intervals = new Float32Array(FRAMES).fill(NaN);
  const jsTimes = new Float32Array(FRAMES).fill(NaN);
  const gpuTimes = new Float32Array(FRAMES * P).fill(NaN);
  const counters = new Float32Array(FRAMES * C).fill(NaN);
  const queries = [];
  if (ext) for (let i = 0; i < SLOTS * P; i++) queries.push(gl.createQuery());
  const slotFrame = new Int32Array(SLOTS).fill(-1);  // frame each query slot is timing
  const slotInvalid = new Uint8Array(SLOTS);          // 1 = GPU was disjoint while it was timing

  let frame = -1, lastTime = -1, start = 0, timing = false, nextOverlay = 0, discarded = 0;

  const overlay = document.createElement('pre');
  // Light text on a dark box: readable over the pale sky and the dark land alike.
  overlay.style.cssText = 'position:fixed;top:0;left:0;margin:8px;padding:4px 6px;background:rgba(0,0,0,0.5);color:#ccc;font:11px/1.4 ui-monospace,Menlo,monospace;pointer-events:none';
  document.body.append(overlay);

  // Read finished timer queries. Never waits: unfinished ones are checked next frame.
  function collect() {
    // "Disjoint": the GPU changed clock or power state, so any timing in flight is
    // meaningless. Reading the flag clears it (measured 0.2 µs: no GPU round trip).
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (let slot = 0; slot < SLOTS; slot++) if (slotFrame[slot] >= 0) slotInvalid[slot] = 1;
    }
    for (let slot = 0; slot < SLOTS; slot++) {
      const f = slotFrame[slot];
      if (f < 0) continue;
      const base = slot * P;
      if (!gl.getQueryParameter(queries[base + P - 1], gl.QUERY_RESULT_AVAILABLE)) continue;
      if (slotInvalid[slot]) {
        discarded++;  // leave this frame's GPU times as NaN
      } else {
        for (let p = 0; p < P; p++) {
          gpuTimes[(f % FRAMES) * P + p] = gl.getQueryParameter(queries[base + p], gl.QUERY_RESULT) / 1e6;
        }
      }
      slotInvalid[slot] = 0;
      slotFrame[slot] = -1;
    }
  }

  function updateOverlay(now) {
    let worst = 0, gapSum = 0, gapN = 0, jsSum = 0, jsN = 0, jsMax = 0;
    const gpuSum = new Float64Array(P), gpuN = new Float64Array(P);
    for (let k = 0; k <= frame && k < 50; k++) {
      const i = (frame - k) % FRAMES;
      if (!Number.isNaN(intervals[i])) { worst = Math.max(worst, intervals[i]); gapSum += intervals[i]; gapN++; }
      if (!Number.isNaN(jsTimes[i])) { jsSum += jsTimes[i]; jsN++; jsMax = Math.max(jsMax, jsTimes[i]); }
      for (let p = 0; p < P; p++) {
        const g = gpuTimes[i * P + p];
        if (!Number.isNaN(g)) { gpuSum[p] += g; gpuN[p]++; }
      }
    }
    // Late frames in the last 10 s: shown a refresh (or more) later than the usual gap, the 50
    // frames' shortest (so a steady rate of late frames doesn't become the usual).
    let usual = Infinity, late = 0;
    for (let k = 0; k <= frame && k < 50; k++) {
      const gap = intervals[(frame - k) % FRAMES];
      if (gap < usual) usual = gap;
    }
    for (let k = 0, t = 0; k <= frame && t < 10000; k++) {
      const gap = intervals[(frame - k) % FRAMES];
      if (Number.isNaN(gap)) break;
      if (gap > usual * 1.5) late++;
      t += gap;
    }
    // Firefox and Safari have no GPU timer queries (Firefox without changing a setting).
    const gpu = ext ? passNames.map((name, p) => `${name} ${(gpuSum[p] / gpuN[p]).toFixed(2)}`).join('  ')
      : 'not measurable in this browser';
    const counts = counterNames.map((name, c) => `${name} ${counters[(frame % FRAMES) * C + c]}`).join('  ');
    // Frames a second over the last 50: the screen's rate (60, or 120 on a ProMotion screen), or
    // less if the browser holds the page back (Safari halves it in Low Power Mode) or it can't keep up.
    overlay.textContent =
      `${gl.canvas.width}x${gl.canvas.height} | ${Math.round(1000 * gapN / gapSum)} fps | worst frame ${worst.toFixed(1)} ms | late frames ${late} in 10 s | JS ${(jsSum / jsN).toFixed(2)} / ${jsMax.toFixed(1)} ms\n` +
      `GPU ms: ${gpu}${counts ? `\n${counts}` : ''}`;
    nextOverlay = now + 1000;
  }

  function stats(values) {
    const sorted = values.filter(v => !Number.isNaN(v)).sort();
    if (!sorted.length) return null;
    let sum = 0;
    for (const v of sorted) sum += v;
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { mean: sum / sorted.length, p50: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1], count: sorted.length };
  }

  return {
    frameStart(timeMs) {
      if (ext) collect();
      frame++;
      const i = frame % FRAMES;
      intervals[i] = lastTime < 0 ? NaN : timeMs - lastTime;
      lastTime = timeMs;
      jsTimes[i] = NaN;
      for (let p = 0; p < P; p++) gpuTimes[i * P + p] = NaN;
      for (let c = 0; c < C; c++) counters[i * C + c] = NaN;
      const slot = frame % SLOTS;
      timing = ext !== null && slotFrame[slot] < 0;
      if (timing) slotFrame[slot] = frame;
      start = performance.now();
    },
    begin(pass) {
      if (timing) gl.beginQuery(ext.TIME_ELAPSED_EXT, queries[(frame % SLOTS) * P + pass]);
    },
    end() {
      if (timing) gl.endQuery(ext.TIME_ELAPSED_EXT);
    },
    count(counter, value) {
      counters[(frame % FRAMES) * C + counter] = value;
    },
    frameEnd() {
      const now = performance.now();
      jsTimes[frame % FRAMES] = now - start;
      if (now >= nextOverlay) updateOverlay(now);  // allocates a little, once a second
    },
    // Full statistics over everything recorded (call from the console).
    report() {
      const n = Math.min(frame + 1, FRAMES);
      const interval = intervals.subarray(0, n);
      const period = stats(interval).p50;
      let dropped = 0;
      for (const d of interval) if (d > period * 1.5) dropped++;
      const gpu = {};
      passNames.forEach((name, p) => {
        const values = new Float32Array(n);
        for (let i = 0; i < n; i++) values[i] = gpuTimes[i * P + p];
        gpu[name] = stats(values);
      });
      const counts = {};
      counterNames.forEach((name, c) => {
        const values = new Float32Array(n);
        for (let i = 0; i < n; i++) values[i] = counters[i * C + c];
        counts[name] = stats(values);
      });
      return {
        canvas: `${gl.canvas.width}x${gl.canvas.height}`,
        frames: n, dropped, interval: stats(interval), js: stats(jsTimes.subarray(0, n)), gpu, counts,
        gpuDiscarded: discarded,  // frames whose GPU timings were thrown away as disjoint
      };
    },
  };
}

// Run the game in headless Chrome, press keys, take screenshots and read the profiler, over
// Chrome's DevTools protocol. For checking the game when the browser pane is hidden (which pauses
// requestAnimationFrame), or without a window at all. The game server must be running.
//
//   node bench/headless.mjs '<url>' '<steps as JSON>' [output folder]
//
// Each step can wait (ms), press or release keys (`down`/`up`: a key code or a list), save a
// screenshot (`shot`: file name), evaluate JS in the page (`eval`: printed) and take a CPU profile
// of the page for `profile` ms (the functions taking the most time, as ms a frame, printed; and the
// whole profile saved as `profileFile`, if given, to open in DevTools). For example:
//   node bench/headless.mjs 'http://localhost:8001/?profile' '[{"wait":800,"down":"ArrowUp"},
//     {"wait":3000,"shot":"driving.png"},{"eval":"JSON.stringify(profiler.report())"}]'
//
// Which Chrome: CHROME (its path; macOS's Google Chrome if not given), drawing through the ANGLE
// backend named by ANGLE (metal on macOS; swiftshader, the CPU's software renderer, elsewhere: its GPU
// timings show only which passes cost more, not what they'd cost on a GPU). COUNT=1 injects
// bench/count.js first, which counts every frame's WebGL calls, draws, vertices and uploads
// (`window.__counts.report()`); it slows the page's JS, so time JS without it. HOLD=n stops the
// game after its nth frame (main.js's `frame`), and a step `"held": true` waits until it has: with
// main.js's `step` (each frame 1/60 s of the game, however long it took) and Math.random seeded, the
// same moment every run, to compare screenshots pixel for pixel (bench/diff.mjs); the controls hint
// is hidden. On Linux, e.g.:
//   CHROME=/opt/pw-browsers/chromium node bench/headless.mjs ...
//
// Chrome's own --screenshot flag captures straight after the page loads, before the game has run
// any frames; this waits in real time, so the car has actually driven.

import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const [url, stepsJson, outFolder = '.'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ANGLE = process.env.ANGLE ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const profile = mkdtempSync(join(tmpdir(), 'easy-roads-chrome-'));  // a fresh profile: nothing cached
const chrome = spawn(CHROME, [
  '--headless=new', `--use-angle=${ANGLE}`, ...(ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),  // (Chrome won't run as root, in a container, with it)
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=900,560', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  // Chrome picks a free port (so runs can go side by side) and writes it into the profile.
  let targets = [];
  for (let i = 0; i < 40 && !targets.length; i++) {
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch { await sleep(250); }
  }
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.onopen = resolve);
  let lastId = 0;
  const replies = new Map();
  socket.onmessage = e => {
    const message = JSON.parse(e.data);
    replies.get(message.id)?.(message);
    replies.delete(message.id);
  };
  const send = (method, params = {}) => new Promise(resolve => {
    replies.set(++lastId, resolve);
    socket.send(JSON.stringify({ id: lastId, method, params }));
  });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result;

  await send('Page.enable');
  // VIEWPORT=576x360: the page that size (the game's at `size`, screenshots one pixel per pixel).
  const [viewWidth, viewHeight] = (process.env.VIEWPORT ?? '').split('x').map(Number);
  if (viewWidth) await send('Emulation.setDeviceMetricsOverride', { width: viewWidth, height: viewHeight, deviceScaleFactor: 1, mobile: false });
  if (process.env.COUNT) await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('count.js', import.meta.url), 'utf8') });
  if (process.env.HOLD) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const raf = window.requestAnimationFrame.bind(window);
      let drawn = 0;
      window.__drawn = () => drawn;
      window.requestAnimationFrame = callback => callback.name !== 'frame' ? raf(callback)
        : raf(time => { if (drawn < ${Number(process.env.HOLD)}) { drawn++; callback(time); } });
      let seed = 1;  // and the same random numbers (the dust's) every run
      Math.random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
      addEventListener('DOMContentLoaded', () => {  // and no controls hint over the picture
        const style = document.createElement('style');
        style.textContent = '.hint { display: none }';
        document.head.append(style);
      });
    })();` });
  }
  await send('Page.navigate', { url });
  const KEY_NUMBERS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, KeyR: 82 };
  const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: KEY_NUMBERS[code] });
  for (const step of steps) {
    if (step.wait) await sleep(step.wait);
    for (const code of [].concat(step.down ?? [])) await key('rawKeyDown', code);
    for (const code of [].concat(step.up ?? [])) await key('keyUp', code);
    if (step.held) await evaluate(`new Promise(r => { const t = () => __drawn() >= ${Number(process.env.HOLD)} ? r() : requestAnimationFrame(t); t(); })`);
    if (step.shot) {
      const reply = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outFolder, step.shot), Buffer.from(reply.result.data, 'base64'));
      console.log(`saved ${step.shot}`);
    }
    if (step.eval) {
      const result = await evaluate(step.eval);
      console.log(result.exceptionDetails?.exception?.description ?? result.result.value);
    }
    if (step.profile) {
      // Frames counted by a requestAnimationFrame callback of our own, alongside the game's.
      await evaluate('window.__frames ??= (() => { const tick = () => { window.__frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 0; })()');
      await send('Profiler.enable');
      await send('Profiler.setSamplingInterval', { interval: 50 });  // µs
      const framesBefore = (await evaluate('window.__frames')).result.value;
      await send('Profiler.start');
      await sleep(step.profile);
      const { result: { profile: cpu } } = await send('Profiler.stop');
      const frames = (await evaluate('window.__frames')).result.value - framesBefore;
      if (step.profileFile) writeFileSync(join(outFolder, step.profileFile), JSON.stringify(cpu));
      // Self time per function (its own samples, not those of what it calls).
      const self = new Map(), byNode = new Map(cpu.nodes.map(node => [node.id, node]));
      cpu.samples.forEach((id, k) => {
        const { functionName, url: file, lineNumber } = byNode.get(id).callFrame;
        const name = `${functionName || '(anonymous)'} ${file.split('/').pop()}${file ? `:${lineNumber + 1}` : ''}`;
        self.set(name, (self.get(name) ?? 0) + (cpu.timeDeltas[k] ?? 0) / 1000);
      });
      const total = [...self].reduce((sum, [name, ms]) => sum + (name.startsWith('(idle)') ? 0 : ms), 0);
      const busy = [...self].reduce((sum, [name, ms]) => sum + (/^\((idle|program)\)/.test(name) ? 0 : ms), 0);
      console.log(`CPU profile: ${frames} frames in ${(step.profile / 1000).toFixed(1)} s; main thread busy ${(total / frames).toFixed(2)} ms a frame, of which JS and GC ${(busy / frames).toFixed(2)} ms (the rest "(program)": the browser's own work)`);
      for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, step.top ?? 30)) {
        console.log(`  ${(ms / frames).toFixed(3).padStart(7)} ms  ${name}`);
      }
    }
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

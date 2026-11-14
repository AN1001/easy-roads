// How long the game takes to start, in headless Chrome: from the navigation to its first frames, the
// files fetched, main.js's own marks (performance.mark: see main.js), and a CPU profile of the main
// thread over the load (the functions taking the most time). The game server must be running.
//
//   node bench/startup.mjs ['http://localhost:8001/?size=576x360'] [runs] [top]
//
// Each run is a fresh Chrome with an empty profile (nothing cached, no compiled shaders kept), so
// it's a first visit every time. CHROME and ANGLE as for bench/headless.mjs. THROTTLE=kbps,ms slows
// the network down (e.g. 4000,40: 4 Mbit/s, 40 ms a request), to see what a deployed game's files cost.
// FILES=1 lists each fetch of the last run: when it started and ended, and its size.

import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const [url = 'http://localhost:8001/?size=576x360', runs = '3', top = '14'] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ANGLE = process.env.ANGLE ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run(last) {
  const profile = mkdtempSync(join(tmpdir(), 'easy-roads-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--use-angle=${ANGLE}`, ...(ANGLE === 'swiftshader' ? ['--enable-unsafe-swiftshader'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=900,560', 'about:blank',
  ], { stdio: 'ignore' });
  try {
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
    const urls = new Map();  // by request
    socket.onmessage = e => {
      const message = JSON.parse(e.data);
      // What went wrong in the page, if anything did.
      if (message.method === 'Runtime.exceptionThrown') console.log(`  page: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      if (message.method === 'Network.requestWillBeSent') urls.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed') console.log(`  page: ${urls.get(message.params.requestId)} failed: ${message.params.errorText}`);
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') console.log(`  page: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
      replies.get(message.id)?.(message);
      replies.delete(message.id);
    };
    const send = (method, params = {}) => new Promise(resolve => {
      replies.set(++lastId, resolve);
      socket.send(JSON.stringify({ id: lastId, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    if (process.env.THROTTLE) {
      const [kbps, latency] = process.env.THROTTLE.split(',').map(Number);
      await send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: kbps * 125, uploadThroughput: kbps * 125 });
    }
    // The game's frames, timed from outside it: the first three callbacks named `frame`.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__frames = [];
      window.requestAnimationFrame = callback => callback.name !== 'frame' ? raf(callback) : raf(time => {
        const start = performance.now();
        callback(time);
        if (__frames.length < 3) __frames.push([start, performance.now()]);
      });
    })();` });
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 100 });  // µs
    await send('Profiler.start');
    await send('Page.navigate', { url });
    await sleep(Number(process.env.WAIT ?? 4000));
    const { result: { profile: cpu } } = await send('Profiler.stop');
    const { result } = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({
      frames: __frames,
      marks: performance.getEntriesByType('mark').map(m => [m.name, m.startTime]),
      files: performance.getEntriesByType('resource').map(r => [r.name.split('/').pop(), r.startTime, r.responseEnd, r.transferSize]),
      error: window.__error ?? null,
    })` });
    if (result.result.value === undefined) throw new Error(JSON.stringify(result));
    const data = JSON.parse(result.result.value);
    socket.close();
    if (!data.frames.length) throw new Error(`no frame drawn in ${process.env.WAIT ?? 4000} ms (WAIT=ms waits longer); ${data.files.length} fetches; marks: ${data.marks.map(([name, at]) => `${name} ${at.toFixed(0)}`).join(', ')}`);
    const firstStart = data.frames[0][0], firstEnd = data.frames[0][1];
    const lastFile = Math.max(...data.files.map(f => f[2]));
    console.log(`first frame starts ${firstStart.toFixed(0)} ms, done ${firstEnd.toFixed(0)} ms (frames: ${data.frames.map(f => (f[1] - f[0]).toFixed(1)).join(', ')} ms); ` +
      `${data.files.length} fetches, the last done ${lastFile.toFixed(0)} ms; ` + data.marks.map(([name, at]) => `${name} ${at.toFixed(0)}`).join(', '));
    if (last && process.env.FILES) for (const [name, start, end, bytes] of data.files) console.log(`  ${start.toFixed(0).padStart(5)} to ${end.toFixed(0).padStart(5)} ms  ${String(bytes).padStart(7)} bytes  ${name}`);
    if (last) {
      // Self time per function over the load, up to the first frame's end.
      const self = new Map(), byNode = new Map(cpu.nodes.map(node => [node.id, node]));
      cpu.samples.forEach((id, k) => {
        const { functionName, url: file, lineNumber } = byNode.get(id).callFrame;
        const name = `${functionName || '(anonymous)'} ${file.split('/').pop()}${file ? `:${lineNumber + 1}` : ''}`;
        self.set(name, (self.get(name) ?? 0) + (cpu.timeDeltas[k] ?? 0) / 1000);
      });
      console.log('main thread, self time over the load:');
      for (const [name, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`  ${ms.toFixed(1).padStart(7)} ms  ${name}`);
    }
    return firstEnd;
  } finally {
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

const times = [];
for (let k = 0; k < Number(runs); k++) times.push(await run(k === Number(runs) - 1));
const sorted = [...times].sort((a, b) => a - b);
console.log(`first frame done: ${times.map(t => t.toFixed(0)).join(', ')} ms; median ${sorted[sorted.length >> 1].toFixed(0)}, best ${sorted[0].toFixed(0)}`);

// Run the game in headless Chrome, press keys, take screenshots and read the profiler, over
// Chrome's DevTools protocol. For checking the game when the browser pane is hidden (which pauses
// requestAnimationFrame), or without a window at all. The game server must be running.
//
//   node bench/headless.mjs '<url>' '<steps as JSON>' [output folder]
//
// Each step can wait (ms), press or release keys (`down`/`up`: a key code or a list), save a
// screenshot (`shot`: file name) and evaluate JS in the page (`eval`: printed). For example:
//   node bench/headless.mjs 'http://localhost:8001/?profile' '[{"wait":800,"down":"ArrowUp"},
//     {"wait":3000,"shot":"driving.png"},{"eval":"JSON.stringify(profiler.report())"}]'
//
// Chrome's own --screenshot flag captures straight after the page loads, before the game has run
// any frames; this waits in real time, so the car has actually driven.

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const [url, stepsJson, outFolder = '.'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'easy-roads-chrome-'));  // a fresh profile: nothing cached
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--use-angle=metal', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`, '--window-size=900,560', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  let targets = [];
  for (let i = 0; i < 40 && !targets.length; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(250); }
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

  await send('Page.enable');
  await send('Page.navigate', { url });
  const KEY_NUMBERS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32, KeyR: 82 };
  const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: KEY_NUMBERS[code] });
  for (const step of steps) {
    if (step.wait) await sleep(step.wait);
    for (const code of [].concat(step.down ?? [])) await key('rawKeyDown', code);
    for (const code of [].concat(step.up ?? [])) await key('keyUp', code);
    if (step.shot) {
      const reply = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outFolder, step.shot), Buffer.from(reply.result.data, 'base64'));
      console.log(`saved ${step.shot}`);
    }
    if (step.eval) {
      const reply = await send('Runtime.evaluate', { expression: step.eval, returnByValue: true, awaitPromise: true });
      console.log(reply.result.exceptionDetails?.exception?.description ?? reply.result.result.value);
    }
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

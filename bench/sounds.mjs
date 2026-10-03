// The game's sounds as WAV, from the downloaded OGGs (Vorbis, which not every Safari can decode):
// decoded by headless Chrome's own decodeAudioData, mixed to mono, resampled to RATE, and, for the
// loops, the end crossfaded into the start so they repeat without a click. Run it again after
// changing the list. The game server must be running (as for headless.mjs):
//
//   node bench/sounds.mjs [http://localhost:8001/]

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const base = process.argv[2] ?? 'http://localhost:8001/';
const RATE = 22050;  // Hz: plenty for an engine's hum, half the bytes of 44.1 kHz
const FADE = 0.08;   // s: a loop's end crossfaded into its start
const SOUNDS = [
  { from: 'Car_Engine_Loop.ogg', to: 'engine_loop.wav', loop: true },
  { from: 'Car_Engine_Start_Up.ogg', to: 'engine_start.wav', loop: false },
];

const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), 'easy-roads-chrome-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  let targets = [];
  for (let i = 0; i < 60 && !targets.some(t => t.type === 'page'); i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
    await sleep(250);
  }
  const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.onopen = resolve);
  let lastId = 0;
  const replies = new Map();
  socket.onmessage = e => { const m = JSON.parse(e.data); replies.get(m.id)?.(m); replies.delete(m.id); };
  const send = (method, params = {}) => new Promise(resolve => {
    replies.set(++lastId, resolve);
    socket.send(JSON.stringify({ id: lastId, method, params }));
  });
  await send('Page.navigate', { url: base });
  await sleep(1000);

  for (const { from, to, loop } of SOUNDS) {
    // Decoded and resampled in the page (an OfflineAudioContext at RATE), returned as base64 floats.
    const url = new URL(`assets/Sound effects/${from}`, base).href;
    const reply = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
      const decoded = await new AudioContext().decodeAudioData(await (await fetch(${JSON.stringify(url)})).arrayBuffer());
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * ${RATE}), ${RATE});
      const source = offline.createBufferSource();
      source.buffer = decoded; source.connect(offline.destination); source.start();
      const samples = (await offline.startRendering()).getChannelData(0);
      let text = ''; const bytes = new Uint8Array(samples.buffer);
      for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(text);
    })()` });
    if (reply.result.exceptionDetails) throw new Error(`${from}: ${reply.result.exceptionDetails.exception?.description}`);
    const raw = Buffer.from(reply.result.result.value, 'base64');
    let samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    if (loop) {
      // The last FADE s faded out over the first FADE s faded in, then dropped from the end.
      const n = Math.round(FADE * RATE), out = samples.slice(0, samples.length - n);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        out[i] = samples[i] * Math.sin(t * Math.PI / 2) + samples[samples.length - n + i] * Math.cos(t * Math.PI / 2);
      }
      samples = out;
    }
    // Quietened if it would clip (the start-up's peak is over 1).
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    if (peak > 0.95) samples = samples.map(s => s * 0.95 / peak);
    const wav = Buffer.alloc(44 + 2 * samples.length);
    wav.write('RIFF', 0); wav.writeUInt32LE(36 + 2 * samples.length, 4); wav.write('WAVE', 8);
    wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(2 * RATE, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(2 * samples.length, 40);
    samples.forEach((s, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + 2 * i));
    writeFileSync(new URL(`../assets/Sound effects/${to}`, import.meta.url), wav);
    console.log(`${to}: ${(samples.length / RATE).toFixed(2)} s, peak ${peak.toFixed(2)}${peak > 0.95 ? ' (scaled to 0.95)' : ''}, ${(wav.length / 1024).toFixed(0)} KB`);
  }
  socket.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}

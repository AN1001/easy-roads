// Sound, with Web Audio: the engine, a recording (assets/Sound effects, made from the downloaded
// OGGs by bench/sounds.mjs), starting up the first time a key or the screen is pressed (until then
// browsers keep a page silent); and, made in code like the textures, the rain, the tyres on the
// dirt, sliding, splashing through puddles, and the bamboo rustling and knocking as the car pushes
// through it. Every frame, main.js says how the car is doing; each sound follows, smoothed.

const ENGINE_FADE_IN = 1.2;  // s after the start-up begins: when the running engine takes over
const IDLE_RATE = 0.75, TOP_RATE = 1.75;  // the engine recording's speed, idling and flat out
const TOP_SPEED = 30;        // m/s: where the engine is at TOP_RATE
const SMOOTH = 0.06;         // s: how quickly each sound follows (a time constant)

// White noise, `seconds` long, to loop: the rain, the tyres and splashes, filtered differently.
function noiseBuffer(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 2 * Math.random() - 1;
  return buffer;
}

// Short bursts of noise, each decaying, scattered `perSecond` at random over `seconds`, with
// random loudness: grit crunching under a tyre (bursts of a few ms), or leaves brushing (tens of ms).
function grainBuffer(ctx, seconds, perSecond, shortest, longest) {
  const rate = ctx.sampleRate, buffer = ctx.createBuffer(1, Math.round(seconds * rate), rate);
  const data = buffer.getChannelData(0);
  for (let n = Math.round(seconds * perSecond); n > 0; n--) {
    const at = Math.floor(Math.random() * data.length), length = (shortest + Math.random() * (longest - shortest)) * rate;
    const loud = Math.random() ** 2;
    for (let i = 0; i < length; i++) {
      const k = (at + i) % data.length;  // wrapping round, so the loop has no seam
      data[k] += loud * (2 * Math.random() - 1) * Math.exp(-4 * i / length) * Math.min(1, i / 40);
    }
  }
  let peak = 0;
  for (const s of data) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < data.length; i++) data[i] /= peak;
  return buffer;
}

async function loadBuffer(ctx, url) {
  return ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
}

export function createSound() {
  let ctx = null, master = null, muted = false, started = 0;
  let engine = null, engineGain = null, engineTone = null, grit = null;
  const gains = {};  // name: GainNode, for update to turn up and down
  let knockBudget = 0;

  function loop(buffer, gain, ...filters) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0; source.loopEnd = buffer.duration;
    let node = source;
    for (const filter of filters) { node.connect(filter); node = filter; }
    node.connect(gain);
    gain.connect(master);
    source.start(0, Math.random() * buffer.duration);  // each from its own place in the buffer
    return source;
  }
  function filter(type, frequency, Q = 0.7) {
    const node = ctx.createBiquadFilter();
    node.type = type; node.frequency.value = frequency; node.Q.value = Q;
    return node;
  }
  function gain(value = 0) {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  }

  // Called on every key press and touch: the first makes everything, later ones wake it if the
  // browser suspended it.
  async function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    master = gain(muted ? 0 : 0.8);
    master.connect(ctx.destination);

    const noise = noiseBuffer(ctx, 3);
    // Rain: a hiss in the leaves all round, and a softer patter lower down.
    gains.rain = gain(0);
    loop(noise, gains.rain, filter('highpass', 900), filter('lowpass', 7000));
    gains.patter = gain(0);
    loop(noise, gains.patter, filter('bandpass', 400, 0.5));
    // Tyres: grit crunching, faster the faster they roll; sliding, a broad scrubbing hiss; water.
    gains.tyres = gain();
    grit = loop(grainBuffer(ctx, 2, 900, 0.001, 0.004), gains.tyres, filter('bandpass', 1400, 0.6));
    gains.slide = gain();
    loop(noise, gains.slide, filter('bandpass', 1100, 1.2));
    gains.splash = gain();
    loop(noise, gains.splash, filter('bandpass', 600, 0.8), filter('lowpass', 2500));
    // Bamboo: leaves brushing the car and each other.
    gains.rustle = gain();
    loop(grainBuffer(ctx, 3, 70, 0.01, 0.05), gains.rustle, filter('highpass', 1800), filter('lowpass', 8000));

    // The engine: starting up, then running (louder and brighter on the throttle).
    const [running, startUp] = await Promise.all([
      loadBuffer(ctx, 'assets/Sound effects/engine_loop.wav'),
      loadBuffer(ctx, 'assets/Sound effects/engine_start.wav'),
    ]);
    const now = ctx.currentTime;
    const once = ctx.createBufferSource();
    once.buffer = startUp;
    const onceGain = gain(0.2);
    once.connect(onceGain); onceGain.connect(master);
    once.start(now);
    engineGain = gain(0);
    engineTone = filter('lowpass', 1500);
    engine = loop(running, engineGain, engineTone);
    engine.playbackRate.value = IDLE_RATE;
    engineGain.gain.setValueAtTime(0, now + ENGINE_FADE_IN - 0.4);
    engineGain.gain.linearRampToValueAtTime(0.12, now + ENGINE_FADE_IN);
    started = now + ENGINE_FADE_IN;
  }

  // A sound's level or pitch, eased towards `value`. One that isn't a number is left as it is
  // (Firefox throws, and stopped the game, on 1 Oct 2026), and said once, by `name`.
  const warned = new Set();
  function set(param, value, name) {
    if (Number.isFinite(value)) param.setTargetAtTime(value, ctx.currentTime, SMOOTH);
    else if (!warned.has(name)) { warned.add(name); console.warn(`sound: ${name} is ${value}`); }
  }

  // A hollow knock: a stalk of bamboo struck, its pitch set by its size. Two tones, the second an
  // overtone, both dying away within a tenth of a second or so.
  function knock(loudness) {
    const now = ctx.currentTime, pitch = 380 + 420 * Math.random();
    const out = gain(0);
    out.connect(master);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(loudness, now + 0.003);
    out.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    for (const [ratio, level] of [[1, 1], [2.76, 0.35]]) {
      const tone = ctx.createOscillator(), partial = gain(level);
      tone.frequency.setValueAtTime(pitch * ratio * 1.08, now);
      tone.frequency.exponentialRampToValueAtTime(pitch * ratio, now + 0.05);
      tone.connect(partial); partial.connect(out);
      tone.start(now); tone.stop(now + 0.16);
    }
  }

  // This frame: `rain` (0 to 1), `speed` (m/s), `rev` (0 to 1: the driven wheels' speed, as the engine's),
  // `throttle` (0 or 1), `grip` (0 to 1: how many wheels are on the ground), `rough` (1 on the
  // dirt road, less on grass and leaves), `slide` (m/s, the fastest-sliding tyre), `wet` (the
  // puddle under the tyres, 0 to 1), `push` (how fast the car is bending bamboo aside: radians a
  // second, all told), `swaying` (stalks still springing back) and `struck` (stalks it reached
  // this frame).
  function update(s, dt) {
    if (!ctx || !engine || ctx.state !== 'running') return;
    if (ctx.currentTime > started) {
      set(engine.playbackRate, IDLE_RATE + (TOP_RATE - IDLE_RATE) * Math.min(s.rev, 1.1) + 0.06 * s.throttle, 'engine rate');
      set(engineGain.gain, 0.09 + 0.07 * s.throttle + 0.04 * Math.min(s.rev, 1), 'engine level');
      set(engineTone.frequency, 900 + 2200 * s.throttle + 1500 * Math.min(s.rev, 1), 'engine tone');
    }
    set(gains.rain.gain, 0.05 * s.rain, 'rain');
    set(gains.patter.gain, 0.08 * s.rain, 'patter');
    const rolling = Math.min(s.speed / TOP_SPEED, 1) * s.grip;
    set(gains.tyres.gain, 0.5 * Math.sqrt(rolling) * s.rough, 'tyres');
    set(grit.playbackRate, 0.5 + rolling, 'grit');
    set(gains.slide.gain, 0.12 * Math.min(s.slide / 6, 1) * s.grip, 'slide');
    set(gains.splash.gain, 0.35 * s.wet * Math.min(s.speed / 10, 1), 'splash');
    set(gains.rustle.gain, Math.min(0.5, s.push / 60 + s.swaying / 600), 'rustle');
    // Now and then a stalk the car reaches knocks against another: at most a few a second.
    knockBudget = Math.min(knockBudget + 6 * dt, 2);
    for (let n = 0; n < s.struck && knockBudget >= 1; n++) {
      if (Math.random() < 0.3) { knock(0.12 + 0.12 * Math.min(s.speed / 10, 1)); knockBudget--; }
    }
  }

  // M: sound off and on.
  function toggleMute() {
    muted = !muted;
    if (master) set(master.gain, muted ? 0 : 0.8, 'mute');
    return muted;
  }

  // While the page is hidden, the game stops; so does its sound.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  return { start, update, toggleMute, get muted() { return muted; } };
}

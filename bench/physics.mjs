// Car physics test drives, in Node: no browser or GPU needed.
//   node bench/physics.mjs          flat-ground tests, 40 minutes each of random driving off road and
//                                   of following the road, cost
//   node bench/physics.mjs flat     just the flat-ground tests (a few seconds)
// Numbers from it are in NOTES.md ("Physics engine").

import { readFileSync } from 'fs';
const ROOT = new URL('../', import.meta.url);
// car.js fetches its model files: read them from disk instead.
globalThis.fetch = async path => ({ text: async () => readFileSync(new URL(path, ROOT), 'utf8') });
const { createTerrain } = await import(new URL('terrain.js', ROOT));
const { createCar, placeCar, updateCar, followTheRoad, WHEEL_RADIUS, WHEEL_HALF_WIDTH } = await import(new URL('car.js', ROOT));

const only = process.argv[2];
const deg = r => (r * 180 / Math.PI).toFixed(1);
const f = (n, digits = 1) => n.toFixed(digits);
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
const DT = 1 / 60;

// Ground shapes: heightAt(x, z, normal) like terrain.js's.
const plane = (slopeX, slopeZ) => (x, z, n) => {
  if (n) { const l = Math.hypot(slopeX, 1, slopeZ); n[0] = -slopeX / l; n[1] = 1 / l; n[2] = -slopeZ / l; }
  return slopeX * x + slopeZ * z;
};
const FLAT = plane(0, 0);

// Speeds and angles of a car, from its body axes (columns: side, up, forward).
const forwardSpeed = car => { const a = car.body.axes, v = car.body.velocity; return v[0] * a[6] + v[1] * a[7] + v[2] * a[8]; };
const sideSpeed = car => { const a = car.body.axes, v = car.body.velocity; return v[0] * a[0] + v[1] * a[1] + v[2] * a[2]; };
const pitch = car => Math.asin(car.body.axes[7]);  // nose up +
const roll = car => Math.asin(car.body.axes[1]);   // left side up +

function newCar(heightAt, x = 0, z = 0) { const car = createCar(); placeCar(car, x, z, 0, heightAt); return car; }
// Drive for `seconds` at 60 fps. keys(t, car) returns { throttle, brake, handbrake, steer }.
function drive(car, heightAt, seconds, keys, each) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const t = k * DT, i = keys(t, car);
    updateCar(car, i.throttle ? 1 : 0, i.brake ? 1 : 0, i.handbrake ? 1 : 0, i.steer || 0, DT, heightAt);
    each?.(t, car);
  }
}
const holdSpeed = target => (t, car) => forwardSpeed(car) < target;

// How far the deepest point of any tyre is into the ground (m; negative = clear of it), measured
// straight out of the ground: on a cliff, a point a few cm inside the face can be far below the
// top of it. Samples each tyre's rim, around its middle and both edges.
const groundNormal = new Float64Array(3);
function tyreDepth(car, heightAt) {
  const m = car.model;
  let deepest = -Infinity;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i], steer = w.front ? car.steerAngle : 0;
    const c = Math.cos(steer), s = Math.sin(steer);
    for (const across of [-WHEEL_HALF_WIDTH, 0, WHEEL_HALF_WIDTH]) {
      for (let k = 0; k < 32; k++) {
        const angle = k / 32 * 2 * Math.PI, along = WHEEL_RADIUS * Math.cos(angle);
        const x = w.x + across * c + along * s, y = w.y + WHEEL_RADIUS * Math.sin(angle), z = w.z - across * s + along * c;
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const below = heightAt(wx, wz, groundNormal) - wy;
        deepest = Math.max(deepest, below > 0 ? below * groundNormal[1] : below);
      }
    }
  }
  return deepest;
}

console.log('--- Flat ground ---');
{
  const car = newCar(FLAT), heights = [];
  drive(car, FLAT, 2.5, () => ({}), (t, c) => { if (Math.round(t / DT) % 6 === 0) heights.push(f(c.y * 100, 0)); });
  console.log(`Dropped from 50 cm, height every 0.1 s (cm): ${heights.join(' ')}`);
}
{
  const car = newCar(FLAT), speeds = [];
  let noseUp = 0, to100 = 0;
  drive(car, FLAT, 12, () => ({ throttle: 1 }), (t, c) => {
    if (Math.round(t / DT) % 60 === 59) speeds.push(f(forwardSpeed(c)));
    if (!to100 && forwardSpeed(c) > 27.78) to100 = t;
    noseUp = Math.max(noseUp, pitch(c));
  });
  console.log(`Full throttle, speed each second (m/s): ${speeds.join(' ')}. 0-100 km/h ${f(to100)} s, nose up ${deg(noseUp)}°`);
  const v0 = forwardSpeed(car), z0 = car.z;
  let stopTime = 0, stopDistance = 0, noseDown = 0;
  drive(car, FLAT, 5, () => ({ brake: 1 }), (t, c) => {
    if (!stopTime && forwardSpeed(c) < 0.5) { stopTime = t; stopDistance = c.z - z0; }
    noseDown = Math.max(noseDown, -pitch(c));
  });
  console.log(`Braking from ${f(v0)} m/s: stopped in ${f(stopTime, 2)} s and ${f(stopDistance)} m (${f(v0 / stopTime / 9.8, 2)} g), nose down ${deg(noseDown)}°; then reversing at ${f(-forwardSpeed(car))} m/s`);
}
for (const target of [10, 15, 20, 25]) {
  const car = newCar(FLAT), sideways = [], rolls = [];
  drive(car, FLAT, 16, (t, c) => ({ throttle: holdSpeed(target)(t, c), steer: t > 7 ? 1 : 0 }), (t, c) => {
    if (t > 12) { const v = c.body.velocity; sideways.push(Math.hypot(v[0], v[2]) * Math.abs(c.body.spin[1])); rolls.push(roll(c)); }
  });
  const v = car.body.velocity;
  console.log(`Full lock at ${target} m/s: turning circle radius ${f(Math.hypot(v[0], v[2]) / Math.abs(car.body.spin[1]))} m, ${f(mean(sideways) / 9.8, 2)} g sideways, leaning ${deg(Math.abs(mean(rolls)))}°`);
}
{
  const car = newCar(FLAT);
  drive(car, FLAT, 5, (t, c) => ({ throttle: holdSpeed(15)(t, c) }));
  const heading = car.heading;
  let drift = 0;
  drive(car, FLAT, 3, t => ({ handbrake: t < 0.4, throttle: t > 0.4, steer: 1 }), (t, c) => {
    drift = Math.max(drift, Math.abs(Math.atan2(sideSpeed(c), forwardSpeed(c))));
  });
  console.log(`Handbrake flick (0.4 s) at 15 m/s with full lock, then throttle: turned ${deg(car.heading - heading)}° in 3 s, sliding up to ${deg(drift)}° sideways`);
}
for (const [name, ground] of [['a 20° slope facing uphill', plane(0, Math.tan(20 * Math.PI / 180))],
                              ['a 20° slope side on', plane(Math.tan(20 * Math.PI / 180), 0)]]) {
  const car = newCar(ground), x0 = car.x, z0 = car.z;
  drive(car, ground, 6, () => ({}));
  console.log(`Parked on ${name}: moved ${f(Math.hypot(car.x - x0, car.z - z0) * 100, 0)} cm in 6 s`);
}
{
  // Flat, then a 20° ramp 3 m high, then flat again at the top.
  const RAMP_END = 20 + 3 / Math.tan(20 * Math.PI / 180);
  const ramp = (x, z, n) => {
    const slope = z > 20 && z < RAMP_END ? Math.tan(20 * Math.PI / 180) : 0;
    if (n) { const l = Math.hypot(1, slope); n[0] = 0; n[1] = 1 / l; n[2] = -slope / l; }
    return z <= 20 ? 0 : z < RAMP_END ? (z - 20) * slope : 0;
  };
  const car = newCar(ramp, 0, -20);
  let airTime = 0, highest = 0, landings = 0, wasFlying = false;
  drive(car, ramp, 8, () => ({ throttle: 1 }), (t, c) => {
    const flying = c.wheels.every(w => !w.onGround);
    if (flying) airTime += DT;
    if (wasFlying && !flying) landings++;
    wasFlying = flying;
    highest = Math.max(highest, c.y - ramp(c.x, c.z));
  });
  console.log(`Off a 3 m ramp at full throttle: ${f(airTime, 2)} s in the air, ${f(highest)} m up, ${landings} landings, ${car.body.axes[4] > 0.9 ? 'upright' : 'NOT upright'}`);
}

if (only !== 'flat') {
  // Endless terrain, built around the car as it goes (like main.js, but with no time limit).
  const terrain = createTerrain({ radius: 2 }), H = terrain.heightAt;
  const onTerrain = (car, keys) => (t, c) => { terrain.update(c.x, c.z, Infinity); return keys(t, c); };
  const random = seed => () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  // Places to start: two groups of 4 on roads, in different parts of the forest.
  const STARTS = [[600, -260], [900, 300], [1400, -800], [300, -1000], [-700, 300], [-1000, -400], [-400, 900], [-900, -1100]];

  // Measures a drive, per frame: tipped over, airborne, on a bump stop, tyres into the ground.
  function recorder() {
    const r = { frames: 0, tippedFrames: 0, resets: 0, airFrames: 0, jumps: 0, bumpStop: 0, distance: 0, depths: [], airborne: 0, x: NaN, z: NaN };
    r.before = (t, c) => { c.upBefore = c.body.axes[4]; };
    r.after = (t, c) => {
      r.frames++;
      if (c.upBefore < 0.5 && c.body.axes[4] > 0.999) r.resets++;  // set back on its wheels
      if (c.body.axes[4] < 0.5) { r.tippedFrames++; return; }
      const flying = c.wheels.every(w => !w.onGround);
      if (flying) { r.airFrames++; r.airborne++; } else { if (r.airborne > 18) r.jumps++; r.airborne = 0; }
      if (c.wheels.some(w => w.onGround && w.length <= 0)) r.bumpStop++;
      r.depths.push(tyreDepth(c, H));
      if (!isNaN(r.x)) r.distance += Math.hypot(c.x - r.x, c.z - r.z);
      r.x = c.x; r.z = c.z;
    };
    r.report = name => {
      r.depths.sort((a, b) => a - b);
      const q = p => f(r.depths[Math.floor(p * (r.depths.length - 1))] * 100);
      const minutes = r.frames * DT / 60;
      console.log(`${name}: ${f(minutes, 0)} min at ${f(r.distance / (r.depths.length * DT))} m/s on average, ${f(r.distance / 1000)} km`);
      console.log(`  ${r.jumps} jumps of 0.3 s or more, airborne ${f(100 * r.airFrames / r.frames)}% of the time`);
      console.log(`  Tipped over and set back on its wheels ${r.resets} times (once every ${f(minutes / Math.max(r.resets, 1))} min); on its side or roof ${f(100 * r.tippedFrames / r.frames)}% of the time`);
      console.log(`  A wheel on its bump stop in ${f(100 * r.bumpStop / r.frames)}% of frames`);
      console.log(`  Deepest tyre into the ground, per frame: p50 ${q(0.5)} cm, p99 ${q(0.99)} cm, max ${q(1)} cm; over 1 cm in ${f(100 * r.depths.filter(d => d > 0.01).length / r.depths.length)}% of frames`);
    };
    return r;
  }

  console.log('--- Off road: random drives of 5 minutes, from roads in two groups of 4 places ---');
  let offRoad;
  for (const [k, [sx, sz]] of STARTS.entries()) {
    if (k % 4 === 0) offRoad = recorder();
    // Every 1.5 s: a random steering position; brake 10% of the time, handbrake 5%.
    const next = random(7 + 4 * k), plan = [];
    for (let t = 0; t < 302; t += 1.5) {
      plan.push({ steer: [-1, -0.5, 0, 0, 0.5, 1][Math.floor(next() * 6)], brake: next() < 0.1, handbrake: next() < 0.05 });
    }
    const start = terrain.nearestRoad(sx, sz);
    const car = createCar();
    placeCar(car, start.x, start.z, start.heading, H);
    offRoad.x = NaN;
    drive(car, H, 300, onTerrain(car, (t, c) => {
      offRoad.before(t, c);
      const p = plan[Math.floor(t / 1.5)];
      return { throttle: !p.brake, brake: p.brake, handbrake: p.handbrake, steer: p.steer };
    }), offRoad.after);
    if (k === 3) offRoad.report('First 4');
  }
  offRoad.report('Last 4');

  console.log('--- On the road: following it at up to 25 m/s, 8 drives of 5 minutes ---');
  const onRoad = recorder();
  let offTheRoad = 0;
  for (const [sx, sz] of STARTS) {
    const start = terrain.nearestRoad(sx, sz);
    const car = createCar();
    placeCar(car, start.x, start.z, start.heading, H);
    onRoad.x = NaN;
    drive(car, H, 300, onTerrain(car, (t, c) => {
      onRoad.before(t, c);
      return followTheRoad(c, terrain.nearestRoad, {});
    }), (t, c) => {
      onRoad.after(t, c);
      if (terrain.roadDistanceAt(c.x, c.z) > 0) offTheRoad++;
    });
  }
  onRoad.report('On the road');
  console.log(`  Off the road in ${f(100 * offTheRoad / onRoad.frames)}% of frames`);

  console.log('--- Cost ---');
  // Circles on the road near the start, inside chunks built beforehand: just the physics.
  const area = createTerrain({ radius: 4 });
  for (const fps of [60, 50]) {
    const start = area.nearestRoad(0, 0);
    const car = createCar(), dt = 1 / fps, N = 200000;
    area.update(start.x, start.z, Infinity);
    placeCar(car, start.x, start.z, start.heading, area.heightAt);
    const run = n => { for (let k = 0; k < n; k++) updateCar(car, 1, 0, 0, 1, dt, area.heightAt); };
    run(20000);  // warm up: let the JIT compile it
    const t0 = performance.now();
    run(N);
    console.log(`${fps} fps (${Math.ceil(dt * 120 - 1e-9)} physics steps per frame): ${f((performance.now() - t0) / N * 1000, 2)} µs per updateCar`);
  }
}

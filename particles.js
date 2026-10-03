// Dust, smoke and water from the car: dust its tyres kick up off the road, a puff where a wheel
// lands hard, smoke from tyres sliding on the road, a little exhaust, and water thrown up and out
// through puddles. And the rain splashing on the ground round it. Faint on purpose: dust and smoke
// are mostly see-through, drops tiny.
//
// Each is drawn as one point (particles.vert, particles.frag). Nothing is allocated after startup:
// the live particles are always the first `count` (a dead one is replaced by the last live one),
// so they're uploaded and drawn with one call each.

export const MAX_PARTICLES = 512;
// For the GPU, per particle: centre x, y, z and size across (m); opacity, colour, dither shift,
// and one unused, to keep 8 (32 bytes).
export const PARTICLE_FLOATS = 8;
// For the simulation: velocity x, y, z (m/s); age and lifetime (s); size at the start and at the
// end (m); opacity at the start; acceleration upwards (m/s²); drag (1/s).
const STATE = 10;

// Colours: indices into COLORS in particles.vert.
const DUST = 0, GRIT = 1, SMOKE = 2, EXHAUST = 3, WATER = 4;

// Puffs lose their speed through the air within about a second and drift slowly upwards; drops of
// water fly further, and fall.
const DRAG = 2.5, LIFT = 0.25;       // 1/s, m/s²
const DROP_DRAG = 0.4, FALL = -9.8;  // 1/s, m/s²

export function createParticles() {
  return {
    count: 0,
    gpu: new Float32Array(MAX_PARTICLES * PARTICLE_FLOATS),
    state: new Float32Array(MAX_PARTICLES * STATE),
  };
}

// Move the particles on by dt seconds, swelling and fading, and let the old ones go.
export function updateParticles(particles, dt) {
  const gpu = particles.gpu, state = particles.state;
  for (let i = 0; i < particles.count;) {
    const g = i * PARTICLE_FLOATS, s = i * STATE;
    const age = state[s + 3] + dt, life = state[s + 4];
    if (age >= life) {
      const last = --particles.count;
      gpu.copyWithin(g, last * PARTICLE_FLOATS, (last + 1) * PARTICLE_FLOATS);
      state.copyWithin(s, last * STATE, (last + 1) * STATE);
      continue;  // look at the one moved here
    }
    state[s + 3] = age;
    const drag = 1 - state[s + 9] * dt;  // near enough exp(-drag · dt), for steps this short
    state[s] *= drag;
    state[s + 1] = state[s + 1] * drag + state[s + 8] * dt;
    state[s + 2] *= drag;
    gpu[g] += state[s] * dt;
    gpu[g + 1] += state[s + 1] * dt;
    gpu[g + 2] += state[s + 2] * dt;
    const t = age / life;
    gpu[g + 3] = state[s + 5] + (state[s + 6] - state[s + 5]) * (1 - (1 - t) * (1 - t));  // quickly, then slowly
    gpu[g + 4] = state[s + 7] * (1 - t);
    i++;
  }
}

// A new particle at (x, y, z), moving at (vx, vy, vz): lasting `life` s, growing from `size` to
// `endSize` m across, and fading from `opacity` (0 to 1) to nothing; a puff unless `drop`, when it
// falls. Ignored if there's no room.
function emit(particles, x, y, z, vx, vy, vz, life, size, endSize, opacity, colour, drop = false) {
  if (particles.count === MAX_PARTICLES) return;
  const i = particles.count++, g = i * PARTICLE_FLOATS, s = i * STATE;
  const gpu = particles.gpu, state = particles.state;
  gpu[g] = x; gpu[g + 1] = y; gpu[g + 2] = z; gpu[g + 3] = size;
  gpu[g + 4] = opacity; gpu[g + 5] = colour; gpu[g + 6] = Math.floor(Math.random() * 16); gpu[g + 7] = 0;
  state[s] = vx; state[s + 1] = vy; state[s + 2] = vz;
  state[s + 3] = 0; state[s + 4] = life;
  state[s + 5] = size; state[s + 6] = endSize; state[s + 7] = opacity;
  state[s + 8] = drop ? FALL : LIFT; state[s + 9] = drop ? DROP_DRAG : DRAG;
}

// A drop thrown up at `vy` m/s, from height y: it lasts until it's back down at that height.
function throwDrop(particles, x, y, z, vx, vy, vz, size, opacity) {
  emit(particles, x, y, z, vx, vy, vz, 2 * vy / -FALL, size, size, opacity, WATER, true);
}

// A whole number of particles that averages `expected`: 0.3 gives one about every third frame.
const howMany = expected => Math.floor(expected + Math.random());
const spread = size => size * (Math.random() - 0.5);

// Rates are particles per second.
const DUST_RATE = 0.3;   // per m/s of speed, from each back wheel off the road (half as much from the front)
const SLIDE_RATE = 3;    // per m/s of sideways sliding beyond SLIDING
const SLIDING = 2;       // m/s
const HARD_LANDING = 3.5;  // m/s of the ground coming up at a wheel: below this, no puff
// The tailpipe, in model coordinates: under the back bumper, on the right.
const TAILPIPE_X = -0.45, TAILPIPE_Y = 0.28, TAILPIPE_Z = -1.95;
const SPLASH = 3;          // drops per m a tyre rolls through a puddle

// What the car kicks up this frame. `ground` answers questions about the ground under a tyre:
// roadDistanceAt and edgeAt (terrain.js), and puddleAt (textures.js). Into `under`, for the sound:
// how many tyres are on the road, and how many in a puddle.
export function kickUp(particles, car, throttle, dt, ground, under) {
  under.road = under.puddle = 0;
  const v = car.body.velocity;
  const speed = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  const m = car.model;  // columns: side (0-2), up (4-6), forward (8-10), position (12-14)
  for (let w = 0; w < 4; w++) {
    const wheel = car.wheels[w], landing = wheel.landing;
    wheel.landing = 0;
    if (!wheel.onGround) continue;
    const x = wheel.groundX, y = wheel.groundY, z = wheel.groundZ, road = ground.roadDistanceAt(x, z);
    const onRoad = road < 0, verge = !onRoad && road < 1;
    if (onRoad) under.road++;
    const colour = onRoad || verge ? GRIT : DUST, sliding = Math.max(0, wheel.slip - SLIDING);

    // Off the road, dust, more from the driven back wheels, and more still sliding: thrown up
    // and a little way along with the car, then hanging in the air.
    const dust = onRoad ? 0 : (DUST_RATE * speed * (wheel.front ? 0.5 : 1) + SLIDE_RATE * sliding) * (verge ? 0.5 : 1);
    for (let n = howMany(dust * dt); n > 0; n--) {
      emit(particles, x + spread(0.4), y + 0.1, z + spread(0.4),
        0.3 * v[0] + spread(1.2), 0.4 + 0.8 * Math.random(), 0.3 * v[2] + spread(1.2),
        1.2 + 0.8 * Math.random(), 0.3, 1.2 + 0.4 * Math.random(), 0.45 + 0.15 * Math.random(), colour);
    }
    // On it, sliding tyres smoke.
    for (let n = howMany((onRoad ? SLIDE_RATE * sliding : 0) * dt); n > 0; n--) {
      emit(particles, x + spread(0.3), y + 0.15, z + spread(0.3),
        0.2 * v[0] + spread(0.8), 0.3 + 0.5 * Math.random(), 0.2 * v[2] + spread(0.8),
        1.5 + Math.random(), 0.4, 2 + 0.5 * Math.random(), 0.3, SMOKE);
    }
    // Through a puddle (drawn more than 0.8 m in from the road's frayed edge), water: drops thrown
    // up and out, more the faster, from the front tyres a bow wave out to the sides, from the back
    // ones up and behind. (Not puffs of spray: pale on the dark road, a see-through puff's dither
    // shows as a square of dots.)
    if (onRoad && speed > 1 && ground.puddleAt(x, z) && ground.edgeAt(x, z) < -0.8) {
      under.puddle++;
      const side = wheel.x > 0 ? 1 : -1;  // +x is the car's left
      for (let n = Math.min(howMany(SPLASH * speed * dt), 12); n > 0; n--) {
        const out = side * (wheel.front ? 1.5 + 2 * Math.random() : 0.3 + Math.random());
        const back = wheel.front ? 0.2 * speed * Math.random() : (0.15 + 0.25 * Math.random()) * speed;
        const up = Math.min(1.2 + (0.05 + 0.1 * Math.random()) * speed, 4);
        throwDrop(particles, x + spread(0.3), y + 0.05, z + spread(0.3),
          0.5 * v[0] + out * m[0] - back * m[8], up, 0.5 * v[2] + out * m[2] - back * m[10],
          0.06 + 0.06 * Math.random(), 0.9);
      }
    }

    // A hard landing: a ring of dust (or grit, on the road) thrown out round the tyre.
    if (landing > HARD_LANDING) {
      for (let n = Math.min(10, Math.round(2 * (landing - 2.5)) >> (onRoad ? 1 : 0)); n > 0; n--) {
        const angle = 2 * Math.PI * Math.random(), out = 1.5 + 1.5 * Math.random();
        emit(particles, x, y + 0.1, z, out * Math.sin(angle), 0.3 + 0.7 * Math.random(), out * Math.cos(angle),
          0.8 + 0.6 * Math.random(), 0.3, 1 + 0.3 * Math.random(), 0.5, colour);
      }
    }
  }

  // Exhaust, faint in the cold damp air: a puff every so often, more on the throttle.
  for (let n = howMany((throttle ? 8 : 3) * dt); n > 0; n--) {
    emit(particles,
      m[12] + TAILPIPE_X * m[0] + TAILPIPE_Y * m[4] + TAILPIPE_Z * m[8],
      m[13] + TAILPIPE_X * m[1] + TAILPIPE_Y * m[5] + TAILPIPE_Z * m[9],
      m[14] + TAILPIPE_X * m[2] + TAILPIPE_Y * m[6] + TAILPIPE_Z * m[10],
      0.3 * v[0] - m[8] + spread(0.3), 0.2 + 0.2 * Math.random(), 0.3 * v[2] - m[10] + spread(0.3),
      0.8 + 0.4 * Math.random(), 0.12, 0.5, 0.3, EXHAUST);
  }
}

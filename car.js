// The player's car: a low-poly model on a rigid body (physics.js), held up by four sprung wheels.

import { parseObj } from './obj.js';
import { GRAVITY, createBody, placeBody, applyImpulse, velocityAt, responseAt, integrate,
  collideWithGround } from './physics.js';

// --- Model ---

// "Car 03" from GGBotNet's PSX Style Cars (CC0), in assets/. The file is about 1.4× real size
// (5.6 m long), so it's scaled to 3.9 m. It faces +z, like the game. Its y = 0 is the ground.
const MODEL_SCALE = 0.7;

// Wheel centres when parked: front left, front right, back left, back right (+x is the car's
// left), measured from the wheels built into Car3.obj. Those are cut out of the body, and the
// separate Wheel.obj is drawn at each centre instead, so it can spin, steer and move on its spring.
const WHEELS = [
  [0.977, 0.423, 1.753], [-0.977, 0.423, 1.753],
  [0.957, 0.423, -1.836], [-0.957, 0.423, -1.836],
].map(centre => centre.map(n => n * MODEL_SCALE));
export const WHEEL_RADIUS = 0.459 * MODEL_SCALE;      // m
export const WHEEL_HALF_WIDTH = 0.137 * MODEL_SCALE;  // m

export async function loadCarMeshes() {
  const [body, wheel] = await Promise.all([
    fetch('assets/Car 03/Car3.obj').then(r => r.text()),
    fetch('assets/Wheel/Wheel.obj').then(r => r.text()),
  ]);
  return { body: parseBody(body), wheel: parseObj(wheel, MODEL_SCALE) };
}

// The body, from Car3.obj. Its left side is its right side mirrored, on the same texels, as are the
// left halves of its bonnet, roof, back and front, so lettering would read backwards on one of them.
// Its texture (car3_zen.png, bench/livery.mjs) is two of the model's side by side: the faces right
// of the middle read the first, those left of it (+x) the second, painted the other way round. (The
// rally livery, car3_rally.png, used both; the zen car's green is the same on each.)
export function parseBody(text) {
  // A built-in wheel's corners all lie within its tyre: its width across, its radius around.
  const inWheel = ([x, y, z]) => WHEELS.some(([wx, wy, wz]) =>
    Math.abs(x - wx) < 0.14 && Math.hypot(y - wy, z - wz) < 0.35);
  const left = corners => corners.reduce((sum, [x]) => sum + x, 0) > 0;
  const body = parseObj(text, MODEL_SCALE, corners => !corners.every(inWheel),
    ([u, v], corners) => [(u + (left(corners) ? 1 : 0)) / 2, v]);
  return body;
}

// --- Body ---

const MASS = 1000;  // kg (a real AE86 is about 950)
// Centre of mass, in model coordinates: midway between the axles, so each wheel carries a quarter
// of the weight. 35 cm up is lower than a real car: at 50 cm it tipped over three times as often
// on these steep hills (see NOTES.md).
const CENTRE_X = 0, CENTRE_Y = 0.35, CENTRE_Z = (WHEELS[0][2] + WHEELS[2][2]) / 2;

// --- Suspension: soft and lightly damped, so the car bobs and bounces over bumps ---

const BOUNCE_HZ = 1.6;      // how many times a second the body bobs on its springs
const DAMPING_RATIO = 0.45; // 1 would settle without overshooting; lower is bouncier
const SPRING = (MASS / 4) * (2 * Math.PI * BOUNCE_HZ) ** 2;       // N/m per wheel (~25,300)
const DAMPER = DAMPING_RATIO * 2 * Math.sqrt(SPRING * MASS / 4);  // N per m/s (~2,300)
// Parked, each spring holds up a quarter of the car, squashed this far from unloaded. In the
// air the springs unload, so the wheels also drop this far.
const SAG = MASS * GRAVITY / 4 / SPRING;  // m (~10 cm)
// How far a wheel can rise from where it sits parked before the tyre reaches the wheel arch.
const BUMP = 0.1;           // m
const TRAVEL = BUMP + SAG;  // m, from fully squashed to hanging

// --- Tyres and driving ---

const GRIP = 1.2;            // a tyre pushes sideways, or forwards, with up to GRIP × its load
const HANDBRAKE_GRIP = 0.4;  // the back tyres' sideways grip with the handbrake on: they slide
// Sideways tyre forces push this high above the ground. The further below the centre of mass,
// the more the car leans in corners, and the more easily it tips.
const ROLL_CENTRE = 0.2;     // m
const ENGINE = 6000;         // N, through the back wheels (rear-wheel drive, like the AE86)
const REVERSE = 3000;        // N
const MAX_REVERSE = 8;       // m/s
const BRAKES = 12000;        // N, all four wheels together
const ENGINE_BRAKING = 1500; // N, back wheels, off the throttle. Also holds the car on gentle slopes
const ROLLING = 0.015;       // rolling resistance, × a tyre's load
const AIR_DRAG = 6.5;        // N per (m/s)²: against ENGINE, a top speed of ~30 m/s (108 km/h)
const MAX_STEER = 0.5;       // rad (~29°): front wheels at full lock, at low speed
const STEER_FADE = 10;       // m/s: full lock halves by this speed, thirds by twice it, and so on
const STEER_RATE = 12;       // 1/s: how quickly the front wheels follow the keys

// --- Collisions: points on the body that can hit the ground ---

// In model coordinates, each used on both sides (measured from Car3.obj): bumper corners, sill,
// door tops and roof. Then the bottom of each tyre when fully squashed into its arch: the bump
// stop, so a hard landing can't push a wheel into the ground.
const HULL = [
  [0.74, 0.3, 1.9], [0.72, 0.84, 1.98],     // front bumper: bottom, top
  [0.7, 0.28, -1.85], [0.69, 0.89, -1.94],  // back bumper: bottom, top
  [0.77, 0.22, -0.25],                      // sill, between the wheels
  [0.77, 1.0, 0.7], [0.77, 1.0, -1.0],      // door tops
  [0.54, 1.47, 0.3], [0.54, 1.47, -1.3],    // roof
].flatMap(([x, y, z]) => [[x, y, z], [-x, y, z]])
  .concat(WHEELS.map(([x, y, z]) => [x, y + BUMP - WHEEL_RADIUS, z]));
// As offsets from the centre of mass, in one flat array: x, y, z, x, y, z, ...
const HULL_POINTS = new Float64Array(HULL.flatMap(([x, y, z]) => [x - CENTRE_X, y - CENTRE_Y, z - CENTRE_Z]));
const HULL_BOUNCE = 0.3;    // a panel hitting the ground keeps 30% of its speed
const HULL_FRICTION = 0.5;  // and slides with this much friction

// Each frame is split into equal physics steps no longer than this. Springs and collisions need
// short steps to stay stable; 120 a second is 2–3 steps per frame at 50–60 fps.
const MAX_STEP = 1 / 120;  // s

export function createCar() {
  return {
    body: createBody(MASS, 1.6, 1.3, 3.9),
    model: new Float32Array(16),  // model -> world, for drawing
    x: 0, y: 0, z: 0,             // the model's origin (the ground under it, when parked)
    heading: 0,                   // which way it faces on the map: for the camera
    steerAngle: 0,                // rad, front wheels; positive = left
    braking: false,               // for the brake lights
    tippedTime: 0,                // s spent stuck on its side or roof
    wheels: WHEELS.map(([x, y, z], i) => ({
      x, y, z,                    // centre in model coordinates, for drawing; y follows the spring
      front: i < 2,
      // Top of its travel, as an offset from the centre of mass in the car's own axes.
      topX: x - CENTRE_X, topY: y + BUMP - CENTRE_Y, topZ: z - CENTRE_Z,
      length: TRAVEL,             // m from the top of its travel down to its centre
      onGround: false,
      spin: 0, spinRate: 0,       // rad and rad/s, about its axle
      // For the dust it kicks up (particles.js), from the last physics step: where the tyre
      // touches the ground, how fast it's sliding over it (m/s), and how fast the ground was
      // coming up at it when it last landed (m/s, until particles.js takes it).
      groundX: 0, groundY: 0, groundZ: 0, slip: 0, landing: 0,
    })),
  };
}

// Drop the car from half a metre, upright and still, at (x, z), facing `heading`.
export function placeCar(car, x, z, heading, heightAt) {
  placeBody(car.body, x, heightAt(x, z) + CENTRE_Y + 0.5, z, heading);
  for (const wheel of car.wheels) wheel.spinRate = 0;
  updateModel(car);
}

// Back on its wheels where it is, facing the same way: after a crash or getting stuck.
export function resetCar(car, heightAt) {
  car.tippedTime = 0;
  placeCar(car, car.x, car.z, car.heading, heightAt);
}

// throttle, brake, handbrake: 0 or 1. steer: -1 (right) to 1 (left). dt: seconds since the last
// frame.
export function updateCar(car, throttle, brake, handbrake, steer, dt, heightAt) {
  const a = car.body.axes, v = car.body.velocity;
  // Stuck on its side or roof, or leaning on a steep bank (tilted over 60°): after a moment, set
  // it back on its wheels where it is.
  const stuck = a[4] < 0.5 && v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < 4;
  car.tippedTime = stuck ? car.tippedTime + dt : 0;
  if (car.tippedTime > 2) resetCar(car, heightAt);

  const forwardSpeed = v[0] * a[6] + v[1] * a[7] + v[2] * a[8];

  // Less lock at speed, where a little steering goes a long way.
  const lock = MAX_STEER / (1 + Math.abs(forwardSpeed) / STEER_FADE);
  car.steerAngle += (steer * lock - car.steerAngle) * (1 - Math.exp(-dt * STEER_RATE));

  // Brake while going forwards, or throttle while going backwards, slows the car down.
  // Otherwise throttle drives forwards, and brake reverses.
  car.braking = (brake && forwardSpeed > 0.5) || (throttle && forwardSpeed < -0.5);
  const drive = car.braking ? 0 : throttle ? ENGINE
    : brake && forwardSpeed > -MAX_REVERSE ? -REVERSE : 0;
  // Stopped with no pedal pressed, the brakes hold the car still, even on a steep hill.
  const holding = !throttle && !brake && Math.abs(forwardSpeed) < 1;
  const brakes = car.braking || holding ? BRAKES : 0;

  const steps = Math.ceil(dt / MAX_STEP);
  for (let i = 0; i < steps; i++) step(car, drive, brakes, handbrake, dt / steps, heightAt);

  for (let i = 0; i < 4; i++) {
    const wheel = car.wheels[i];
    // Kept below one turn, so the angle never grows large enough to lose precision.
    wheel.spin = (wheel.spin + wheel.spinRate * dt) % (2 * Math.PI);
    wheel.y = WHEELS[i][1] + BUMP - wheel.length;
  }
  updateModel(car);
}

// One physics step of h seconds.
function step(car, drive, brakes, handbrake, h, heightAt) {
  const body = car.body, a = body.axes, p = body.position, v = body.velocity;

  // Air resistance, against the direction of travel.
  const drag = AIR_DRAG * Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) * body.invMass * h;
  v[0] -= v[0] * drag; v[1] -= v[1] * drag; v[2] -= v[2] * drag;

  for (let i = 0; i < 4; i++) {
    wheelStep(body, car.wheels[i], car.steerAngle, drive, brakes, handbrake, h, heightAt);
  }
  // Gravity after the springs: added before, the dampers would feel it as the ground closing
  // in, and hold the car up a little (6 mm).
  v[1] -= GRAVITY * h;

  // Body panels and bump stops that reach the ground. The impulses stop them sinking further;
  // then the body is pushed out by the deepest one, straight out of the ground there.
  let deepest = 0, outX = 0, outY = 0, outZ = 0;
  for (let i = 0; i < HULL_POINTS.length; i += 3) {
    const x = HULL_POINTS[i], y = HULL_POINTS[i + 1], z = HULL_POINTS[i + 2];
    const depth = collideWithGround(body,
      a[0] * x + a[3] * y + a[6] * z, a[1] * x + a[4] * y + a[7] * z, a[2] * x + a[5] * y + a[8] * z,
      heightAt, HULL_BOUNCE, HULL_FRICTION, normal);
    if (depth > deepest) { deepest = depth; outX = normal[0]; outY = normal[1]; outZ = normal[2]; }
  }
  integrate(body, h);
  p[0] += deepest * outX; p[1] += deepest * outY; p[2] += deepest * outZ;
}

const normal = new Float64Array(3), vel = new Float64Array(3);  // scratch

// One wheel: find the ground below it, push the car up with its spring, then its tyre's grip.
function wheelStep(body, wheel, steerAngle, drive, brakes, handbrake, h, heightAt) {
  const a = body.axes, p = body.position;
  const ux = a[3], uy = a[4], uz = a[5];  // the car's up: the suspension slides along it
  // Top of the wheel's travel, from the centre of mass, in world axes.
  const tx = a[0] * wheel.topX + a[3] * wheel.topY + a[6] * wheel.topZ;
  const ty = a[1] * wheel.topX + a[4] * wheel.topY + a[7] * wheel.topZ;
  const tz = a[2] * wheel.topX + a[5] * wheel.topY + a[8] * wheel.topZ;

  // The way the wheel points, and its axle, in the car's own plane: turned by the steering.
  const c = wheel.front ? Math.cos(steerAngle) : 1, s = wheel.front ? Math.sin(steerAngle) : 0;
  let fx = c * a[6] + s * a[0], fy = c * a[7] + s * a[1], fz = c * a[8] + s * a[2];
  const axleX = c * a[0] - s * a[6], axleY = c * a[1] - s * a[7], axleZ = c * a[2] - s * a[8];

  // Follow the suspension down to the ground. Where it meets the triangle under the top gives
  // a first guess; a second pass, on the triangle under that guess, is exact unless the line
  // crosses a third one.
  const ox = p[0] + tx, oy = p[1] + ty, oz = p[2] + tz;
  let gx = ox, gz = oz, dist = 0, facing = 0;
  for (let k = 0; k < 2; k++) {
    const gy = heightAt(gx, gz, normal);
    facing = ux * normal[0] + uy * normal[1] + uz * normal[2];  // cosine of the angle between them
    if (facing < 0.2) break;  // on its side or upside down: the wheel can't reach the ground
    // If the top of its travel is already in the ground (the car on its side against a cliff),
    // the ground is there, not somewhere behind it: that triangle's plane, carried on, can be
    // tens of metres away, and a spring pushing there would spin the car wildly.
    dist = Math.max(0, ((ox - gx) * normal[0] + (oy - gy) * normal[1] + (oz - gz) * normal[2]) / facing);
    // Further than the tyre can reach: in the air. Don't follow the line on to where it meets
    // the ground: flying over a valley, that can be the far wall, whose plane, carried back
    // under the car, would seem to touch the wheel.
    if (dist > TRAVEL + (WHEEL_RADIUS + WHEEL_HALF_WIDTH) / facing) break;
    gx = ox - ux * dist; gz = oz - uz * dist;
  }
  // Rest the tyre on that triangle. It's a cylinder, not a point: when the ground tilts across
  // it, one edge reaches further down, and the rest of its rim less far.
  const across = Math.abs(axleX * normal[0] + axleY * normal[1] + axleZ * normal[2]);
  const reach = WHEEL_RADIUS * Math.sqrt(1 - across * across) + WHEEL_HALF_WIDTH * across;
  const length = dist - reach / facing;  // top of travel to the wheel's centre
  if (facing < 0.2 || length > TRAVEL) {
    // In the air: the wheel hangs at full travel and keeps spinning, unless braked.
    wheel.onGround = false;
    wheel.slip = 0;
    wheel.length = TRAVEL;
    if (brakes || (handbrake && !wheel.front)) wheel.spinRate = 0;
    return;
  }
  const landing = !wheel.onGround;
  wheel.onGround = true;
  // Past the top of its travel (length 0) the spring can't squash any further, and the bump stop
  // takes over. The wheel is still drawn on the ground, rising into its arch, not sunk into it.
  wheel.length = Math.max(length, -BUMP);
  const nx = normal[0], ny = normal[1], nz = normal[2];

  // Spring and damper, pushing the car away from the ground at the tyre's contact point. The
  // damper resists the ground closing in (or pulling away) along the suspension.
  const cx = tx - ux * dist, cy = ty - uy * dist, cz = tz - uz * dist;
  velocityAt(body, cx, cy, cz, vel);
  const closing = -(vel[0] * nx + vel[1] * ny + vel[2] * nz) / facing;
  if (landing) wheel.landing = Math.max(wheel.landing, closing);
  wheel.groundX = p[0] + cx; wheel.groundY = p[1] + cy; wheel.groundZ = p[2] + cz;
  const load = Math.max(0, SPRING * (TRAVEL - Math.max(wheel.length, 0)) + DAMPER * closing);  // N
  applyImpulse(body, cx, cy, cz, nx * load * h, ny * load * h, nz * load * h);

  // The way the tyre rolls, flattened onto the ground; `side` is across it.
  const fn = fx * nx + fy * ny + fz * nz;
  fx -= fn * nx; fy -= fn * ny; fz -= fn * nz;
  const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= fLen; fy /= fLen; fz /= fLen;
  const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;

  // Sideways grip: cancel the tyre's sideways slide, if the grip is enough; beyond that it
  // slides. Applied ROLL_CENTRE above the ground rather than at it (real suspension geometry
  // does the same), so cornering leans the car a few degrees instead of rolling it over.
  const down = dist - ROLL_CENTRE;  // from the top of travel
  const wx = tx - ux * down, wy = ty - uy * down, wz = tz - uz * down;
  velocityAt(body, wx, wy, wz, vel);
  const slide = vel[0] * sx + vel[1] * sy + vel[2] * sz;
  const sideGrip = (handbrake && !wheel.front ? HANDBRAKE_GRIP : GRIP) * load * h;
  const side = clamp(-slide / responseAt(body, wx, wy, wz, sx, sy, sz), sideGrip);
  applyImpulse(body, wx, wy, wz, side * sx, side * sy, side * sz);

  // Forwards, at the ground: the engine pushes the back wheels, and the brakes (and rolling
  // resistance, and engine braking when coasting) resist the tyre's rolling. The handbrake
  // locks the back wheels, so they can resist as much as their grip allows.
  const grip = GRIP * load * h;
  velocityAt(body, cx, cy, cz, vel);
  const rolling = vel[0] * fx + vel[1] * fy + vel[2] * fz;
  let push = 0, resist = brakes / 4 + ROLLING * load;
  if (!wheel.front) {
    if (handbrake) resist = Infinity;
    else if (drive) push = clamp(drive / 2 * h, grip);
    else resist += ENGINE_BRAKING / 2;
  }
  const stop = clamp(-rolling / responseAt(body, cx, cy, cz, fx, fy, fz), Math.min(resist * h, grip));
  applyImpulse(body, cx, cy, cz, (push + stop) * fx, (push + stop) * fy, (push + stop) * fz);

  const locked = handbrake && !wheel.front;
  wheel.spinRate = locked ? 0 : rolling / WHEEL_RADIUS;
  wheel.slip = locked ? Math.sqrt(slide * slide + rolling * rolling) : Math.abs(slide);
}

// Hands-free driving for measurements (?autodrive=road in main.js, and bench/physics.mjs): aim at
// the road 15 m ahead, and ease off for bends. `nearestRoad` is terrain.js's. Writes throttle
// (0 or 1) and steer into `controls`, and returns it.
export function followTheRoad(car, nearestRoad, controls) {
  const ahead = nearestRoad(car.x + 15 * Math.sin(car.heading), car.z + 15 * Math.cos(car.heading));
  let turn = Math.atan2(ahead.x - car.x, ahead.z - car.z) - car.heading;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));  // -π to π
  const a = car.body.axes, v = car.body.velocity;
  const forwardSpeed = v[0] * a[6] + v[1] * a[7] + v[2] * a[8];
  controls.throttle = forwardSpeed < 25 - 40 * Math.abs(turn) ? 1 : 0;
  controls.steer = clamp(3 * turn, 1);
  return controls;
}

// x, limited to between -max and max.
function clamp(x, max) {
  return Math.min(Math.max(x, -max), max);
}

// Model matrix from the body: columns are its side, up and forward axes, then the position of
// the model's origin, which is the centre of mass minus the centre's offset within the model.
function updateModel(car) {
  const a = car.body.axes, p = car.body.position, m = car.model;
  m[0] = a[0]; m[1] = a[1]; m[2] = a[2]; m[3] = 0;
  m[4] = a[3]; m[5] = a[4]; m[6] = a[5]; m[7] = 0;
  m[8] = a[6]; m[9] = a[7]; m[10] = a[8]; m[11] = 0;
  m[12] = p[0] - (a[0] * CENTRE_X + a[3] * CENTRE_Y + a[6] * CENTRE_Z);
  m[13] = p[1] - (a[1] * CENTRE_X + a[4] * CENTRE_Y + a[7] * CENTRE_Z);
  m[14] = p[2] - (a[2] * CENTRE_X + a[5] * CENTRE_Y + a[8] * CENTRE_Z);
  m[15] = 1;
  car.x = m[12]; car.y = m[13]; car.z = m[14];
  // Kept as it was while the car points straight up or down.
  if (a[6] * a[6] + a[8] * a[8] > 0.01) car.heading = Math.atan2(a[6], a[8]);
}

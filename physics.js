// A small rigid-body physics engine: one solid body, pushed by impulses, with points on it
// that collide with the ground. The car (car.js) is built on it.
//
// A rigid body moves like a particle (position, velocity) and also turns (orientation, spin).
// A push away from its centre of mass does both: it moves the body and twists it.
//
// Everything is an impulse: a force F acting for a time step h is the impulse F·h, applied
// in one go. Units are SI (m, s, kg, N) and world axes. Vectors are typed arrays or plain
// numbers, updated in place, so a step allocates nothing.

export const GRAVITY = 9.8;  // m/s²

// Hits slower than this don't bounce, or a body resting on the ground would jitter.
const BOUNCE_MIN_SPEED = 1;  // m/s

// A box of even density, width × height × length along its own x, y and z (m). The size only
// sets how hard it is to turn about each axis (its moments of inertia).
export function createBody(mass, width, height, length) {
  const w2 = width * width, h2 = height * height, l2 = length * length;
  return {
    invMass: 1 / mass,
    // 1 / moment of inertia about the body's own x (pitch), y (yaw) and z (roll) axes.
    invInertia: new Float64Array([12 / (mass * (h2 + l2)), 12 / (mass * (w2 + l2)), 12 / (mass * (w2 + h2))]),
    position: new Float64Array(3),  // of the centre of mass
    velocity: new Float64Array(3),  // m/s
    spin: new Float64Array(3),      // angular velocity: turning about this axis, at |spin| rad/s
    orientation: new Float64Array([0, 0, 0, 1]),  // unit quaternion (x, y, z, w)
    // The same orientation as a matrix, kept in step with it. Columns: the body's own x (side),
    // y (up) and z (forward) axes in world space.
    axes: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  };
}

// Put the body at rest, upright, turned `heading` radians about the vertical (0 faces +z).
export function placeBody(body, x, y, z, heading) {
  body.position[0] = x; body.position[1] = y; body.position[2] = z;
  body.velocity.fill(0);
  body.spin.fill(0);
  const q = body.orientation;
  q[0] = 0; q[1] = Math.sin(heading / 2); q[2] = 0; q[3] = Math.cos(heading / 2);
  updateAxes(body);
}

// Rotation matrix from the quaternion.
function updateAxes(body) {
  const q = body.orientation, a = body.axes;
  const x = q[0], y = q[1], z = q[2], w = q[3];
  a[0] = 1 - 2 * (y * y + z * z); a[1] = 2 * (x * y + w * z);     a[2] = 2 * (x * z - w * y);
  a[3] = 2 * (x * y - w * z);     a[4] = 1 - 2 * (x * x + z * z); a[5] = 2 * (y * z + w * x);
  a[6] = 2 * (x * z + w * y);     a[7] = 2 * (y * z - w * x);     a[8] = 1 - 2 * (x * x + y * y);
}

// Scratch vectors, reused by every call.
const turn = new Float64Array(3), pointVel = new Float64Array(3);

// The spin that a twist (angular impulse) (x, y, z) adds, written into out: the inverse inertia
// times it. Inertia is simple in the body's own axes, so turn the twist into those, scale each
// part, and turn the result back into world axes.
function spinFromTwist(body, x, y, z, out) {
  const a = body.axes, inv = body.invInertia;
  const s = (a[0] * x + a[1] * y + a[2] * z) * inv[0];
  const u = (a[3] * x + a[4] * y + a[5] * z) * inv[1];
  const f = (a[6] * x + a[7] * y + a[8] * z) * inv[2];
  out[0] = a[0] * s + a[3] * u + a[6] * f;
  out[1] = a[1] * s + a[4] * u + a[7] * f;
  out[2] = a[2] * s + a[5] * u + a[8] * f;
}

// Push the body with impulse j (N·s), at offset r from its centre of mass (world axes).
// It moves by j / mass, and twists by r × j.
export function applyImpulse(body, rx, ry, rz, jx, jy, jz) {
  const v = body.velocity, w = body.spin;
  v[0] += jx * body.invMass; v[1] += jy * body.invMass; v[2] += jz * body.invMass;
  spinFromTwist(body, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, turn);
  w[0] += turn[0]; w[1] += turn[1]; w[2] += turn[2];
}

// Velocity of the body's point at offset r: its own velocity plus spin × r. Written into out.
export function velocityAt(body, rx, ry, rz, out) {
  const v = body.velocity, w = body.spin;
  out[0] = v[0] + w[1] * rz - w[2] * ry;
  out[1] = v[1] + w[2] * rx - w[0] * rz;
  out[2] = v[2] + w[0] * ry - w[1] * rx;
}

// How much an impulse at offset r along unit direction n changes that point's speed along n,
// per N·s. It both moves the body and turns it, so this is 1/mass plus a turning part.
// The impulse that changes the point's speed by Δv is Δv / this.
export function responseAt(body, rx, ry, rz, nx, ny, nz) {
  const tx = ry * nz - rz * ny, ty = rz * nx - rx * nz, tz = rx * ny - ry * nx;  // r × n
  spinFromTwist(body, tx, ty, tz, turn);
  return body.invMass + tx * turn[0] + ty * turn[1] + tz * turn[2];
}

// Move and turn the body by its velocity and spin, over h seconds.
export function integrate(body, h) {
  const p = body.position, v = body.velocity, w = body.spin, q = body.orientation;
  p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
  // The quaternion changes at ½ (spin, 0) × q per second.
  const x = q[0], y = q[1], z = q[2], qw = q[3], k = 0.5 * h;
  q[0] += k * (w[0] * qw + w[1] * z - w[2] * y);
  q[1] += k * (w[1] * qw + w[2] * x - w[0] * z);
  q[2] += k * (w[2] * qw + w[0] * y - w[1] * x);
  q[3] -= k * (w[0] * x + w[1] * y + w[2] * z);
  // A straight-line step makes q slightly longer; scale it back to 1, a pure rotation again.
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  q[0] /= len; q[1] /= len; q[2] /= len; q[3] /= len;
  updateAxes(body);
}

// Keep one point of the body, at offset r from its centre, out of the ground. If it's below
// the surface and moving into it, an impulse stops it there (bouncing back `bounce` of its
// speed), and friction resists its sliding along the ground, up to `friction` × that impulse.
// Returns how far into the ground the point is (m), measured straight out of the surface, or 0.
// The ground's normal is left in `normal`: the caller pushes the body out along it.
export function collideWithGround(body, rx, ry, rz, heightAt, bounce, friction, normal) {
  const p = body.position;
  const below = heightAt(p[0] + rx, p[2] + rz, normal) - (p[1] + ry);
  if (below <= 0) return 0;
  // Straight out of a slope is shorter than straight up: a point 1 m below a cliff's surface
  // may be only a few cm inside it. Pushed up instead, the car would pop up onto the cliff.
  const depth = below * normal[1];
  resolveContact(body, rx, ry, rz, normal, bounce, friction);
  return depth;
}

// Keep one point of the body, at offset r from its centre, out of a wall (any solid thing beside
// it): `wallAt(x, y, z, normal)` says how deep in it a point is, and the way out (into `normal`).
// The same impulses as for the ground. Returns the depth, or 0; the caller pushes the body out.
export function collideWithWall(body, rx, ry, rz, wallAt, bounce, friction, normal) {
  const p = body.position;
  const depth = wallAt(p[0] + rx, p[1] + ry, p[2] + rz, normal);
  if (depth > 0) resolveContact(body, rx, ry, rz, normal, bounce, friction);
  return depth;
}

// A point at offset r touching something whose surface faces `normal` (unit): if it's moving into
// it, stop it (bouncing back `bounce` of its speed), and resist its sliding along the surface, up to
// `friction` × that impulse.
function resolveContact(body, rx, ry, rz, normal, bounce, friction) {
  const nx = normal[0], ny = normal[1], nz = normal[2];
  velocityAt(body, rx, ry, rz, pointVel);
  const into = pointVel[0] * nx + pointVel[1] * ny + pointVel[2] * nz;  // < 0: into the ground
  if (into >= 0) return;
  const e = into < -BOUNCE_MIN_SPEED ? bounce : 0;
  const push = -(1 + e) * into / responseAt(body, rx, ry, rz, nx, ny, nz);
  applyImpulse(body, rx, ry, rz, push * nx, push * ny, push * nz);

  // Friction: slow the sliding along the ground, as far as friction allows.
  velocityAt(body, rx, ry, rz, pointVel);
  const along = pointVel[0] * nx + pointVel[1] * ny + pointVel[2] * nz;
  let sx = pointVel[0] - along * nx, sy = pointVel[1] - along * ny, sz = pointVel[2] - along * nz;
  const slide = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (slide > 1e-6) {
    sx /= slide; sy /= slide; sz /= slide;
    const drag = Math.min(slide / responseAt(body, rx, ry, rz, sx, sy, sz), friction * push);
    applyImpulse(body, rx, ry, rz, -drag * sx, -drag * sy, -drag * sz);
  }
}

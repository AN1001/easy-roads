// 4x4 matrices, stored column-major in a Float32Array (the layout WebGL expects).
//
// Every function writes into an `out` matrix you pass in, instead of creating a new one,
// so the game loop can reuse the same few matrices forever and never produce garbage.

export function mat4() {
  return new Float32Array(16);
}

const scratch = mat4();

// out = a * b. Safe when out is the same matrix as a or b.
export function multiply(out, a, b) {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      scratch[col * 4 + row] = sum;
    }
  }
  out.set(scratch);
  return out;
}

// Camera lens: things further away get smaller. fovY is in radians.
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

// Camera at (ex, ey, ez) looking at (tx, ty, tz), with +y as up.
// Takes plain numbers rather than arrays, so calling it every frame allocates nothing.
export function lookAt(out, ex, ey, ez, tx, ty, tz) {
  // f: forward direction, normalised
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  let len = Math.hypot(fx, fy, fz);
  fx /= len; fy /= len; fz /= len;
  // s: sideways = forward × up, where up = (0, 1, 0)
  let sx = -fz, sz = fx;
  len = Math.hypot(sx, sz);
  sx /= len; sz /= len;
  // u: the camera's true up = sideways × forward
  const ux = -sz * fy, uy = sz * fx - sx * fz, uz = sx * fy;

  out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = 0;  out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = -(sx * ex + sz * ez);
  out[13] = -(ux * ex + uy * ey + uz * ez);
  out[14] = fx * ex + fy * ey + fz * ez;
  out[15] = 1;
  return out;
}

// The 6 planes of the camera's view volume, from a view-projection matrix.
// Each plane is (a, b, c, d): a point is on the visible side when a·x + b·y + c·z + d ≥ 0.
// Plane = row 3 ± row 0 (left/right), ± row 1 (bottom/top), ± row 2 (near/far).
export function frustumPlanes(out, m) {
  for (let row = 0; row < 3; row++) {
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const p = (row * 2 + side) * 4;
      out[p] = m[3] + sign * m[row];
      out[p + 1] = m[7] + sign * m[4 + row];
      out[p + 2] = m[11] + sign * m[8 + row];
      out[p + 3] = m[15] + sign * m[12 + row];
    }
  }
  return out;
}

// False when a box is entirely outside the view volume, so it can't appear on screen.
export function boxInFrustum(planes, minX, minY, minZ, maxX, maxY, maxZ) {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p], b = planes[p + 1], c = planes[p + 2];
    // The box corner furthest to the visible side: if even that is outside, all of it is.
    const x = a > 0 ? maxX : minX, y = b > 0 ? maxY : minY, z = c > 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + planes[p + 3] < 0) return false;
  }
  return true;
}

export function translation(out, x, y, z) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function rotationX(out, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  out.fill(0);
  out[0] = out[15] = 1;
  out[5] = c;  out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

export function rotationY(out, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  out.fill(0);
  out[5] = out[15] = 1;
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

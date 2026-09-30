#version 300 es
// Rain: each drop a short line (2 vertices, from gl_VertexID: no vertex buffer), falling through a
// box round the camera. A drop's place in the box comes from hashing its number; it falls with
// the time, and wraps round the box, which moves with the camera. So the rain is fixed in the world
// (driving through it, you pass the drops), there's always rain round the camera, and JS does
// nothing per drop.

#include "frame.glsl"

out vec3 vWorldPos;
out float vOpacity;
flat out ivec2 vShift;

const vec3 BOX = vec3(40.0, 20.0, 40.0);  // m: x, height, z
const float BELOW = 0.35;                 // of the box's height is below the camera
const vec3 FALL = vec3(1.1, -9.0, -0.4);  // m/s: falling, and blown a little along the wind (bamboo.glsl's WIND)
const float STREAK = 0.04;                // s: each drop is the line it falls through in this long, as a camera's shutter sees it
const float OPACITY = 0.55;

uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  return x ^ (x >> 16);
}

void main() {
  uint h = hash(uint(gl_VertexID >> 1));
  vec3 seed = vec3(uvec3(h, h >> 10, h >> 20) & 1023u) / 1024.0;
  vec3 corner = uCamera.xyz - BOX * vec3(0.5, BELOW, 0.5);
  vec3 p = corner + mod(seed * BOX + FALL * uTime.x - corner, BOX);
  if ((gl_VertexID & 1) == 1) p -= FALL * STREAK;  // the tail, above
  vWorldPos = p;
  gl_Position = uViewProj * vec4(p, 1.0);
  // Faint right by the lens, and fading out before the box's sides, where drops wrap round.
  float across = length(p.xz - uCamera.xz);
  vOpacity = OPACITY * smoothstep(0.5, 2.0, distance(p, uCamera.xyz)) * (1.0 - smoothstep(0.3 * BOX.x, 0.5 * BOX.x, across));
  vShift = ivec2(h >> 28 & 3u, h >> 30);
}

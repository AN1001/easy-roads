#version 300 es
// Dust, smoke and water (particles.js): one point each, drawn as a square on screen, as big as the
// particle is at its distance.

#include "frame.glsl"

// Fixed locations, as for the car (main.js).
layout(location = 0) in vec4 aPoint;  // xyz = centre (m), w = size across (m)
layout(location = 1) in vec3 aLook;   // x = opacity, y = colour (an index into COLORS), z = dither shift (0-15)
uniform float uPointScale;  // pixels across for something 1 m across, 1 m in front of the camera

out vec3 vWorldPos;
out vec3 vColor;
out float vOpacity;
flat out ivec2 vShift;

// Earth (FLOOR in terrain.frag, a little paler) and the road's sand (SAND); tyre smoke and exhaust;
// water, pale with the sky it catches.
const vec3 COLORS[5] = vec3[5](vec3(0.30, 0.28, 0.18), vec3(0.50, 0.43, 0.31),
                               vec3(0.60, 0.60, 0.60), vec3(0.55, 0.56, 0.60),
                               vec3(0.85, 0.90, 0.95));

void main() {
  vWorldPos = aPoint.xyz;
  gl_Position = uViewProj * vec4(aPoint.xyz, 1.0);
  // gl_Position.w is the distance in front of the camera. Capped, so a puff drifting past the
  // lens doesn't cover the screen.
  gl_PointSize = min(aPoint.w * uPointScale / gl_Position.w, 64.0);
  vColor = COLORS[int(aLook.y)];
  vOpacity = aLook.x * smoothstep(1.0, 2.5, gl_Position.w);  // and it fades out there
  int shift = int(aLook.z);
  vShift = ivec2(shift & 3, shift >> 2);
}

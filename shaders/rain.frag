#version 300 es
// A raindrop's streak: pale, see-through by the dither pattern, catching the sky (drawn only when it rains: main.js's RAIN).

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in float vOpacity;
flat in ivec2 vShift;
out vec4 color;

const vec3 RAIN = vec3(0.75, 0.80, 0.86);

void main() {
  if (vOpacity < threshold(ivec2(gl_FragCoord.xy) + vShift)) discard;
  // Not lit by the headlight (until 1 Oct 2026 it was, far brighter than anything else at night:
  // the drops crossing the beam flickered), only faintly by the tail lights just behind the car.
  vec3 light = 0.7 * daylight(vec3(0.0, 1.0, 0.0)) + 0.5 * tailGlow(vWorldPos, normalize(uTail.xyz - vWorldPos));
  color = vec4(dither(mix(RAIN * light, mistColor(vWorldPos), mist(vWorldPos))), 1.0);
}

#version 300 es
// A raindrop's streak: pale, see-through by the dither pattern, catching the dusk and, far brighter,
// the headlight.

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
  vec3 light = 0.7 * dusk(vec3(0.0, 1.0, 0.0)) + LAMP_COLOR * headlight(vWorldPos, normalize(uLamp.xyz - vWorldPos));
  color = vec4(dither(mix(RAIN * light, mistColor(vWorldPos), mist(vWorldPos))), 1.0);
}

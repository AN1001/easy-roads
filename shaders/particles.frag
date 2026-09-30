#version 300 es
// A puff of dust or smoke: round, thinning to its edge, and see-through by the dither pattern
// ("screen door" transparency: some pixels drawn, the rest left alone), so nothing is blended and
// the colours stay on the PS1's 32 levels. Lit by the sky, the headlight and the tail lights.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in vec3 vColor;
in float vOpacity;
flat in ivec2 vShift;  // each particle shifts the pattern, so overlapping ones don't all
                       // cover the same pixels, and a thicker cloud looks thicker
out vec4 color;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (vOpacity * (1.0 - dot(c, c)) < threshold(ivec2(gl_FragCoord.xy) + vShift)) discard;

  // A puff is lit from all round, and scatters the light towards the camera, so it shows against
  // the ground it came from: the sky as if facing up, and the headlight as if facing it.
  vec3 light = dusk(vec3(0.0, 1.0, 0.0)) + LAMP_COLOR * headlight(vWorldPos, normalize(uLamp.xyz - vWorldPos));
  color = vec4(dither(mix(vColor * light, mistColor(vWorldPos), mist(vWorldPos))), 1.0);
}

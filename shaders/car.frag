#version 300 es
// Textured, flat-shaded car, lit by the same sun and sky as the terrain, with glowing tail
// lights. Its own headlight points away from it, so it gets none.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in vec2 vUV;
uniform sampler2D uTexture;  // texture unit 0: main.js binds the body's or the wheel's
out vec4 color;

const vec3 BURN = vec3(0.0, 0.45, 0.3);  // where the tail lights' red overflows to

void main() {
  vec3 normal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  vec3 light = daylight(normal);
  vec3 texel = texture(uTexture, vUV).rgb;
  // Tail lights glow: shown at their own brightness (uTail.w: on while driving, three times as bright
  // braking), not lit by the sky. They're the texture's pure reds (green exactly 0, blue under 0.05;
  // the livery's reds keep a little green). Past what red can show, the rest burns towards white, as
  // a bright lamp does in a photo: braking, their brightest parts go orange-white, their edges red.
  bool tailLight = texel.r > 0.4 && max(texel.g, texel.b) < 0.05;
  vec3 lamp = texel * uTail.w;
  lamp += max(lamp.r - 1.0, 0.0) * BURN;
  color = vec4(dither(tailLight ? lamp : texel * light), 1.0);
}

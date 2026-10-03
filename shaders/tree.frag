#version 300 es
// The broadleaf trees (trees.js): their texture (assets/tree_01/tree_01.png), its leaves and twigs
// cut out by its alpha, dithered where a pixel covers some leaf and some not (far off, where the
// mipmaps blend them), so the crowns don't thin out with distance; lit as the bridges are (the sky,
// the headlight, the tail lights), the leaves softly (light through them: partly as if they faced
// up); darkened to the dusk; fading into the mist.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"
#include "near.glsl"

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec4 vMist;
uniform mediump sampler2D uTree;  // texture unit 6
out vec4 color;

const float BARK_FROM_U = 2.0 / 3.0;  // trees.js
const float SHADE = 0.75;  // its texture is lit for a sunny day: this much of it at dusk

void main() {
  if (tooNear(vWorldPos)) discard;
  vec4 texel = texture(uTree, vUV);
  bool bark = vUV.x >= BARK_FROM_U;
  if (!bark && min(texel.a * 1.5, 1.0) <= threshold(ivec2(gl_FragCoord.xy))) discard;
  vec3 normal = normalize(vNormal);
  vec3 base = SHADE * texel.rgb;
  vec3 tail = tailGlow(vWorldPos, normal);
  vec3 light = daylight(normal) + LAMP_COLOR * headlight(vWorldPos, normal) + tail;
  if (!bark) light = 0.6 * light + 0.3 * daylight(vec3(0.0, 1.0, 0.0));
  color = vec4(dither(mix(base * light, vMist.rgb, vMist.a)), 1.0);
}

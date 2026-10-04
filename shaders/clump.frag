#version 300 es
// A far clump of bamboo: its picture (textures.js), see-through between the stalks and leaves by the
// dither pattern, like the leaves; further off, where the mipmaps blur it to how much of it is
// bamboo, thinning out into a haze of them. Lit and misted by clump.vert.

precision highp float;

#include "dither.glsl"

in vec2 vUV;
in vec3 vScale, vAdd;
flat in ivec2 vShift;  // each clump shifts the pattern, so overlapping cards cover different pixels
flat in float vShown;  // how much of it is there: the rest dissolves, where it's swapping with its stalks
flat in float vLayer;  // the bamboo's clumps, or the cedars' (clump.vert)
uniform mediump sampler2DArray uGround;  // texture unit 1 (textures.js)
out vec4 color;

void main() {
  vec4 texel = texture(uGround, vec3(vUV, vLayer));
  if (texel.a * vShown < threshold(ivec2(gl_FragCoord.xy) + vShift)) discard;
  color = vec4(dither(texel.rgb * vScale + vAdd), 1.0);
}

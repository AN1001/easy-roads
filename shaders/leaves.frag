#version 300 es
// Bamboo leaves: the leaves' texture (textures.js), see-through between them by the dither pattern
// (like the particles: no blending, no sorting), which also thins them out into the distance, where
// the mipmaps blur each card to how much of it is leaf, and right by the camera, where a card's
// texels would be the size of the screen. Lit and misted by leaves.vert.

precision highp float;

#include "frame.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in vec2 vUV;
in vec3 vScale, vAdd;
flat in ivec2 vShift;  // each stalk shifts the pattern, so overlapping cards cover different pixels
flat in float vShown;  // how much of it is there: the rest dissolves
flat in float vLayer;  // of the texture array (leaves.vert)
uniform mediump sampler2DArray uGround;  // texture unit 1 (textures.js)
out vec4 color;

const float CLEAR_OF_LENS = 2.0, SEEN_FROM = 5.0;  // m from the camera: none, then all of them
const float FAR_LEAVES_LAYER = 8.0;                 // leaves.vert's
// The near cards' leaves, where the mipmaps blur them, × this. A stalk's 3 cards dissolve by the
// same pattern, so where they cross, the one's leaves take the same pixels as the other's; the far
// card's picture of them has each leaf where it is. So at 24-36 m, where the one gives way to the
// other, the near cards covered a fifth less (measured in headless Chrome, 4 views): the leaves
// thinned as the car came up. Up close, a leaf's texels are all or nothing, and it changes nothing.
const float NEAR_LEAVES = 1.4;

void main() {
  vec4 texel = texture(uGround, vec3(vUV, vLayer));
  float lens = smoothstep(CLEAR_OF_LENS, SEEN_FROM, distance(vWorldPos, uCamera.xyz));
  // Where a stalk is both, swapping from its near cards to its far one (bamboo.js), the far one
  // counts the pattern the other way: between them, the pixels either would cover. (Counted the
  // same way until 29 Sep 2026, both kept the same pixels: half way, a third of the leaves were
  // missing, and they flickered thin as the car came up.)
  float pattern = threshold(ivec2(gl_FragCoord.xy) + vShift), leaf = texel.a;
  if (vLayer == FAR_LEAVES_LAYER) pattern = 1.0 - pattern;
  else leaf = min(leaf * NEAR_LEAVES, 1.0);
  if (leaf * lens * vShown < pattern) discard;
  color = vec4(dither(texel.rgb * vScale + vAdd), 1.0);
}

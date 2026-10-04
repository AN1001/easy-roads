#version 300 es
// A bamboo stalk: its culm texture (ringed at the nodes), or a cedar's trunk, its bark; lit, sheened
// and misted by stalk.vert.

precision highp float;

#include "dither.glsl"

in vec2 vUV;
in vec3 vScale, vAdd;
flat in float vLayer;  // the culm's, or the cedar's bark (stalk.vert)
uniform mediump sampler2DArray uGround;  // texture unit 1 (textures.js)
out vec4 color;

void main() {
  // Mipmap level from how fast the texture runs up the stalk only: round it, a whole strip can be
  // under one pixel, and choosing by that would blur the nodes away.
  float lod = log2(max(abs(dFdx(vUV.y)), abs(dFdy(vUV.y))) * 128.0);
  color = vec4(dither(textureLod(uGround, vec3(vUV, vLayer), lod).rgb * vScale + vAdd), 1.0);
}

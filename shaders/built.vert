#version 300 es
// Things built of blocks (blocks.js): the bridges; and the cherry and maple trees (trees.js), whose
// blossom and leaves stir in the wind. Each vertex: its world position, its face's
// normal, where it is on its texture (m), its colour, and which layer of the texture array it
// wears. The mist over it worked out here, as for the land.

#include "frame.glsl"
#include "sky.glsl"

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aLayer;  // -1: no texture

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
flat out float vLayer;
out vec4 vMist;     // rgb: the mist's colour; a: how much of it

const float BLOSSOM_LAYER = 11.0, LEAF_LAYER = 13.0;  // textures.js

void main() {
  vec3 position = aPosition;
  if (abs(aLayer - BLOSSOM_LAYER) < 0.5 || abs(aLayer - LEAF_LAYER) < 0.5) {
    float t = uTime.x;
    position += 0.05 * vec3(sin(t * 1.7 + position.x * 0.7 + position.y), 0.4 * sin(t * 2.3 + position.z), cos(t * 1.3 + position.z * 0.7));
  }
  vWorldPos = position;
  vNormal = aNormal;
  vUV = aUV;
  vColor = aColor;
  vLayer = aLayer;
  vMist = vec4(mistColor(position), mist(position));
  gl_Position = uViewProj * vec4(position, 1.0);
}

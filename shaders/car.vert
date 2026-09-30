#version 300 es
// Car body and wheels: model position (metres) and texture coordinate.

#include "frame.glsl"

// Fixed locations, so the body and wheel VAOs in main.js can use them without looking them up.
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUV;
uniform mat4 uModel;  // model -> world: where the body or one wheel is, and how it's turned

out vec3 vWorldPos;
out vec2 vUV;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vUV = aUV;
  gl_Position = uViewProj * world;
}

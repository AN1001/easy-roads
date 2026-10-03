#version 300 es
// Car body and wheels: model position (metres) and texture coordinate.

#include "frame.glsl"

// Fixed locations, so the body and wheel VAOs in main.js can use them without looking them up.
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUV;
// Model -> world: where the body and each wheel are, and how they're turned (main.js). The body's
// drawn once (uFirst 0), the wheel four times, as copies (uFirst 1: the copy's number picks its own).
uniform mat4 uModels[5];
uniform int uFirst;

out vec3 vWorldPos;
out vec2 vUV;

void main() {
  vec4 world = uModels[uFirst + gl_InstanceID] * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vUV = aUV;
  gl_Position = uViewProj * world;
}

#version 300 es
// The sky, behind everything: one triangle covering the screen (3 corners from gl_VertexID, no
// vertex buffer), at the far plane, so it only shows where nothing else was drawn.

#include "frame.glsl"

out vec4 vFar;  // the point on the far plane under this corner, before dividing by w

void main() {
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 1.0, 1.0);  // depth 1: main.js tests it with LEQUAL
  // Back from the screen into the world. Undivided, it's linear across the screen, so it can be
  // interpolated; divided (in the fragment shader), it's the point itself.
  vFar = inverse(uViewProj) * gl_Position;
}

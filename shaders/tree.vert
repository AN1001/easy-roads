#version 300 es
// The broadleaf trees (trees.js): one of three shapes, drawn once per tree of that shape
// (instanced), each moved to where it stands, turned and sized. Its leaves stir in the wind, the
// higher the more. The mist over it worked out here, as for the land.

#include "frame.glsl"
#include "sky.glsl"

layout(location = 0) in vec3 aPosition;  // m, standing at 0, 0, 0
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in float aSway;     // 0 on the bark; the leaves, up to 1 at the top
layout(location = 4) in vec4 aTree;      // per tree: where it stands (x, y, z), how it's turned
layout(location = 5) in float aScale;    // per tree: its size

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec4 vMist;

const float SWAY = 0.12;  // m, at the top

void main() {
  float c = cos(aTree.w), s = sin(aTree.w);
  vec3 p = aPosition * aScale;
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z) + aTree.xyz;
  float t = uTime.x;
  p += SWAY * aSway * vec3(sin(t * 1.1 + aTree.x * 0.3 + p.y * 0.4), 0.2 * sin(t * 2.3 + p.x), cos(t * 0.9 + aTree.z * 0.3 + p.y * 0.3));
  vWorldPos = p;
  vNormal = vec3(c * aNormal.x - s * aNormal.z, aNormal.y, s * aNormal.x + c * aNormal.z);
  vUV = aUV;
  vMist = vec4(mistColor(p), mist(p));
  gl_Position = uViewProj * vec4(p, 1.0);
}

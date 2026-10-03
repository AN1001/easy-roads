#version 300 es
// The ground cover (nature.js): grass, flowers, reeds, ferns, bushes and rocks. One kind's model,
// drawn once per copy of it (instanced), each moved to where it stands, turned and sized; fading
// out (dithered: nature.frag) between uFade's two distances, and beyond them, not drawn at all (put
// outside the view). The higher a vertex, the more it stirs in the wind. The mist over it worked
// out here.

#include "frame.glsl"
#include "sky.glsl"

layout(location = 0) in vec3 aPosition;  // m, standing at 0, 0, 0
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;        // m across a card (8: the texture once)
layout(location = 3) in float aSway;     // 0 at its foot, 1 at its top
layout(location = 4) in vec4 aCopy;      // per copy: where it stands (x, y, z), how it's turned
layout(location = 5) in float aScale;    // per copy: its size
layout(location = 6) in vec3 aColor;
layout(location = 7) in float aLayer;    // the texture array's layer; -1 none, -2 rock
uniform vec2 uFade;   // m from the camera: from here, fading to nothing by here
uniform float uSway;  // m: how far its top stirs

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
flat out float vLayer;
out vec4 vMist;
flat out float vFade;  // 1 all there, 0 gone

void main() {
  float range = distance(aCopy.xz, uCamera.xz);
  vFade = 1.0 - smoothstep(uFade.x, uFade.y, range);
  if (vFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }  // outside the view: nothing drawn
  float scale = aScale;
  float c = cos(aCopy.w), s = sin(aCopy.w);
  vec3 p = aPosition * scale;
  p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z) + aCopy.xyz;
  float t = uTime.x;
  p += uSway * aSway * vec3(sin(t * 1.3 + aCopy.x * 0.4 + p.y * 0.5), 0.0, cos(t * 1.1 + aCopy.z * 0.4 + p.y * 0.4));
  vWorldPos = p;
  vNormal = vec3(c * aNormal.x - s * aNormal.z, aNormal.y, s * aNormal.x + c * aNormal.z);
  vUV = aUV;
  vColor = aColor;
  vLayer = aLayer;
  vMist = vec4(mistColor(p), mist(p));
  gl_Position = uViewProj * vec4(p, 1.0);
}

// Per-frame values shared by every shader, uploaded once per frame as one uniform buffer. Must
// match frameData in main.js (std140 layout: a mat4, then vec4s). Pasted into each shader by
// `#include "frame.glsl"` (see loadProgram in gl.js).
layout(std140) uniform Frame {
  mat4 uViewProj;   // world -> screen (camera position + lens)
  vec4 uCamera;     // xyz = camera position
  vec4 uFog;        // x = m where the mist starts, y = m where it's all mist, z = its thickness (sky.glsl)
  vec4 uLamp;       // xyz = headlight position
  vec4 uLampDir;    // xyz = direction it points (unit length)
  vec4 uTail;       // xyz = between the tail lights (no shader uses it now), w = how bright they are
  vec4 uTime;       // x = seconds since the game started (the rain, the wind, the clouds), y = m one
                    // pixel spans 1 m in front of the camera
};

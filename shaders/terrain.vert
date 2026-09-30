#version 300 es
// Places each terrain vertex. The vertex buffer holds only its height, how far it is from the
// road's edge, the ground's normal and how thick the bamboo grows there: x and z are worked out from
// the vertex's index within its chunk, the chunk's position and how far apart its vertices are (its
// level of detail, terrain.js). Also the daylight on it and the mist over it, which change slowly
// enough across a triangle to blend (the headlight's cone doesn't: terrain.frag lights that).

#include "frame.glsl"
#include "sky.glsl"

// Two 16-bit integers (see terrain.js): height in cm, and cm from the road's edge (frayed,
// negative on the road).
layout(location = 0) in ivec2 aVertex;
// xyz: the ground's unit normal, from the heights around it; w: how thick the bamboo grows, 0 to 1.
// (One attribute of 4 bytes: Metal reads attributes straight from the buffer only if each starts on
// a multiple of 4 bytes, and the browser would otherwise convert the buffer first.)
layout(location = 1) in vec4 aNormal;
uniform vec3 uChunk;  // world x/z of the chunk's first vertex, and m between its vertices

out vec3 vWorldPos;
out vec3 vNormal;
out float vEdge;    // m from the road's edge: negative on it
out float vGrove;
out vec3 vDusk;     // the daylight on it (sky.glsl), less under the groves
out vec4 vMist;     // rgb: the mist's colour; a: how much of it

const float GROVE_SHADE = 0.4;  // the thickest bamboo keeps this much of the sky off the ground

// Vertices along each side of a chunk: must match CHUNK_VERTS in terrain.js.
// A constant rather than a uniform, so the compiler can turn the divides below into a
// multiply and shift (integer division is slow on GPUs).
const int SIZE = 31, VERTICES = SIZE * SIZE;

void main() {
  int col = gl_VertexID % SIZE, row = gl_VertexID / SIZE;
  if (gl_VertexID >= VERTICES) {
    // A skirt's: the t-th along side 0 (row 0), 1 (the last row), 2 (column 0) or 3 (the last
    // column), again, lower (terrain.js has lowered its height).
    int k = gl_VertexID - VERTICES, side = k / SIZE, t = k % SIZE;
    col = side < 2 ? t : side == 2 ? 0 : SIZE - 1;
    row = side >= 2 ? t : side == 0 ? 0 : SIZE - 1;
  }
  float x = uChunk.x + float(col) * uChunk.z;
  float z = uChunk.y + float(row) * uChunk.z;
  vWorldPos = vec3(x, float(aVertex.x) * 0.01, z);
  vNormal = aNormal.xyz;
  vEdge = float(aVertex.y) * 0.01;
  vGrove = aNormal.w;
  vDusk = dusk(normalize(aNormal.xyz)) * (1.0 - GROVE_SHADE * vGrove);
  vMist = vec4(mistColor(vWorldPos), mist(vWorldPos));
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}

#version 300 es
// Places each terrain vertex. Each chunk is a copy (instance) of one draw for all of them (main.js),
// and its vertices a row of uTerrain, holding only each one's height, how far it is from the road's
// edge, the ground's normal and how thick the bamboo grows there: x and z are worked out from the
// vertex's index within its chunk, the chunk's position and how far apart its vertices are (its
// level of detail, terrain.js). Also the daylight on it and the mist over it, which change slowly
// enough across a triangle to blend (the headlight's cone doesn't: terrain.frag lights that).

#include "frame.glsl"
#include "sky.glsl"

// Per vertex, a texel of four 16-bit integers (see terrain.js): height in cm; cm from the road's edge
// (frayed, negative on the road); then as bytes, low then high, the ground's unit normal's x and the
// river's shore (terrain.js shoreByte), and its z and how thick the bamboo grows (0 to 127), or,
// negative, how much riverbed (-127 under a river's water). (The normal's y is the rest of its
// length.) A row a chunk slot (main.js).
uniform highp isampler2D uTerrain;  // texture unit 7
// Per chunk: world x/z of its first vertex, m between its vertices, and its slot's row of uTerrain.
layout(location = 0) in vec4 aChunk;

out vec3 vWorldPos;
out vec3 vNormal;
out float vEdge;    // m from the road's edge: negative on it
out float vGrove;
out vec2 vShore;    // m past the river's water's edge (-0.6 under it, 2.5 away from it), and how wide its shingle (m)
out vec3 vDaylight;     // the daylight on it (sky.glsl), less under the groves
out vec4 vMist;     // rgb: the mist's colour; a: how much of it

const float GROVE_SHADE = 0.4;
const float SHORE_UNDER = 0.6, SHINGLE_STEP = 0.35;  // m: as terrain.js's  // the thickest bamboo keeps this much of the sky off the ground

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
  ivec4 v = texelFetch(uTerrain, ivec2(gl_VertexID, int(aChunk.w)), 0);
  // The bytes, -127 to 127 as -1 to 1, as a normalized attribute's were (until 3 Oct 2026).
  vec4 normal = max(vec4((v.z << 24) >> 24, 0, (v.w << 24) >> 24, v.w >> 8) / 127.0, -1.0);
  normal.y = sqrt(max(1.0 - normal.x * normal.x - normal.z * normal.z, 0.0));
  int shore = (v.z >> 8) & 255;
  vShore = vec2(float(shore & 31) * 0.1 - SHORE_UNDER, float(shore >> 5) * SHINGLE_STEP);
  float x = aChunk.x + float(col) * aChunk.z;
  float z = aChunk.y + float(row) * aChunk.z;
  vWorldPos = vec3(x, float(v.x) * 0.01, z);
  vNormal = normal.xyz;
  vEdge = float(v.y) * 0.01;
  vGrove = normal.w;  // negative on a river's bed (terrain.js)
  vDaylight = daylight(normalize(normal.xyz)) * (1.0 - GROVE_SHADE * max(vGrove, 0.0));
  vMist = vec4(mistColor(vWorldPos), mist(vWorldPos));
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}

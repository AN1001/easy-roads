#version 300 es
// The rivers' water: a layer of its own over the riverbed, on the same grid as the chunk's land
// (terrain.vert), for chunks near a river. The vertex buffer holds the water's height and how deep
// it is there (terrain.js: slot.water); x and z come from the vertex's index, as the land's do.

#include "frame.glsl"
#include "sky.glsl"

// Two 16-bit integers: the water's height in cm, and how deep it is in cm (negative above it,
// -1000 away from the river: water.frag draws none there).
layout(location = 0) in ivec2 aWater;
uniform vec3 uChunk;  // world x/z of the chunk's first vertex, and m between its vertices

out vec3 vWorldPos;
out float vDepth;
out vec3 vDaylight;
out vec4 vMist;

const int SIZE = 31;  // vertices along each side of a chunk (CHUNK_VERTS in terrain.js)

void main() {
  int col = gl_VertexID % SIZE, row = gl_VertexID / SIZE;
  vWorldPos = vec3(uChunk.x + float(col) * uChunk.z, float(aWater.x) * 0.01, uChunk.y + float(row) * uChunk.z);
  vDepth = float(aWater.y) * 0.01;
  vDaylight = daylight(vec3(0.0, 1.0, 0.0));
  vMist = vec4(mistColor(vWorldPos), mist(vWorldPos));
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}

#version 300 es
// A clump of bamboo, far off (bamboo.js): one card, turned to face the camera, standing at the
// clump's foot (terrain.js, plantClumps) as tall as the clump, with a picture of a clump of stalks
// and their leaves (textures.js): one of two, either way round. Its top sways with the gusts, as
// the stalks' do. Lit by the dusk alone (the headlight doesn't reach this far), and misted at its
// corners: across a card this far off, the mist barely changes.

#include "frame.glsl"
#include "bamboo.glsl"
#include "sky.glsl"

uniform highp sampler2D uClumps;  // texture unit 3: a row per chunk slot (main.js)

out vec2 vUV;
out vec3 vScale, vAdd;  // the colour is the picture's × vScale + vAdd: lit, then misted
flat out ivec2 vShift;
flat out float vShown;  // how much of it is there (bamboo.glsl): the rest dissolves

const float WIDTH = 6.0;                    // m: the square it stands for (terrain.js's CLUMP)
const vec3 LEAF = vec3(0.18, 0.30, 0.09);   // leaves.vert's: the picture's colours are shades of it

void main() {
  int corner;  // 0-3: left and right at the bottom, then at the top
  uvec2 entry = loadEntry(corner);
  vec4 clump = texelFetch(uClumps, ivec2(int(entry.x & 1023u), int(entry.x >> 10)), 0);
  float across = float(corner & 1) * 2.0 - 1.0, up = float(corner >> 1);
  float random = fract(dot(clump.xz, vec2(0.1031, 0.1377)) * 7.0);
  vec2 toCamera = normalize(uCamera.xz - clump.xz), side = vec2(-toCamera.y, toCamera.x);
  vec3 pos = vec3(clump.x, clump.y + mix(-BURIED, clump.w, up), clump.z);
  pos.xz += side * (0.5 * WIDTH * across) + (up * SWAY * gust(clump.xz)) * WIND;
  // The texture's left or right half, either way round.
  float picture = random < 0.5 ? 0.25 : 0.75, flip = fract(2.0 * random) < 0.5 ? -0.25 : 0.25;
  vUV = vec2(picture + flip * across, up);
  float misted = mist(pos);
  vScale = LEAF * 2.0 * dusk(vec3(0.0, 1.0, 0.0)) * (1.0 - misted);
  vAdd = mistColor(pos) * misted;
  int shift = int(random * 16.0);
  vShift = ivec2(shift & 3, shift >> 2);
  vShown = entryShown(entry);
  gl_Position = uViewProj * vec4(pos, 1.0);
}

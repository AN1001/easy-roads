// Bamboo, placed: shared by stalk.vert, leaves.vert and clump.vert (`#include "bamboo.glsl"` after
// frame.glsl). Each stalk, as terrain.js planted it, stood at its base, leaning, swaying in the wind,
// bent aside by the car (bamboo.js keeps how far, as it springs back) and by the camera.
//
// No vertex buffers (see bamboo.js): gl_VertexID is an entry of this frame's list × the model's
// stride + the vertex's number in the model, counting entries from uFirst. The entry says which
// stalk (or clump) it is: its first texel in uStalks (or its chunk's row of uClumps and its number
// there); whether the car's bent it (BENT: then how far is at the same entry of uBends); and how much
// of it is there.

const int LIST_WIDTH = 1024, STALK_WIDTH = 1600;  // must match bamboo.js
const uint BENT = 1048576u;         // bamboo.js's
uniform highp usampler2D uList;     // texture unit 4: this frame's (bamboo.js)
uniform highp usampler2D uBends;    // texture unit 8: this frame's bends, at the entries marked BENT
uniform highp sampler2D uStalks;    // texture unit 2: 2 texels a stalk (main.js)
uniform int uFirst;                 // the entry this draw starts at
uniform int uStride;                // vertices per stalk in this draw's model

// The stalk (terrain.js, plantBamboo): xyz = its base (m), w = its height (m); then x = its radius
// (m), y = which strip of the culm texture it wears, z and w = how far it leans along x and z (the
// sine of the angle each way). How far the car has bent it, likewise. And how much of it is there,
// 0 to 1 (all of it): the rest has dissolved, where it's swapping with its clump (bamboo.js).
vec4 stalk, look;
vec2 bend;
float shown;

// The list's entry for this vertex, and (out) the vertex's number in the model and where the entry is.
uint loadEntry(out int k, out ivec2 at) {
  int index = gl_VertexID / uStride, entry = uFirst + index;
  k = gl_VertexID - index * uStride;
  at = ivec2(entry % LIST_WIDTH, entry / LIST_WIDTH);
  return texelFetch(uList, at, 0).x;
}

// How much of an entry's stalk or clump is there, 0 to 1: its top 8 bits.
float entryShown(uint entry) {
  return float(entry >> 24) / 255.0;
}

// Loads the stalk this vertex belongs to, and returns the vertex's number in the model.
int loadStalk() {
  int k;
  ivec2 at;
  uint entry = loadEntry(k, at);
  int texel = int(entry & 0xfffffu);
  ivec2 place = ivec2(texel % STALK_WIDTH, texel / STALK_WIDTH);
  stalk = texelFetch(uStalks, place, 0);
  look = texelFetch(uStalks, place + ivec2(1, 0), 0);
  // Two 12-bit signed fractions, x in the lowest bits. (Not unpackSnorm2x16: Firefox on macOS turns
  // it into desktop GLSL that needs an extension, which it switches on in the wrong place.)
  bend = vec2(0.0);
  if ((entry & BENT) != 0u) {
    uint bent = texelFetch(uBends, at, 0).x;
    vec2 halves = vec2(uvec2(bent, bent >> 12) & 0xfffu);
    bend = (halves - step(2048.0, halves) * 4096.0) / 2047.0;
  }
  shown = entryShown(entry);
  return k;
}

const float BURIED = 0.3;      // m of each stalk below the ground: coarser land may be drawn a little lower

// The camera, following the car through a grove, bends stalks aside too: those within CAMERA_REACH
// m lean clear of the lens.
const float CAMERA_REACH = 1.2;  // m

// A gentle breeze: gusts sweep across the groves along WIND, bending the stalks over and letting
// them go, and each stalk rocks a little on its own. SWAY: m at the tip of a stalk, at most.
const vec2 WIND = vec2(0.94, -0.34);
const float SWAY = 0.35;
const float GUST_WAVE = 30.0, GUST_SPEED = 5.0;  // m apart, m/s

// How hard the gust is blowing at `xz`, 0 to 1.
float gust(vec2 xz) {
  return 0.5 + 0.5 * sin(6.2832 * (dot(xz, WIND) - GUST_SPEED * uTime.x) / GUST_WAVE);
}

// A stalk's own random number, 0 to 1, from its strip and position.
float stalkRandom() {
  return fract(look.y * 0.231 + dot(floor(stalk.xz * 4.0), vec2(0.1031, 0.1377)));
}

// Which way the stalk leans (the sine of the angle from upright, along x and z): its own lean, as
// the car bent it, and away from the camera if it's in the way.
vec2 stalkTilt() {
  vec2 lean = look.zw + bend, away = stalk.xz - uCamera.xz;
  float gap = length(away), push = CAMERA_REACH - gap, up = uCamera.y - stalk.y;
  if (push > 0.0 && up > 0.0 && up < stalk.w) lean += (gap > 1e-3 ? away / gap : vec2(1.0, 0.0)) * push / max(up, 1.0);
  float amount = length(lean);
  return amount > 0.95 ? lean * (0.95 / amount) : lean;
}

// The point of the stalk's middle `h` m up it (from its base, along it), given its tilt.
vec3 stalkAxis(float h, vec2 tilt) {
  float height = stalk.w, up = sqrt(1.0 - dot(tilt, tilt)), phase = 6.2832 * stalkRandom();
  float rock = sin(1.7 * uTime.x + phase), across = sin(1.3 * uTime.x + 1.7 * phase);
  float f = max(h, 0.0) / height;
  vec2 sway = SWAY * f * f * (WIND * (0.6 * gust(stalk.xz) + 0.25 * rock) + vec2(-WIND.y, WIND.x) * 0.15 * across);
  return vec3(stalk.x + tilt.x * h + sway.x, stalk.y + up * h, stalk.z + tilt.y * h + sway.y);
}

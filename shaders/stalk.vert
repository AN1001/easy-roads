#version 300 es
// A bamboo stalk: the model's (bamboo.js) 5-sided tube, placed by bamboo.glsl, tapering to its tip,
// and never thinner than about a pixel (thinner, it would flicker in and out between pixels); or
// far off, its line. Further still, clumps (clump.vert) take over from it. Lit and misted here, at
// its corners, as the PS1 lit things: per pixel, the stalks' pass measured twice the cost.

#include "frame.glsl"
#include "bamboo.glsl"
#include "sky.glsl"

// The model (bamboo.js): the tube's vertices, rings of 6 (the first corner again, to wrap the
// texture round), 3 of them up the stalk; or the line's 2.
const int SIDES = 5, RING = 6, SEGMENTS = 2, LINE_VERTICES = 2;

out vec2 vUV;
// Its colour is the texture's × vScale + vAdd: the tint and the light, and what the wet sheen and
// the mist put over them, worked out at the corners, across which they barely change.
out vec3 vScale, vAdd;

// The culm texture's strips (textures.js).
const float CULM_STRIP = 4.0, CULM_TEXELS_PER_METRE = 32.0, TEXTURE_SIZE = 128.0;
const float TAPER = 0.45;        // thinner by this much at the tip
const float MIN_PIXELS = 0.9;    // across, at least
// Young culms are green; older ones yellower and duller.
const vec3 YOUNG = vec3(0.26, 0.38, 0.13), OLD = vec3(0.40, 0.40, 0.20);

void main() {
  int k = loadStalk();
  bool line = uStride == LINE_VERTICES;
  // How far up (0: its buried foot, 1: its tip), and round (0 to 1).
  float up = line ? float(k) : float(k / RING) / float(SEGMENTS);
  float around = line ? 0.5 : float(k % RING) / float(SIDES);
  float h = mix(-BURIED, stalk.w, up);
  vec3 axis = stalkAxis(h, stalkTilt());
  float dist = distance(axis, uCamera.xyz);
  // Out from the middle: round the tube; for the line, none, and its side is the one facing the camera.
  vec2 out2 = line ? vec2(0.0) : vec2(cos(6.2832 * around), sin(6.2832 * around));
  float radius = max(look.x * (1.0 - TAPER * up), 0.5 * MIN_PIXELS * uTime.y * dist);
  vec3 pos = axis + vec3(out2.x, 0.0, out2.y) * radius;
  vec2 facing = line ? normalize(uCamera.xz - axis.xz) : out2;
  vec3 normal = vec3(facing.x, 0.0, facing.y);
  vUV = vec2((look.y + around) * CULM_STRIP, h * CULM_TEXELS_PER_METRE) / TEXTURE_SIZE;
  float age = stalkRandom();
  vec3 tint = mix(YOUNG, OLD, age * age);
  // Lit by the daylight and the headlight; glossy, and more so wet, so seen at a glancing angle its
  // edges shine with the sky.
  vec3 toCamera = normalize(uCamera.xyz - pos);
  float sheen = (0.15 + 0.2 * uWeather.x) * pow(1.0 - max(dot(normal, toCamera), 0.0), 3.0), misted = mist(pos);
  vec3 light = daylight(normal) + LAMP_COLOR * headlight(pos, normal);
  vScale = tint * 2.0 * light * (1.0 - sheen) * (1.0 - misted);
  vAdd = skyColor(reflect(-toCamera, normal)) * sheen * (1.0 - misted) + mistColor(pos) * misted;
  gl_Position = uViewProj * vec4(pos, 1.0);
  // Partly dissolved (bamboo.js), stalk by stalk: a line a pixel wide can't dissolve by the dither.
  // Those gone are put past the right of the screen, where their triangles or line are clipped.
  // Where a stalk is both, swapping from its line to its tube, the line counts the other way, so it's
  // one or the other.
  float random = fract(13.0 * stalkRandom());
  if ((line ? 1.0 - random : random) >= shown) gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
}

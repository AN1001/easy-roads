// A rainy dusk, shared by the shaders that light things: the sky, the mist and the light.
// `#include "sky.glsl"` after frame.glsl (the mist and headlight need the Frame block); fragment
// shaders also include dither.glsl, after it.

// The overcast sky: SKY at the horizon, where it's brightest, darker overhead, and warmer low in the
// west, where the sun has set. SKY is whole 31sts, exactly one of the colour levels, as is the clear
// colour in main.js.
const vec3 SKY = vec3(10.0, 12.0, 14.0) / 31.0;
const vec3 ZENITH = vec3(0.25, 0.30, 0.37);
const vec3 GLOW = vec3(0.10, 0.045, -0.015);   // added at the horizon, due west
const vec2 WEST = vec2(-0.936, 0.351);          // AFTERGLOW's direction, level
const float GLOW_HEIGHT = 0.15;                  // its brightness halves every ~6° up

// The mist, in the forest under the sky: a darker, greener grey than the sky, so what it hides
// reads as more forest in the mist, not as sky showing through. It takes half the sky's glow in the
// west. Further off, from HAZE_FROM m to the mist's end, it pales, HAZE of the way to the horizon's
// colour, so the furthest ridges stand out as fainter layers against it; and past the land, the
// sky's treeline (sky.frag) is exactly the colour the land has faded to there, so the land's far
// edge never shows.
const vec3 MIST = vec3(6.5, 7.5, 8.0) / 31.0;
const float MIST_GLOW = 0.5;
const float HAZE_FROM = 200.0, HAZE = 0.25;

// The glow looking along `dir` (any length, not straight up or down), at the horizon.
vec3 glow(vec3 dir) {
  float west = max(dot(dir.xz * inversesqrt(max(dot(dir.xz, dir.xz), 1e-8)), WEST), 0.0);
  return GLOW * west * west;
}

// The sky's colour looking along `dir` (unit length).
vec3 skyColor(vec3 dir) {
  float up = max(dir.y, 0.0);
  return mix(SKY, ZENITH, smoothstep(0.0, 0.8, up)) + glow(dir) * exp2(-up / GLOW_HEIGHT);
}

// The mist's colour looking along `dir` (any length, not straight up or down), `haze` of the way
// (0 to 1) to the furthest's; and over `pos`.
vec3 mistAlong(vec3 dir, float haze) {
  vec3 west = glow(dir);
  return mix(MIST + MIST_GLOW * west, SKY + west, HAZE * haze);
}
vec3 mistColor(vec3 pos) {
  vec3 dir = pos - uCamera.xyz;
  return mistAlong(dir, smoothstep(HAZE_FROM, uFog.y, length(dir)));
}

// Light: the overcast sky from above, a dim bounce from the forest below, a little more from the
// west, where the sun has gone down; the car's warm headlight.
const vec3 SKY_LIGHT = vec3(0.50, 0.56, 0.66);
const vec3 BOUNCE_LIGHT = vec3(0.10, 0.12, 0.09);
const vec3 AFTERGLOW = normalize(vec3(-0.8, 0.45, 0.3));
const vec3 AFTERGLOW_COLOR = vec3(0.22, 0.20, 0.20);
const vec3 LAMP_COLOR = vec3(1.0, 0.85, 0.6) * 2.0;

// The daylight left on a surface facing `normal`.
vec3 dusk(vec3 normal) {
  return mix(BOUNCE_LIGHT, SKY_LIGHT, 0.5 + 0.5 * normal.y) + AFTERGLOW_COLOR * max(dot(normal, AFTERGLOW), 0.0);
}

// How much headlight reaches `pos`, on a surface facing `normal`: inside a soft-edged cone, fading
// with distance. Half-wrapped: ground at a glancing angle still shows it.
float headlight(vec3 pos, vec3 normal) {
  vec3 toLamp = uLamp.xyz - pos;
  float distSq = dot(toLamp, toLamp);
  vec3 l = toLamp * inversesqrt(distSq);
  float beam = smoothstep(0.85, 0.95, dot(-l, uLampDir.xyz));  // full within ~18°, none past ~32°
  float reach = 1.0 / (1.0 + distSq / 225.0);                 // half brightness at 15 m
  float facing = 0.5 + 0.5 * dot(normal, l);
  return beam * reach * facing;
}

// How much of the mist's colour it puts over `pos`, 0 to 1. None within uFog.x m; beyond, as
// through real mist, each uFog.z m hides about two thirds of what's left (so each ridge is fainter
// than the one before it), scaled to be all mist at uFog.y m, where the land stops being drawn.
// And more low down: it lies in the valleys, so ridges stand out above it.
const float LOW_MIST = 0.5;                   // at most this much more, in the valleys
const float LOW_MIST_TOP = 5.0, LOW_MIST_BOTTOM = -25.0;  // m: none above, all of it below
float mist(vec3 pos) {
  float d = distance(pos, uCamera.xyz), past = max(d - uFog.x, 0.0);
  float far = (1.0 - exp(-past / uFog.z)) / (1.0 - exp(-(uFog.y - uFog.x) / uFog.z));
  float low = LOW_MIST * smoothstep(LOW_MIST_TOP, LOW_MIST_BOTTOM, pos.y) * smoothstep(0.0, 150.0, past);
  return min(far + (1.0 - far) * low, 1.0);
}

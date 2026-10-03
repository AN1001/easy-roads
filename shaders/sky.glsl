// A rainy dusk (a rainy night 1-2 Oct 2026, and a sunny day for a few hours on 2 Oct 2026, their
// values kept in the comments), shared by the shaders that light things: the sky, the mist and the light.
// The rain and the car's lights come and go with uWeather (frame.glsl).
// `#include "sky.glsl"` after frame.glsl (the mist and headlight need the Frame block); fragment
// shaders also include dither.glsl, after it.

// The overcast sky: SKY at the horizon, where it's brightest, darker overhead, and warmer low in the
// west, where the sun has set. SKY is whole 31sts, exactly one of the colour levels, as is the clear
// colour in main.js. (At night: SKY (2, 3, 5) / 31, ZENITH (0.025, 0.035, 0.065), GLOW (0.02, 0.012,
// 0). The sunny day: SKY (20, 24, 28) / 31, ZENITH (0.26, 0.45, 0.78), GLOW (0.10, 0.08, 0.04), and a
// sun, (-0.717, 0.643, 0.269), lighting (1.0, 0.92, 0.78).)
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
const vec3 MIST = vec3(6.5, 7.5, 8.0) / 31.0;  // (1.5, 2, 3) / 31 at night, (13, 16, 17) / 31 by day
const float MIST_GLOW = 0.5;
const float HAZE_FROM = 200.0, HAZE = 0.25;      // HAZE 0.35 by day

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

// Light: the overcast sky from above, cool, a fainter bounce from the forest below, the afterglow
// from the west; the car's warm headlight (uWeather.y). (At night: SKY_LIGHT (0.17, 0.21, 0.31),
// BOUNCE_LIGHT (0.035, 0.04, 0.04), AFTERGLOW_COLOR (0.04, 0.035, 0.04), the headlight most of the light.
// The sunny day: (0.42, 0.48, 0.58), (0.14, 0.15, 0.10), and the sun instead of the afterglow.)
const vec3 SKY_LIGHT = vec3(0.50, 0.56, 0.66);
const vec3 BOUNCE_LIGHT = vec3(0.10, 0.12, 0.09);
const vec3 AFTERGLOW = normalize(vec3(-0.8, 0.45, 0.3));
const vec3 AFTERGLOW_COLOR = vec3(0.22, 0.20, 0.20);
const vec3 LAMP_COLOR = vec3(1.0, 0.85, 0.6) * 2.0;

// The daylight left on a surface facing `normal`.
vec3 daylight(vec3 normal) {
  return mix(BOUNCE_LIGHT, SKY_LIGHT, 0.5 + 0.5 * normal.y) + AFTERGLOW_COLOR * max(dot(normal, AFTERGLOW), 0.0);
}

// How much headlight reaches `pos` (none by day), on a surface facing `normal`: inside a soft-edged cone, fading
// with distance. Half-wrapped: ground at a glancing angle still shows it.
float headlight(vec3 pos, vec3 normal) {
  vec3 toLamp = uLamp.xyz - pos;
  float distSq = dot(toLamp, toLamp);
  vec3 l = toLamp * inversesqrt(distSq);
  float beam = smoothstep(0.85, 0.95, dot(-l, uLampDir.xyz));  // full within ~18°, none past ~32°
  float reach = 1.0 / (1.0 + distSq / 225.0);                 // half brightness at 15 m
  float facing = 0.5 + 0.5 * dot(normal, l);
  return beam * reach * facing * uWeather.y;  // off by day
}

// The tail lights' red glow, on what's close behind the car: uTail.xyz is between the lights, uTail.w
// how bright they are (main.js: 1 driving, 3 braking). Faint driving, and much more braking; on the
// ground it's stronger still where it's wet (terrain.frag). Gone within ~8 m (falling off faster
// than the headlight, or the rain all the way back glints red).
const vec3 TAIL_COLOR = vec3(1.0, 0.06, 0.03);
// It spreads as a rounded pool: an oval TAIL_SPREAD m across and TAIL_REACH m back, its middle
// TAIL_CENTRE m behind the lights (under the car it's hidden, so it needn't stop there).
const float TAIL_CENTRE = 1.3, TAIL_SPREAD = 1.6, TAIL_REACH = 2.4, TAIL_HIGH = 1.5;  // m
vec3 tailGlow(vec3 pos, vec3 normal) {
  vec3 toTail = uTail.xyz - pos;
  vec2 back = normalize(uTail.xz - uLamp.xz);  // the way the car's back faces
  vec2 rel = pos.xz - uTail.xz;
  vec3 oval = vec3(dot(rel, vec2(back.y, -back.x)) / TAIL_SPREAD, (dot(rel, back) - TAIL_CENTRE) / TAIL_REACH,
                   (pos.y - uTail.y) / TAIL_HIGH);
  float reach = 1.0 / (1.0 + dot(oval, oval));
  reach *= reach;
  float facing = 0.5 + 0.5 * dot(normal, normalize(toTail));
  float night = 0.25 + 0.75 * uWeather.y;  // by day, faint beside the sun
  return TAIL_COLOR * (0.06 + 0.3 * (uTail.w - 1.0)) * night * reach * facing;
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

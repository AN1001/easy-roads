#version 300 es
// The sky at a rainy dusk (sky.glsl), and low clouds drifting across it on the wind: a texture
// (textures.js) on a plane CLOUD_HEIGHT m up, sinking into the haze towards the horizon. Darker
// where they're thick, lighter in the gaps, and lit warm from below in the west.
//
// Below it, all round the horizon, the forest goes on past the land that's drawn: a treeline of
// misty bamboo, in the mist's colour at its furthest, which is what the land and the bamboo fade
// into by the mist's end. So where the land stops, more forest carries on behind it, rather than
// the sky showing.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"

in vec4 vFar;
uniform mediump sampler2DArray uGround;  // texture unit 1 (textures.js)
out vec4 color;

const float CLOUDS_LAYER = 6.0;
const float CLOUD_HEIGHT = 300.0;              // m above the camera
const float CLOUD_TILE = 1500.0;               // m across the texture
const vec2 CLOUD_DRIFT = vec2(6.0, -2.2);      // m/s: with the wind (bamboo.glsl's WIND)
const vec3 CLOUD_SHADE = vec3(0.80, 0.82, 0.86);  // thick cloud, as a share of the sky behind it
const vec3 GAP_SHADE = vec3(1.08, 1.08, 1.07);

// The treeline's top, as the tangent of its angle above level: between TREELINE_LOW and
// TREELINE_HIGH (~0.2-2.6°), in long swells (hills of forest) and smaller bumps (clumps of bamboo),
// from the clouds' thickness read round two circles of the texture, so it joins up all the way round.
const float TREELINE_LOW = 0.004, TREELINE_HIGH = 0.045;
const float SWELLS = 0.3, BUMPS = 2.9;  // the circles' radii, in tiles of the texture

void main() {
  vec3 dir = normalize(vFar.xyz / vFar.w - uCamera.xyz);
  float level = inversesqrt(max(dot(dir.xz, dir.xz), 1e-8));
  vec2 around = dir.xz * level;
  float swell = texture(uGround, vec3(0.5 + SWELLS * around, CLOUDS_LAYER)).a;
  float bump = texture(uGround, vec3(0.37 + BUMPS * around, CLOUDS_LAYER)).a;
  if (dir.y * level < mix(TREELINE_LOW, TREELINE_HIGH, 0.7 * swell + 0.3 * bump)) {
    color = vec4(dither(mistAlong(dir, 1.0)), 1.0);
    return;
  }
  vec3 sky = skyColor(dir);
  if (dir.y > 0.0) {
    // Where this pixel's line of sight meets the clouds, and two layers of them there: the texture,
    // and again 2.7 times smaller, drifting a little faster, for ragged edges.
    vec2 at = (uCamera.xz + dir.xz * (CLOUD_HEIGHT / dir.y) + CLOUD_DRIFT * uTime.x) / CLOUD_TILE;
    float thick = texture(uGround, vec3(at, CLOUDS_LAYER)).a;
    float ragged = texture(uGround, vec3(at * 2.7 + uTime.x * 0.0004 + 0.37, CLOUDS_LAYER)).a;
    float cloud = clamp(thick * 1.2 - 0.4 * ragged, 0.0, 1.0);
    // Clouds near the horizon are far off, hidden in haze.
    float seen = smoothstep(0.03, 0.35, dir.y);
    vec3 shade = mix(GAP_SHADE, CLOUD_SHADE, cloud);
    sky = mix(sky, sky * shade + glow(dir) * (1.0 - cloud) * 0.6, seen);
  }
  color = vec4(dither(sky), 1.0);
}

#version 300 es
// The rivers' water, over their beds (terrain.frag): murky, see-through where it's shallow, so
// the bed shows through at the edges and the boulders under the surface show as dark shapes;
// reflecting the banks, the bamboo, the bridges and the sky, more at a glancing angle (the scene as
// drawn so far: `reflected`); its surface stirred by the current and broken by the rain's rings
// (ripple.glsl), which shake the reflection. Floating on it, in patches: lily pads, now and then
// with a lotus flower, mats of duckweed in the shallows, fallen bamboo leaves and bits of culm
// drifting; a scum of foam where it laps at the banks and the boulders. Blended over what's behind
// it, fading into the mist.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "ripple.glsl"
#include "noise.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in float vDepth;     // m: how deep it is here (negative: under the bank)
in vec3 vDaylight;
in vec4 vMist;
out vec4 color;

// The scene as drawn before the water, its colour and depth (main.js copies them just before):
// what the water reflects.
uniform sampler2D uSceneColor;
#define uSceneSize vec2(textureSize(uSceneColor, 0))
uniform highp sampler2D uSceneDepth;
const float NEAR = 0.3, FAR = 400.0;  // m: the camera's (main.js: perspective)

const vec3 MURK = vec3(0.05, 0.075, 0.06);  // the water's own colour, deep, before it's lit
const float CLEAR = 1.6;     // m deep: from here on, the bed hardly shows through
const float SHALLOW_OPAQUE = 0.35, DEEP_OPAQUE = 0.95;  // how much the water hides of the bed
const float FLOW = 0.35;     // m/s: how fast the small waves drift
const float WAVE_RATE = 10.0, TILT_STEP = 0.01;  // their frames a second; the steps they tilt the surface in
const float REFLECT_MURK = 0.3;  // how much the reflection takes the water's own colour (and loses its brightness)

uint hash(ivec2 cell, uint seed) {
  uint h = uint(cell.x) * 1597334677u ^ uint(cell.y) * 3812015801u ^ seed * 2654435769u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
// Four random numbers, 0 to 1, from a hash.
vec4 random4(uint h) { return vec4(uvec4(h, h >> 8, h >> 16, h >> 24) & 255u) / 255.0; }

// Lily pads: in each PAD_CELL m square, maybe one (likelier in a patch: PATCH_CELL m squares, some
// thick with them, most bare), PAD_RADIUS m across or up to PAD_RADIUS_MORE more, a notch cut to
// its middle; on one in LOTUS_ODDS, a lotus. Fading out from PADS_FADE m away (too small to see).
const float PAD_CELL = 1.6, PATCH_CELL = 9.0, PAD_RADIUS = 0.3, PAD_RADIUS_MORE = 0.25, LOTUS_ODDS = 0.12;
const vec2 PADS_FADE = vec2(50.0, 90.0);
const vec3 PAD = vec3(0.10, 0.17, 0.06), PAD_LIGHT = vec3(0.16, 0.24, 0.08);
const vec3 PETAL = vec3(0.85, 0.52, 0.62), PETAL_TIP = vec3(0.95, 0.80, 0.85), HEART = vec3(0.85, 0.70, 0.20);
// Fallen leaves: in each LEAF_CELL m square, one in LEAF_ODDS, LEAF_LENGTH m long, drifting at
// LEAF_DRIFT m/s (each its own way, slowly turning); yellowed, browned or still green.
const float LEAF_CELL = 0.9, LEAF_ODDS = 0.22, LEAF_LENGTH = 0.22, LEAF_DRIFT = 0.04;
const vec2 LEAVES_FADE = vec2(20.0, 40.0);

// Duckweed: mats of it in the shallows (where it's under DUCKWEED_DEEP m deep) and here and there in
// the still water out from them (noise at DUCKWEED_WAVE m), speckled, two greens (noise at
// DUCKWEED_SPECKLE m), the speckle fading to their average from DUCKWEED_FADE m (smaller than a pixel).
const float DUCKWEED_DEEP = 0.9, DUCKWEED_WAVE = 6.0, DUCKWEED_SPECKLE = 0.25;
const vec2 DUCKWEED_FADE = vec2(15.0, 30.0);
const vec3 DUCKWEED = vec3(0.16, 0.24, 0.05), DUCKWEED_DARK = vec3(0.09, 0.15, 0.04);
// Foam: a broken scum where the water's under FOAM_DEEP m deep, at the banks and round the boulders
// standing out of it, slowly stirring.
const float FOAM_DEEP = 0.22;
const vec3 FOAM = vec3(0.42, 0.42, 0.37);
// Bits of culm: in each STICK_CELL m square, one in STICK_ODDS, 0.8 to 2.2 m long, STICK_WIDE m
// across, yellowed or grey, drifting a little, always within their square (so only this one need be
// looked in); seen to STICKS_FADE m.
const float STICK_CELL = 7.0, STICK_ODDS = 0.25, STICK_WIDE = 0.07;
const vec2 STICKS_FADE = vec2(25.0, 45.0);

// Value noise, 0 to 1, on a 1 m lattice, flat (noise.glsl's noise3 has a third axis, and costs
// twice as much): the duckweed's.
float noise2(vec2 p, uint seed) {
  ivec2 c = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  // (A lighter hash than `hash`: a multiply and two shifts a corner, enough for a speckle.)
  uvec4 h = (uvec4(c.x, c.x + 1, c.x, c.x + 1) * 1597334677u) ^ (uvec4(c.y, c.y, c.y + 1, c.y + 1) * 3812015801u) ^ seed;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  vec4 v = vec4(h & 1023u) / 1023.0;
  return mix(mix(v.x, v.y, f.x), mix(v.z, v.w, f.x), f.y);
}

// `thing` (rgb, and a: how much of it there is) laid over `found`.
void over(inout vec4 found, vec4 thing) {
  if (thing.a > 0.0) found = vec4(found.a > 0.0 ? mix(found.rgb, thing.rgb, thing.a) : thing.rgb, max(found.a, thing.a));
}

// What floats at p, if anything: rgb its colour (before it's lit), a 1 where something is.
vec4 floating(vec2 p, float range, float deep) {
  vec4 found = vec4(0.0);
  // Foam and duckweed first: lily pads, leaves and sticks float on them.
  if (deep < FOAM_DEEP) {
    float foam = (1.0 - smoothstep(0.0, FOAM_DEEP, deep)) * smoothstep(0.42, 0.62, noise3(vec3(p * 1.4, uTime.x * 0.15)));
    if (foam > 0.0) found = vec4(FOAM * (0.85 + 0.3 * noise2(p * 4.0, 23u)), foam);
  }
  float weed = smoothstep(0.55, 0.68, noise2(p / DUCKWEED_WAVE, 29u) + 0.35 * (1.0 - smoothstep(0.2, DUCKWEED_DEEP, deep)) - 0.15);
  if (weed > 0.0) {
    float speckle = range < DUCKWEED_FADE.y ? mix(noise2(p / DUCKWEED_SPECKLE, 31u), 0.5, smoothstep(DUCKWEED_FADE.x, DUCKWEED_FADE.y, range)) : 0.5;
    over(found, vec4(mix(DUCKWEED_DARK, DUCKWEED, smoothstep(0.3, 0.7, speckle)), weed));
  }
  if (range < STICKS_FADE.y) {
    ivec2 cell = ivec2(floor(p / STICK_CELL));
    vec4 r = random4(hash(cell, 17u));
    if (r.x < STICK_ODDS) {
      vec4 q = random4(hash(cell, 19u));
      float turn = q.x * 6.2832 + 0.15 * sin(uTime.x * 0.1 + q.y * 6.2832);
      vec2 dir = vec2(cos(turn), sin(turn));
      // (Its middle in the square's middle third, give or take its drift: 2 m from its edges, more than half the longest.)
      vec2 centre = (vec2(cell) + 0.33 + 0.34 * r.yz) * STICK_CELL + 0.3 * sin(uTime.x * 0.07 + q.z * 6.2832) * dir;
      vec2 d = p - centre;
      float along = dot(d, dir), across = abs(dot(d, vec2(-dir.y, dir.x))), reach = 0.4 + 0.7 * r.w;
      if (abs(along) < reach && across < STICK_WIDE * 0.5) {
        vec3 culm = q.w < 0.6 ? vec3(0.45, 0.40, 0.18) : vec3(0.30, 0.28, 0.22);
        float node = step(0.93, fract(along / 0.35 + q.y));  // its nodes, darker rings
        over(found, vec4(culm * (across < STICK_WIDE * 0.2 ? 1.1 : 0.8) * (1.0 - 0.35 * node), 1.0 - smoothstep(STICKS_FADE.x, STICKS_FADE.y, range)));
      }
    }
  }
  if (range < PADS_FADE.y) {
    ivec2 cell = ivec2(floor(p / PAD_CELL));
    ivec2 patchCell = ivec2(floor(vec2(cell) * PAD_CELL / PATCH_CELL));
    float thick = random4(hash(patchCell, 7u)).x;
    vec4 r = random4(hash(cell, 3u));
    if (r.x < 0.8 * smoothstep(0.55, 0.9, thick)) {
      vec2 centre = (vec2(cell) + 0.3 + 0.4 * r.yz) * PAD_CELL;
      float radius = PAD_RADIUS + PAD_RADIUS_MORE * r.w;
      vec2 d = p - centre;
      float dist = length(d) / radius;
      vec4 q = random4(hash(cell, 5u));
      float turn = q.x * 6.2832;
      vec2 dir = vec2(cos(turn), sin(turn));
      // The notch: a narrow wedge from the edge to the middle.
      bool notch = dot(normalize(d), dir) > 0.94;
      if (dist < 1.0 && !notch) {
        // Veins from the middle; lighter towards the edge.
        float angle = atan(d.y, d.x);
        float vein = smoothstep(0.85, 1.0, cos(angle * 9.0 + q.y * 6.0)) * step(0.15, dist);
        vec3 pad = mix(PAD, PAD_LIGHT, 0.5 * dist + 0.4 * vein);
        if (q.z < LOTUS_ODDS) {
          // Eight petals, pink to pale tips, round a yellow heart.
          float petals = 0.45 + 0.22 * abs(cos(angle * 4.0 + q.w * 3.0));
          if (dist < petals) pad = dist < 0.14 ? HEART : mix(PETAL, PETAL_TIP, dist / petals);
        }
        over(found, vec4(pad, 1.0 - smoothstep(PADS_FADE.x, PADS_FADE.y, range)));
      }
    }
  }
  if (found.a < 1.0 && range < LEAVES_FADE.y) {
    // Each leaf is placed from the square it starts in, drifting from there, never more than about
    // 0.6 m from its square's middle (less than a square): so only the four squares whose middles
    // are nearest can have one here. (All nine round it until 3 Oct 2026.)
    ivec2 home = ivec2(floor(p / LEAF_CELL - 0.5));
    for (int dz = 0; dz <= 1; dz++) for (int dx = 0; dx <= 1; dx++) {
      ivec2 cell = home + ivec2(dx, dz);
      vec4 r = random4(hash(cell, 11u));
      if (r.x >= LEAF_ODDS) continue;
      vec4 q = random4(hash(cell, 13u));
      float way = q.x * 6.2832;
      // Back and forth over a short drift, so a leaf never strays far from its square.
      float drift = sin(uTime.x * LEAF_DRIFT * 3.0 + q.y * 6.2832) * 0.3;
      vec2 centre = (vec2(cell) + 0.5 + 0.3 * (r.yz - 0.5)) * LEAF_CELL + drift * vec2(cos(way), sin(way));
      float turn = q.z * 6.2832 + 0.2 * drift;
      vec2 d = p - centre;
      vec2 local = vec2(dot(d, vec2(cos(turn), sin(turn))), dot(d, vec2(-sin(turn), cos(turn)))) / (LEAF_LENGTH * (0.7 + 0.6 * r.w));
      // Long and narrow, pointed at the tip.
      float width = 0.13 * (1.0 - local.x * local.x * 4.0) * (local.x < 0.0 ? 1.0 : 1.0 - local.x);
      if (abs(local.x) < 0.5 && abs(local.y) < width) {
        vec3 leaf = q.w < 0.4 ? vec3(0.42, 0.36, 0.14) : q.w < 0.8 ? vec3(0.30, 0.20, 0.10) : vec3(0.16, 0.22, 0.08);
        over(found, vec4(leaf * (abs(local.y) < 0.012 ? 0.8 : 1.0), 1.0 - smoothstep(LEAVES_FADE.x, LEAVES_FADE.y, range)));
      }
    }
  }
  return found;
}

// The view depth (m) of what's drawn at `uv` on the screen (the copy of the depth buffer).
float sceneDepth(vec2 uv) {
  float z = texture(uSceneDepth, uv).r * 2.0 - 1.0;
  return 2.0 * NEAR * FAR / (FAR + NEAR - z * (FAR - NEAR));
}
// What the water at `from` reflects along `ray`, as the scene was drawn: stepping along it, further
// each step (from REFLECT_FIRST m, REFLECT_GROW times as far each step: to ~40 m), until it passes
// behind something drawn, then narrowing in on where. If there it's only just behind it (within
// REFLECT_THICK m, and a little more further off), that's what it meets; if it's still far behind,
// it passed behind something in front of it (a trunk between the camera and the water), and it
// steps on. The colour found, and how sure (a): 0 if it leaves the screen or finds nothing (then
// it's the sky), fading out towards the screen's edges. (Where a point along the ray is on the
// screen is linear in how far along: `start` + `step` × t, before dividing by w.)
// Drawn as a PS1 would have (4 Oct 2026: as found, too true to life for the rest): a small picture,
// REFLECT_ROWS rows of blocks down the screen (each found where its middle is: `uv` snapped), so it
// reads coarse, as an enlarged low-resolution texture would.
const float REFLECT_ROWS = 45.0;
const int REFLECT_STEPS = 10, REFLECT_NARROW = 3;
const float REFLECT_FIRST = 0.6, REFLECT_GROW = 1.6, REFLECT_THICK = 0.6;
vec4 reflected(vec3 from, vec3 ray) {
  vec4 start = uViewProj * vec4(from, 1.0), step = uViewProj * vec4(ray, 0.0);
  float before = 0.0, t = REFLECT_FIRST;
  for (int i = 0; i < REFLECT_STEPS; i++) {
    vec4 clip = start + step * t;
    vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
    if (clip.w < NEAR || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
    if (clip.w > sceneDepth(uv)) {
      float near = before, far = t;
      for (int k = 0; k < REFLECT_NARROW; k++) {
        float middle = 0.5 * (near + far);
        vec4 m = start + step * middle;
        if (m.w > sceneDepth(m.xy / m.w * 0.5 + 0.5)) far = middle; else near = middle;
      }
      clip = start + step * far;
      uv = clip.xy / clip.w * 0.5 + 0.5;
      if (clip.w - sceneDepth(uv) < REFLECT_THICK + 0.02 * clip.w + (far - near)) {
        vec2 edge = min(uv, 1.0 - uv);
        vec2 blocks = vec2(REFLECT_ROWS * uSceneSize.x / uSceneSize.y, REFLECT_ROWS);
        return vec4(texture(uSceneColor, (floor(uv * blocks) + 0.5) / blocks).rgb, smoothstep(0.0, 0.06, min(edge.x, edge.y)));
      }
    }
    before = t;
    t *= REFLECT_GROW;
  }
  return vec4(0.0);
}

void main() {
  if (vDepth < -0.3) discard;  // away from the river (its bank hides the water anyway)
  vec3 toCamera = uCamera.xyz - vWorldPos;
  float range = length(toCamera);
  toCamera /= range;

  // Small waves: a few sines drifting downstream (any way: it's too gentle to tell), tilting the
  // surface a little, and so its reflection; the rain's rings tilt it more. PS1-like, they move
  // WAVE_RATE times a second, not smoothly, and tilt it in steps of TILT_STEP, so the reflection
  // jumps a block at a time rather than sliding.
  vec2 p = vWorldPos.xz;
  float t = floor(uTime.x * WAVE_RATE) / WAVE_RATE * FLOW;
  vec2 tilt = 0.025 * vec2(sin(p.x * 1.3 + p.y * 0.4 + t * 3.1) + 0.6 * sin(p.x * 0.5 - p.y * 2.1 - t * 2.3),
                           sin(p.y * 1.1 - p.x * 0.7 + t * 2.7) + 0.6 * sin(p.y * 2.3 + p.x * 0.9 + t * 1.9));
  float rings = uWeather.x * ripple(p);
  tilt = floor(tilt / TILT_STEP + 0.5) * TILT_STEP;
  vec3 normal = normalize(vec3(tilt.x, 1.0, tilt.y));

  // Reflection: half of it looking straight down (still, dark water: much more than Fresnel's 2%,
  // which read as a hole), almost all of it at a glancing angle; where a ring spreads, turned round
  // (bright on dark water up close, dark on shining water far off). What it reflects: what's drawn
  // (already in its mist), or where that's not found, the sky (in the water's).
  float glancing = pow(1.0 - max(dot(toCamera, normal), 0.0), 5.0);
  float shine = 0.5 + 0.45 * glancing;
  shine = mix(shine, 1.0 - 0.6 * shine, 0.8 * rings);
  vec3 ray = reflect(-toCamera, normal);
  // (None to see in thick mist, or under what floats on it.)
  vec4 thing = floating(p, range, vDepth);
  vec4 seen = vMist.a < 0.9 && thing.a < 1.0 ? reflected(vWorldPos, ray) : vec4(0.0);
  vec3 mirror = mix(mix(skyColor(ray), vMist.rgb, vMist.a), seen.rgb, seen.a);
  mirror = mix(mirror, mirror * 0.7 + MURK, REFLECT_MURK);
  vec3 lit = MURK * (vDaylight + LAMP_COLOR * headlight(vWorldPos, normal));
  vec3 surface = mix(mix(lit, vMist.rgb, vMist.a), mirror, shine);

  // See-through where it's shallow; the reflection doesn't let the bed through.
  float opaque = mix(SHALLOW_OPAQUE, DEEP_OPAQUE, smoothstep(0.0, CLEAR, vDepth));
  opaque = max(opaque, shine);

  // What floats on it: lit as the land is, wet (a little of the sky's shine), over the water.
  if (thing.a > 0.0) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 litThing = thing.rgb * (vDaylight + LAMP_COLOR * headlight(vWorldPos, up));
    litThing = mix(litThing, skyColor(reflect(-toCamera, up)), 0.08 + 0.3 * glancing);
    surface = mix(surface, mix(litThing, vMist.rgb, vMist.a), thing.a);
    opaque = mix(opaque, 1.0, thing.a);
  }
  opaque *= smoothstep(-0.3, 0.05, vDepth);
  color = vec4(dither(surface), opaque);  // (PS1 colour, as everything else is)
}

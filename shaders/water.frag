#version 300 es
// The rivers' water, over their beds (terrain.frag): murky, see-through where it's shallow, so
// the bed shows through at the edges and the boulders under the surface show as dark shapes;
// reflecting the sky, more at a glancing angle; its surface stirred by the current and broken by
// the rain's rings (ripple.glsl). Floating on it, in patches: lily pads, now and then with a lotus
// flower, and fallen bamboo leaves drifting. Blended over what's behind it, fading into the mist.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "ripple.glsl"

in vec3 vWorldPos;
in float vDepth;     // m: how deep it is here (negative: under the bank)
in vec3 vDaylight;
in vec4 vMist;
out vec4 color;

const vec3 MURK = vec3(0.05, 0.075, 0.06);  // the water's own colour, deep, before it's lit
const float CLEAR = 1.6;     // m deep: from here on, the bed hardly shows through
const float SHALLOW_OPAQUE = 0.35, DEEP_OPAQUE = 0.95;  // how much the water hides of the bed
const float FLOW = 0.35;     // m/s: how fast the small waves drift

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

// What floats at p, if anything: rgb its colour (before it's lit), a 1 where something is.
vec4 floating(vec2 p, float range) {
  vec4 found = vec4(0.0);
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
        found = vec4(pad, 1.0);
        if (q.z < LOTUS_ODDS) {
          // Eight petals, pink to pale tips, round a yellow heart.
          float petals = 0.45 + 0.22 * abs(cos(angle * 4.0 + q.w * 3.0));
          if (dist < petals) found.rgb = dist < 0.14 ? HEART : mix(PETAL, PETAL_TIP, dist / petals);
        }
      }
    }
    found.a *= 1.0 - smoothstep(PADS_FADE.x, PADS_FADE.y, range);
  }
  if (found.a == 0.0 && range < LEAVES_FADE.y) {
    // Each leaf is placed from the square it starts in, drifting from there; look in the squares
    // round this one too, for leaves that have drifted in.
    ivec2 home = ivec2(floor(p / LEAF_CELL));
    for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
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
        found = vec4(leaf * (abs(local.y) < 0.012 ? 0.8 : 1.0), 1.0 - smoothstep(LEAVES_FADE.x, LEAVES_FADE.y, range));
      }
    }
  }
  return found;
}

void main() {
  if (vDepth < -0.3) discard;  // away from the river (its bank hides the water anyway)
  vec3 toCamera = uCamera.xyz - vWorldPos;
  float range = length(toCamera);
  toCamera /= range;

  // Small waves: a few sines drifting downstream (any way: it's too gentle to tell), tilting the
  // surface a little; the rain's rings tilt it more.
  vec2 p = vWorldPos.xz;
  float t = uTime.x * FLOW;
  vec2 tilt = 0.035 * vec2(sin(p.x * 1.3 + p.y * 0.4 + t * 3.1) + 0.6 * sin(p.x * 0.5 - p.y * 2.1 - t * 2.3),
                           sin(p.y * 1.1 - p.x * 0.7 + t * 2.7) + 0.6 * sin(p.y * 2.3 + p.x * 0.9 + t * 1.9));
  float rings = uWeather.x * ripple(p);
  vec3 normal = normalize(vec3(tilt.x, 1.0, tilt.y));

  // Reflection: a third looking straight down (as the puddles: Fresnel's 2% read as a hole),
  // almost all of it at a glancing angle; where a ring spreads, turned round (bright on dark water
  // up close, dark on shining water far off).
  float glancing = pow(1.0 - max(dot(toCamera, normal), 0.0), 5.0);
  float shine = 0.3 + 0.65 * glancing;
  shine = mix(shine, 1.0 - 0.6 * shine, 0.8 * rings);
  vec3 lit = MURK * (vDaylight + LAMP_COLOR * headlight(vWorldPos, normal));
  vec3 surface = mix(lit, skyColor(reflect(-toCamera, normal)), shine);

  // See-through where it's shallow; the reflection doesn't let the bed through.
  float opaque = mix(SHALLOW_OPAQUE, DEEP_OPAQUE, smoothstep(0.0, CLEAR, vDepth));
  opaque = max(opaque, shine);

  // What floats on it: lit as the land is, wet (a little of the sky's shine), over the water.
  vec4 thing = floating(p, range);
  if (thing.a > 0.0) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 litThing = thing.rgb * (vDaylight + LAMP_COLOR * headlight(vWorldPos, up));
    litThing = mix(litThing, skyColor(reflect(-toCamera, up)), 0.08 + 0.3 * glancing);
    surface = mix(surface, litThing, thing.a);
    opaque = mix(opaque, 1.0, thing.a);
  }
  opaque *= smoothstep(-0.3, 0.05, vDepth);
  color = vec4(mix(surface, vMist.rgb, vMist.a), opaque);
}

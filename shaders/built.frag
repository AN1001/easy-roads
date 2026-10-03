#version 300 es
// Things built of blocks: the bridges' timber (textures.js, at BUILT_TEXELS_PER_METRE), lit like
// the land (by the sky, the headlight and the tail lights), wet in the rain: what faces up shines a
// little with the sky, more at a glancing angle. Fading into the mist. Aged (2 Oct 2026): each board
// its own shade, the wood weathered grey in places and darkened in others, a fine mottle, and moss
// in patches, thickest on what faces up. Also the cherry trees (trees.js): their bark, mottled and
// mossy too; their blossom (a maple's leaves) and the petals (leaves) fallen under them, cut out of their cards by the texture's
// alpha, the blossom lit softly (light through its petals: partly as if it faced up), never shining.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"
#include "near.glsl"

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
flat in float vLayer;
in vec4 vMist;
uniform mediump sampler2DArray uGround;  // texture unit 1
out vec4 color;

const float TILE = 8.0;  // m: 128 texels at 16 a metre

// Value noise, 0 to 1, on a 1 m lattice.
float lattice(ivec3 c) {
  uint h = uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ uint(c.z) * 2246822519u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  return float(h & 1023u) / 1023.0;
}
float noise3(vec3 p) {
  ivec3 c = ivec3(floor(p));
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lattice(c), lattice(c + ivec3(1, 0, 0)), f.x), mix(lattice(c + ivec3(0, 1, 0)), lattice(c + ivec3(1, 1, 0)), f.x), f.y),
             mix(mix(lattice(c + ivec3(0, 0, 1)), lattice(c + ivec3(1, 0, 1)), f.x), mix(lattice(c + ivec3(0, 1, 1)), lattice(c + ivec3(1, 1, 1)), f.x), f.y), f.z);
}

const vec3 WEATHERED = vec3(0.34, 0.33, 0.30);  // silvered grey wood
const vec3 MOSS = vec3(0.13, 0.20, 0.06), MOSS_LIGHT = vec3(0.22, 0.29, 0.09);
const float BOARD = 0.25;  // m: a board's width, across the grain (u)
// The texture array's layers (textures.js).
const float WOOD_LAYER = 9.0, BARK_LAYER = 10.0, BLOSSOM_LAYER = 11.0, PETALS_LAYER = 12.0, LEAF_LAYER = 13.0;
const float PETALS_REACH = 7.0;  // m from the trunk: must match trees.js

// Moss over `base`: patches, more where it faces up, a little on the sides, little underneath;
// speckled. `from`: how much of the noise it takes (higher, less moss).
vec3 mossy(vec3 base, vec3 p, vec3 grain, float from) {
  float patches = noise3(p / 0.8 + 17.0) * 0.7 + noise3(p / 0.25) * 0.3;
  float moss = smoothstep(from, from + 0.14, patches + 0.12 * vNormal.y);
  if (moss > 0.0) {
    vec3 green = mix(MOSS, MOSS_LIGHT, noise3(p / 0.06));
    base = mix(base, green * (0.9 + 0.2 * grain.g), moss * 0.9);
  }
  return base;
}

void main() {
  vec3 base = vColor;
  vec3 normal = vNormal;
  float wet = 1.0;  // how much it shines in the rain
  vec3 p = vWorldPos;
  if (vLayer > WOOD_LAYER + 0.5 && abs(vLayer - PETALS_LAYER) > 0.5 && tooNear(vWorldPos)) discard;  // a cherry tree
  if (vLayer > BARK_LAYER + 0.5) {
    // Blossom or petals: cut out by the alpha.
    vec4 texel = texture(uGround, vec3(vUV / TILE, vLayer));
    float cover = texel.a;
    if (abs(vLayer - PETALS_LAYER) < 0.5) {
      // Fallen petals: thinning out from the trunk (vUV is m from it) to none by PETALS_REACH, the
      // edge wandering in and out; and dithered by how much of the pixel is petal, rather than cut
      // at half, so far off, where the mipmaps average them away, they're still a pink speckle.
      // (Against a random threshold per 4 cm of ground, not the screen's dither pattern: seen far
      // off at a glancing angle, that drew the patch as a regular dotted line.) Thinner far off,
      // where the whole patch is squeezed into a few rows of pixels.
      float range = length(uCamera.xyz - p);
      // (The edge's wandering: waves round the trunk, turned with the tree's own angle as the
      // texture is, rather than noise, which measured too slow over so many pixels.)
      float around = atan(vUV.y, vUV.x);
      cover *= 1.0 - smoothstep(1.0, PETALS_REACH, length(vUV) + 0.8 * sin(3.0 * around) + 0.5 * sin(7.0 * around + 1.3));
      cover = min(1.0, cover * 1.6) * (1.0 - 0.6 * smoothstep(15.0, 60.0, range));
      if (cover <= lattice(ivec3(floor(p * 25.0)))) discard;
    } else if (abs(vLayer - LEAF_LAYER) < 0.5) {
      // A maple's leaves: dithered by how much of the pixel is leaf, as the bushes' (nature.frag):
      // cut at half, far off, where the mipmaps average the leaves with the gaps, they vanished.
      if (min(cover * 1.5, 1.0) <= threshold(ivec2(gl_FragCoord.xy))) discard;
    } else if (cover < 0.5) discard;
    base *= 2.0 * texel.rgb;
    wet = 0.0;
  } else if (vLayer > WOOD_LAYER + 0.5) {
    // Bark.
    vec3 grain = 2.0 * texture(uGround, vec3(vUV / TILE, vLayer)).rgb;
    base *= grain * (0.8 + 0.4 * noise3(p / 0.3));
    base = mossy(base, p, grain, 0.62);
    wet = 0.5;
  } else if (vLayer >= 0.0) {
    vec3 grain = 2.0 * texture(uGround, vec3(vUV / TILE, vLayer)).rgb;
    // Each board its own shade (by which board across the grain, and where along the bridge).
    float board = lattice(ivec3(floor(vUV.x / BOARD), 0, int(floor(vWorldPos.x * 0.1 + vWorldPos.z * 0.1))));
    base *= 0.8 + 0.4 * board;
    // Weathered grey in places, darkened in others; a fine mottle over it.
    float weather = noise3(p / 1.7);
    base = mix(base, WEATHERED, 0.6 * smoothstep(0.45, 0.85, weather));
    base *= 0.75 + 0.35 * smoothstep(0.0, 0.5, weather);
    base *= 0.85 + 0.3 * noise3(p / 0.12);
    base *= grain;
    base = mossy(base, p, grain, 0.68);
  }
  vec3 tail = tailGlow(vWorldPos, normal);
  vec3 light = daylight(normal) + LAMP_COLOR * headlight(vWorldPos, normal) + tail;
  if (abs(vLayer - BLOSSOM_LAYER) < 0.5 || abs(vLayer - LEAF_LAYER) < 0.5) light = 0.55 * light + 0.3 * daylight(vec3(0.0, 1.0, 0.0));
  vec3 toCamera = normalize(uCamera.xyz - vWorldPos);
  float shine = wet * uWeather.x * max(normal.y, 0.0) * (0.05 + 0.3 * pow(1.0 - max(toCamera.y, 0.0), 5.0));
  vec3 lit = mix(base * light, skyColor(reflect(-toCamera, normal)) + 2.0 * tail, shine);
  color = vec4(dither(mix(lit, vMist.rgb, vMist.a)), 1.0);
}

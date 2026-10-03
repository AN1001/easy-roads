// Value noise, 0 to 1, on a 1 m lattice: a whole-number hash at each corner, eased between. For
// built.frag (the bridges' timber, the cherries' bark, the fallen petals) and nature.frag (the
// rocks): `#include "noise.glsl"`.

// The hash at lattice point c, 0 to 1.
float lattice(ivec3 c) {
  uint h = uint(c.x) * 1597334677u ^ uint(c.y) * 3812015801u ^ uint(c.z) * 2246822519u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  return float(h & 1023u) / 1023.0;
}

// The eight corners' hashes, as lattice() gives them, sharing their products: (c + 1) × k is c × k + k,
// wrapping alike, so it's 11 multiplies rather than 32 (whole-number multiplies are slow on Intel's
// GPUs), four corners at a time; then blended in the same order as ever, so it's the same numbers
// exactly (until 3 Oct 2026, lattice() at each of the eight corners).
float noise3(vec3 p) {
  ivec3 c = ivec3(floor(p));
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  const uvec3 K = uvec3(1597334677u, 3812015801u, 2246822519u);
  uvec3 k = uvec3(c) * K, k1 = k + K;
  uvec4 xy = uvec4(k.x, k1.x, k.x, k1.x) ^ uvec4(k.y, k.y, k1.y, k1.y);  // corners (0, 0), (1, 0), (0, 1), (1, 1)
  uvec4 h0 = xy ^ k.z, h1 = xy ^ k1.z;                                    // at z, and z + 1
  h0 ^= h0 >> 16; h0 *= 0x7feb352du; h0 ^= h0 >> 15;
  h1 ^= h1 >> 16; h1 *= 0x7feb352du; h1 ^= h1 >> 15;
  vec4 a = vec4(h0 & 1023u) / 1023.0, b = vec4(h1 & 1023u) / 1023.0;
  return mix(mix(mix(a.x, a.y, f.x), mix(a.z, a.w, f.x), f.y), mix(mix(b.x, b.y, f.x), mix(b.z, b.w, f.x), f.y), f.z);
}

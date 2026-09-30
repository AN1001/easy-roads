// PS1 colour depth: 5 bits per channel (32 levels). Shades in between are faked with an ordered
// (Bayer) dither: a fixed 4×4 pattern of thresholds that rounds neighbouring pixels differently.
// Fragment shaders only (`#include "dither.glsl"`, after sky.glsl): it works from the pixel's place
// on the screen, which a vertex shader doesn't have. (Working the pattern out from the bits of x and
// y instead of looking it up measured no faster.)
const float LEVELS = 31.0;
const float BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);

// A pixel's threshold in the pattern: 1/32 to 31/32, in 16 steps.
float threshold(ivec2 pixel) {
  ivec2 p = pixel & 3;  // position in the 4×4 tile
  return (BAYER[p.y * 4 + p.x] + 0.5) / 16.0;
}

// Rounded to one of the 32 levels: up in some pixels, down in others, in proportion.
vec3 dither(vec3 c) {
  return floor(c * LEVELS + threshold(ivec2(gl_FragCoord.xy))) / LEVELS;
}

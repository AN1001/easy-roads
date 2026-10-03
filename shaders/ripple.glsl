// Rain on still water (the road's puddles, terrain.frag; the rivers, water.frag): in each
// RIPPLE_CELL m square, a drop lands every so often (RIPPLE_RATE a second) somewhere in its middle
// half, and a ring spreads from it, fading, to the square's edge. Needs frame.glsl's uTime.
const float RIPPLE_CELL = 0.5, RIPPLE_RATE = 1.2, RIPPLE_WIDTH = 0.025;  // m, /s, m
float ripple(vec2 p) {
  vec2 cell = floor(p / RIPPLE_CELL);
  uint h = uint(int(cell.x)) * 1597334677u ^ uint(int(cell.y)) * 3812015801u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15;
  vec2 centre = (cell + 0.25 + 0.5 * vec2(uvec2(h, h >> 8) & 255u) / 255.0) * RIPPLE_CELL;
  float t = fract(uTime.x * RIPPLE_RATE + float(h >> 16 & 255u) / 255.0);
  float ring = abs(distance(p, centre) - t * 0.25 * RIPPLE_CELL);
  return (1.0 - t) * (1.0 - smoothstep(0.0, RIPPLE_WIDTH, ring));
}

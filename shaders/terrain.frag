#version 300 es
// Smooth-shaded forest country at dusk, in the rain: a sandy dirt road whose edge frays into
// grass, with puddles the rain ripples; the forest floor beyond, darker under the bamboo, and earth
// banks where it's steep; textured (textures.js), lit by the sky and the car's headlight, fading
// into the mist (the daylight and the mist worked out at the corners, by terrain.vert: measured
// 12% cheaper). Far off, where clumps stand for the bamboo, the ground between them under the
// groves is tinted as its tops.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"

in vec3 vWorldPos;
in vec3 vNormal;
in float vEdge;
in float vGrove;   // how thick the bamboo grows here, 0 to 1
in vec3 vDusk;     // the daylight on it, less under the groves (terrain.vert)
in vec4 vMist;     // rgb: the mist's colour; a: how much of it
uniform mediump sampler2DArray uGround;  // texture unit 1: bank, forest floor, grass, sand
uniform mediump sampler2D uPuddles;      // texture unit 5: how wet the road is, and its puddles (textures.js)
out vec4 color;

// The ground's colours. The textures shade them: their texels are stored halved, so 0.5 leaves a
// colour as it is.
const vec3 SAND = vec3(0.50, 0.43, 0.31);     // the road: sandy dirt, damp
const vec3 PUDDLE = vec3(0.10, 0.09, 0.07);   // muddy water, before it reflects the sky
const vec3 GRASS = vec3(0.23, 0.30, 0.13);    // along the road
const vec3 FLOOR = vec3(0.22, 0.22, 0.13);    // under the trees: leaf litter and moss
const vec3 BANK = vec3(0.22, 0.20, 0.15);     // steep ground: earth, stones and moss
const vec3 CANOPY = vec3(0.10, 0.17, 0.09);   // far off: the tops of the bamboo
const float CANOPY_FROM = 80.0, CANOPY_TO = 150.0;  // m from the camera: where clumps stand for the bamboo (bamboo.js)

// Across the road's edge (m from it, as terrain.js frays it): sand to grass, then grass to the
// forest floor, each blended over a band, which the grass's tufts (its texture's alpha) push in
// and out by up to TUFTS / 2.
const float SAND_TO = -0.3, GRASS_FROM = 0.5;
const float GRASS_TO = 2.5, FLOOR_FROM = 3.5;
const float TUFTS = 1.0;  // m
// How wet the road is, and where its puddles are, away from the edge (particles.js splashes through
// the same ones): a texture repeating every PUDDLE_TILE m (textures.js).
const float PUDDLE_TILE = 64.0;  // m
const float PUDDLE_EDGE = -0.8;  // m from the road's edge: no puddles beyond

// Rain on the puddles: in each RIPPLE_CELL m square, a drop lands every so often (RIPPLE_RATE a
// second) somewhere in its middle half, and a ring spreads from it, fading, to the square's edge.
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

// The textures (textures.js): 128 texels square at 8 per metre, so each tile is 16 m across.
const float TEXELS_PER_METRE = 8.0;
const float TILE = 16.0;  // m
const float BANK_LAYER = 0.0, FLOOR_LAYER = 1.0, GRASS_LAYER = 2.0, SAND_LAYER = 3.0;

void main() {
  // The corners' normals, blended across the triangle: smooth, where each triangle's own
  // normal would light the 1 m grid on a steep bank as a saw-tooth pattern of facets.
  vec3 normal = normalize(vNormal);
  float pattern = threshold(ivec2(gl_FragCoord.xy));
  vec3 toCamera = uCamera.xyz - vWorldPos;
  float range = length(toCamera);
  toCamera /= range;

  // Mipmap level: how many texels apart neighbouring pixels are on the ground. Worked out here
  // from the world position, not left to the GPU, which goes by how far the texture coordinates
  // differ between neighbouring pixels: below, they jump between materials and between the two
  // ways the bank's texture hangs, and every jump would be blurred. (Its estimate isn't even
  // defined inside the ifs below, where only some pixels read a texture.)
  vec3 stepX = dFdx(vWorldPos), stepY = dFdy(vWorldPos);
  float lod = 0.5 * log2(max(dot(stepX, stepX), dot(stepY, stepY)) * TEXELS_PER_METRE * TEXELS_PER_METRE);
  vec2 ground = vWorldPos.xz / TILE;

  // Which of sand, grass and forest floor: each texture is only read where it's needed, so most
  // pixels read one.
  float edge = vEdge;
  vec4 grass = vec4(0.5);
  if (edge > SAND_TO - TUFTS / 2.0 && edge < FLOOR_FROM + TUFTS / 2.0) {
    grass = textureLod(uGround, vec3(ground, GRASS_LAYER), lod);
    edge += TUFTS * (grass.a - 0.5);
  }
  float sandy = 1.0 - smoothstep(SAND_TO, GRASS_FROM, edge);
  float grassy = 1.0 - smoothstep(GRASS_TO, FLOOR_FROM, edge);

  // Off the road: level ground is forest floor, steep ground a bank, and in between a blend. The
  // bank's texture hangs with its rows level: down the texture is down the slope. Across, it runs
  // along x or z, whichever the slope faces across less. Where that changes, neighbouring pixels
  // take one or the other by the dither pattern, rather than meeting at a seam.
  vec3 base = vec3(0.0);
  if (grassy < 1.0) {
    float flatness = smoothstep(0.8, 0.95, normal.y);
    vec3 bank = vec3(0.0), litter = vec3(0.0);
    if (flatness < 1.0) {
      float facingX = normal.x * normal.x / max(normal.x * normal.x + normal.z * normal.z, 1e-6);
      float along = smoothstep(0.25, 0.75, facingX) > pattern ? vWorldPos.z : vWorldPos.x;
      bank = BANK * 2.0 * textureLod(uGround, vec3(along / TILE, vWorldPos.y / TILE, BANK_LAYER), lod).rgb;
    }
    if (flatness > 0.0) litter = FLOOR * 2.0 * textureLod(uGround, vec3(ground, FLOOR_LAYER), lod).rgb;
    base = mix(bank, litter, flatness);
    base = mix(base, CANOPY, smoothstep(CANOPY_FROM, CANOPY_TO, range) * vGrove);
  }
  if (grassy > 0.0 && sandy < 1.0) base = mix(base, GRASS * 2.0 * grass.rgb, grassy);

  // The road: damp sand, darker where it's wetter, and puddles. Water reflects the sky: some of it
  // looking down into it (a third, far more than Fresnel's 2%: a dark puddle read as a hole),
  // almost all of it at a glancing angle, so the road shines further off. Wet sand does too, much
  // less. Where the rain's rings spread, the water's broken surface turns the reflection round:
  // bright rings on a dark puddle up close, dark ones on a shining one further off. Up close, a
  // texel is puddle or not; further off, where a pixel spans many, the share of them that are, so a
  // puddle fades into a glint on the road rather than going. (With explicit gradients: in here,
  // only some pixels read it.)
  float shine = 0.0;
  if (sandy > 0.0) {
    vec4 sand = textureLod(uGround, vec3(ground, SAND_LAYER), lod);
    vec2 wet = textureGrad(uPuddles, vWorldPos.xz / PUDDLE_TILE, stepX.xz / PUDDLE_TILE, stepY.xz / PUDDLE_TILE).rg;
    float glancing = pow(1.0 - max(toCamera.y, 0.0), 5.0);
    vec3 road = SAND * 2.0 * sand.rgb * (1.0 - 0.35 * wet.r);
    shine = 0.3 * wet.r * glancing;
    float puddle = vEdge < PUDDLE_EDGE ? wet.g : 0.0;
    if (puddle > 0.0) {
      float water = 0.35 + 0.65 * glancing;
      water = mix(water, 1.0 - 0.6 * water, 0.8 * ripple(vWorldPos.xz));
      road = mix(road, PUDDLE, puddle);
      shine = mix(shine, water, puddle);
    }
    base = mix(base, road, sandy);
    shine *= sandy;
  }

  vec3 light = vDusk + LAMP_COLOR * headlight(vWorldPos, normal);
  vec3 lit = mix(base * light, skyColor(reflect(-toCamera, vec3(0.0, 1.0, 0.0))), shine);
  color = vec4(dither(mix(lit, vMist.rgb, vMist.a)), 1.0);
}

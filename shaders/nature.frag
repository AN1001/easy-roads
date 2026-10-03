#version 300 es
// The ground cover (nature.js). The grass, flowers, reeds and ferns: their vertices' colours, lit
// softly (light through the blades: partly as if they faced up, as the ground under them does).
// The bushes: a dark core, and leaf (or blossom) cards over it, cut out by the texture's alpha
// (the game's texture array, textures.js), dithered where a pixel's partly covered (far off, where
// the mipmaps blend them), so they don't thin out with distance. The rocks: lit as the land is,
// mottled, and mossy on top, as the bridges' timber is (built.frag); wet in the rain. Fading into
// the mist.
//
// Far off, a copy fades out (vFade), dithered, as the trees near the camera do (near.glsl). The
// flowering bushes' flowers (the FLOWERING layer's brightest texels, textures.js) in uBloom, the
// bush's own colour, rather than tinted green as the leaves are.

precision highp float;

#include "frame.glsl"
#include "sky.glsl"
#include "dither.glsl"
#include "near.glsl"
#include "noise.glsl"

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
flat in float vLayer;
in vec4 vMist;
flat in float vFade;
uniform mediump sampler2DArray uGround;  // texture unit 1
uniform vec3 uBloom;
out vec4 color;

const float TILE = 8.0;  // m: a card's u, v across the texture once
const float FLOWERING_LAYER = 14.0;  // textures.js

const vec3 MOSS = vec3(0.13, 0.20, 0.06), MOSS_LIGHT = vec3(0.22, 0.29, 0.09);

void main() {
  float pattern = threshold(ivec2(gl_FragCoord.xy));
  if (vFade <= pattern || tooNear(vWorldPos)) discard;
  vec3 normal = normalize(vNormal);
  vec3 base = vColor;
  vec3 tail = tailGlow(vWorldPos, normal);
  vec3 light = daylight(normal) + LAMP_COLOR * headlight(vWorldPos, normal) + tail;
  if (vLayer < -1.5) {
    // A rock: mottled, finely speckled, moss on what faces up.
    vec3 p = vWorldPos;
    // (Two noises: four measured too slow.)
    float broad = noise3(p / 0.5), fine = noise3(p / 0.08);
    base *= (0.75 + 0.45 * broad) * (0.88 + 0.24 * fine);
    float moss = smoothstep(0.6, 0.8, 0.55 * (1.0 - broad) + 0.2 * fine + 0.45 * normal.y);
    base = mix(base, mix(MOSS, MOSS_LIGHT, fine), moss * 0.85);
    vec3 toCamera = normalize(uCamera.xyz - vWorldPos);
    float shine = (1.0 - moss) * uWeather.x * max(normal.y, 0.0) * (0.05 + 0.3 * pow(1.0 - max(toCamera.y, 0.0), 5.0));
    vec3 lit = mix(base * light, skyColor(reflect(-toCamera, normal)) + 2.0 * tail, shine);
    color = vec4(dither(mix(lit, vMist.rgb, vMist.a)), 1.0);
    return;
  }
  if (vLayer > -0.5) {
    vec4 texel = texture(uGround, vec3(vUV / TILE, vLayer));
    if (min(texel.a * 1.5, 1.0) <= pattern) discard;
    vec3 grain = 2.0 * texel.rgb;
    base *= grain;
    if (vLayer > FLOWERING_LAYER - 0.5) base = mix(base, uBloom * 0.5 * grain, smoothstep(1.45, 1.8, dot(grain, vec3(1.0 / 3.0))));
  }
  light = 0.6 * light + 0.4 * daylight(vec3(0.0, 1.0, 0.0));
  color = vec4(dither(mix(base * light, vMist.rgb, vMist.a)), 1.0);
}

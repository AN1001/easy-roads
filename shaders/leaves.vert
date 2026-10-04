#version 300 es
// A bamboo stalk's leaves: the model's (bamboo.js) cards, near 3 crossed through the stalk at 60°
// and turned by the stalk's own random angle, far off one facing the camera, with a picture of the 3
// seen from the side (textures.js); from LEAVES_FROM of its
// height to just over its top, and moved with it by bamboo.glsl. Their outer edges flutter. Lit
// by the daylight and the headlight, and misted, at the corners (per pixel measured 28% dearer).
// Or a cedar's crown (bamboo.glsl's isCedar): the same cards, narrower, darker, from CEDAR_FROM of its
// height, wearing a cone of needles (textures.js), and barely fluttering.

#include "frame.glsl"
#include "bamboo.glsl"
#include "sky.glsl"

// The model (bamboo.js): near, each card's 6 vertices, left and right at the bottom, middle and top;
// far, the one card's 4 corners, likewise.
const int CARD_ROWS = 2, BILLBOARD = 4;

out vec3 vWorldPos;
out vec2 vUV;
out vec3 vScale, vAdd;  // the colour is the texture's × vScale + vAdd: lit, then misted

flat out ivec2 vShift;
flat out float vShown;  // how much of it is there (bamboo.glsl): the rest dissolves
flat out float vLayer;  // of the texture array: the leaves' card, or far off, the 3 cards' picture

const vec3 LEAF = vec3(0.18, 0.30, 0.09);  // the texture's colours are shades of it
const float LEAVES_LAYER = 5.0, FAR_LEAVES_LAYER = 8.0;
const float LEAVES_FROM = 0.45;  // of the stalk's height
const float SPREAD = 0.17;       // each side of the stalk, as a share of its height
const vec3 CEDAR_LEAF = vec3(0.12, 0.20, 0.12);
const float CEDAR_LAYER = 16.0, FAR_CEDAR_LAYER = 17.0;
const float CEDAR_FROM = 0.45, CEDAR_SPREAD = 0.075;

void main() {
  int k = loadStalk(), corner = k % 6, card = k / 6;
  bool far = uStride == BILLBOARD;
  float across = float(corner & 1) * 2.0 - 1.0;                               // -1 to 1
  float up = far ? float(corner >> 1) : float(corner >> 1) / float(CARD_ROWS);  // 0 to 1
  float height = stalk.w, random = stalkRandom();
  bool cedar = isCedar();
  float h = mix((cedar ? CEDAR_FROM : LEAVES_FROM) * height, height + (cedar ? 0.5 : 0.3), up);
  vec3 axis = stalkAxis(h, stalkTilt());
  vec2 toCamera = normalize(uCamera.xz - axis.xz), side = vec2(-toCamera.y, toCamera.x);
  float angle = float(card) * 1.0472 + 6.2832 * random;
  vec2 out2 = (far ? side : vec2(cos(angle), sin(angle))) * across;
  float flutter = (cedar ? 0.03 : 0.1) * abs(across) * sin(3.1 * uTime.x + 9.0 * random + 2.0 * across + 3.0 * up);
  vWorldPos = axis + vec3(out2.x, 0.0, out2.y) * (cedar ? CEDAR_SPREAD : SPREAD) * height + vec3(0.0, flutter, 0.0);
  // Lit mostly from above, and more from the side they reach out towards.
  vec3 normal = normalize(vec3(0.6 * out2.x, 1.0, 0.6 * out2.y));
  float misted = mist(vWorldPos);
  vScale = (cedar ? CEDAR_LEAF : LEAF) * 2.0 * (daylight(normal) + LAMP_COLOR * headlight(vWorldPos, normal)) * (1.0 - misted);
  vAdd = mistColor(vWorldPos) * misted;
  vUV = vec2(0.5 + 0.5 * across, up);
  int shift = int(random * 16.0);
  vShift = ivec2(shift & 3, shift >> 2);
  vShown = shown;
  vLayer = cedar ? (far ? FAR_CEDAR_LAYER : CEDAR_LAYER) : far ? FAR_LEAVES_LAYER : LEAVES_LAYER;
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}

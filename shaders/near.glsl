// Trees and plants right by the camera (trees.js, nature.js): faded out, dithered, from NEAR_TO m
// to none within NEAR_FROM m, so the chase camera, swinging round behind the car, never looks out
// from inside a crown or a bush. Needs frame.glsl and dither.glsl.
const float NEAR_FROM = 2.0, NEAR_TO = 4.5;  // m
bool tooNear(vec3 pos) {
  return smoothstep(NEAR_FROM, NEAR_TO, distance(pos, uCamera.xyz)) <= threshold(ivec2(gl_FragCoord.xy));
}

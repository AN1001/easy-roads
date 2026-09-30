#version 300 es
// Runs once per pixel: flat lighting, with the face normal worked out on the fly.

precision highp float;

in vec3 vWorldPos;
out vec4 color;

const vec3 BASE = vec3(1.0, 0.53, 0.27);
const vec3 LIGHT_DIR = normalize(vec3(0.4, 0.8, 0.6));

void main() {
  // dFdx/dFdy give how the position changes to the next pixel across and up.
  // Both lie on the face, so their cross product is the face's normal:
  // flat shading without storing any normals in the vertex data.
  vec3 normal = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));

  float light = max(dot(normal, LIGHT_DIR), 0.0);
  color = vec4(BASE * (0.35 + 0.65 * light), 1.0);
}

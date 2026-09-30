#version 300 es
// Runs once per vertex: places the cube in the world, then projects it to the screen.

in vec3 aPos;
uniform mat4 uModel;  // object -> world (position + rotation)
uniform mat4 uProj;   // world -> screen (the camera lens)

out vec3 vWorldPos;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos = world.xyz;
  gl_Position = uProj * world;
}

// Small WebGL2 helpers shared by everything that draws.

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

// Fetch an image into a texture with sharp, unsmoothed texels (NEAREST) and no mipmaps: the PS1
// look. Model textures are sized so a texel never gets smaller than a screen pixel (see NOTES.md).
export async function loadTexture(gl, url) {
  const blob = await fetch(url).then(r => r.blob());
  // Exact texel values: no colour-space conversion or alpha premultiplying on the way in.
  const image = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

// Square RGBA images of the same size, one after another in `pixels`, as a texture array: one
// texture that a shader picks a layer of, which repeats. Sharp, unsmoothed texels up close, as for
// the car, but with mipmaps: the ground is mostly seen at a slant, where one pixel covers many
// texels, and without them it would shimmer as the camera moves.
export function createTextureArray(gl, pixels, size, layers) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  // Within a mipmap level, the nearest texel; between two levels, a blend, so there's no line
  // on the ground where one level gives way to the next.
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

// A shader's source. GLSL has no includes, so a line `#include "file"` is replaced by that file,
// from the same folder: shaders share the Frame block and the sky's light and mist that way.
// (A compile error's line numbers count the included lines too.)
async function fetchShader(url) {
  const folder = url.slice(0, url.lastIndexOf('/') + 1);
  const parts = (await fetch(url).then(r => r.text())).split(/^#include "(.+)"$/m);  // odd: names
  return (await Promise.all(parts.map((part, k) =>
    k % 2 ? fetch(folder + part).then(r => r.text()) : part))).join('');
}

// Fetch a vertex + fragment shader pair and link them into a program.
// Only the link status is checked: every status check makes JS wait for the GPU process
// to finish compiling, and a failed compile makes the link fail anyway.
export async function loadProgram(gl, vertexUrl, fragmentUrl) {
  const [vertexSource, fragmentSource] = await Promise.all([fetchShader(vertexUrl), fetchShader(fragmentUrl)]);

  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`${vertexUrl} + ${fragmentUrl}\n` +
      `${gl.getShaderInfoLog(vertex)}${gl.getShaderInfoLog(fragment)}${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

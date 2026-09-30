// Minimal Wavefront OBJ reader: positions, texture coordinates and faces. Normals are skipped:
// the shaders work out flat normals themselves. Negative (relative) face numbers aren't handled.

// Returns { vertices: Float32Array of x, y, z, u, v per vertex, indices: Uint16Array of
// triangles }. Positions are multiplied by `scale`. `keepFace(corners)` gets each face's corner
// positions and can drop the face by returning false; `placeUV(uv, corners)` can move its texture
// coordinates, [u, v], elsewhere on the texture.
export function parseObj(text, scale = 1, keepFace = () => true, placeUV = uv => uv) {
  const positions = [], uvs = [];
  const vertices = [], indices = [];
  const seen = new Map();  // "position/u,v" -> vertex number, so shared corners are stored once
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') positions.push(parts.slice(1, 4).map(n => n * scale));
    else if (parts[0] === 'vt') uvs.push([+parts[1], 1 - parts[2]]);  // OBJ's v runs up, images run down
    else if (parts[0] === 'f') {
      const corners = parts.slice(1).map(c => c.split('/'));  // position/uv/normal, counted from 1
      const at = corners.map(([p]) => positions[p - 1]);
      if (!keepFace(at)) continue;
      const ids = corners.map(([p, t]) => {
        const uv = placeUV(uvs[t - 1], at), key = `${p}/${uv}`;
        if (!seen.has(key)) {
          seen.set(key, vertices.length / 5);
          vertices.push(...positions[p - 1], ...uv);
        }
        return seen.get(key);
      });
      // A fan of triangles from the first corner: a quad becomes 2 triangles.
      for (let i = 2; i < ids.length; i++) indices.push(ids[0], ids[i - 1], ids[i]);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

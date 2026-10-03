"""Makes the game's files for the broadleaf trees (trees.js) from assets/tree_01 (laubbaum.blend, three
trees, and its 1536 x 2048 texture), without Blender:

    python3 bench/blend2obj.py assets/tree_01/laubbaum.blend /tmp/laubbaum.obj
    python3 bench/tree01.py /tmp/laubbaum.obj

writes assets/tree_01/tree_01.obj: the three trees, as objects tree_a (the blend's Circle to
Circle.004, its trunk and branches, and its Plane objects, its leaf cards), tree_b (Circle.005) and
tree_c (Circle.009), each moved to stand with its trunk's foot at 0, 0, 0; and
assets/tree_01/tree_01.png: the texture at a quarter of the size (384 x 512: still ~90 texels a
metre on a leaf card), the colour of every clear texel filled in from the leaves round it (in the
original it's black, which the mipmaps would bleed in as a dark edge round every leaf)."""

import sys
from PIL import Image, ImageFilter

src = open(sys.argv[1]).read().split('\n')
positions, uvs, faces, obj = [], [], [], None
for line in src:
    p = line.split()
    if not p:
        continue
    if p[0] == 'o':
        obj = p[1]
    elif p[0] == 'v':
        positions.append(tuple(map(float, p[1:4])))
    elif p[0] == 'vt':
        uvs.append(tuple(map(float, p[1:3])))
    elif p[0] == 'f':
        faces.append((obj, [tuple(int(n) - 1 for n in c.split('/')) for c in p[1:]]))

def tree_of(name):
    if name == 'Circle.005':
        return 'tree_b'
    if name == 'Circle.009':
        return 'tree_c'
    return 'tree_a'

out = ['# The three broadleaf trees of laubbaum.blend (bench/tree01.py): metres, y up, each standing at 0, 0, 0']
first_v, first_t = 1, 1
for tree in ('tree_a', 'tree_b', 'tree_c'):
    mine = [f for o, f in faces if tree_of(o) == tree]
    used = sorted({v for f in mine for v, t in f})
    # The trunk's foot: the middle of the vertices within 0.3 m of its lowest.
    low = min(positions[v][1] for v in used)
    foot = [positions[v] for v in used if positions[v][1] < low + 0.3]
    fx, fz = sum(p[0] for p in foot) / len(foot), sum(p[2] for p in foot) / len(foot)
    number = {v: k for k, v in enumerate(used)}
    out.append('o ' + tree)
    for v in used:
        x, y, z = positions[v]
        out.append('v %.4f %.4f %.4f' % (x - fx, y - low, z - fz))
    tused = sorted({t for f in mine for v, t in f})
    tnumber = {t: k for k, t in enumerate(tused)}
    for t in tused:
        out.append('vt %.5f %.5f' % uvs[t])
    for f in mine:
        out.append('f ' + ' '.join('%d/%d' % (first_v + number[v], first_t + tnumber[t]) for v, t in f))
    print('%s: %d vertices, %d faces, %.1f m tall' % (tree, len(used), len(mine), max(positions[v][1] for v in used) - low))
    first_v += len(used)
    first_t += len(tused)
open('assets/tree_01/tree_01.obj', 'w').write('\n'.join(out) + '\n')

image = Image.open('assets/tree_01/texture_laubbaum.png').convert('RGBA').resize((384, 512), Image.LANCZOS)
# Fill each clear texel's colour from its neighbours, outwards, a few texels at a time.
pixels = image.load()
w, h = image.size
filled = [[pixels[x, y][3] >= 128 for x in range(w)] for y in range(h)]
for _ in range(12):
    grown = []
    for y in range(h):
        for x in range(w):
            if filled[y][x]:
                continue
            near = [pixels[i, j] for i, j in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if 0 <= i < w and 0 <= j < h and filled[j][i]]
            if near:
                grown.append((x, y, tuple(sum(c[k] for c in near) // len(near) for k in range(3))))
    for x, y, c in grown:
        pixels[x, y] = c + (pixels[x, y][3],)
        filled[y][x] = True
image.save('assets/tree_01/tree_01.png', optimize=True)

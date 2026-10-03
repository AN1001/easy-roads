"""Reads the meshes out of a .blend file (Blender 2.6x, 64-bit, little-endian, uncompressed: as
assets/tree_01/laubbaum.blend is) without Blender, and writes them as one OBJ: each object's
vertices moved by its transform (obmat), z up turned to y up, its faces with their texture
coordinates (the mesh's first UV layer). For when there's no Blender to export with.

    python3 bench/blend2obj.py in.blend out.obj

A .blend file is its structs as they were in memory, in blocks, each with the address it had then
(pointers between them are those addresses) and which struct it holds; its last block (DNA1)
describes every struct: its fields' types and names, from which their sizes and offsets follow."""

import struct, sys, re

data = open(sys.argv[1], 'rb').read()
assert data[:7] == b'BLENDER' and data[7:8] == b'-' and data[8:9] == b'v', 'only 64-bit little-endian files'
PTR = 8

# The blocks: code, address, struct index, count, data.
blocks, at = [], 12
while True:
    code, size, address, sdna, count = struct.unpack_from('<4siQii', data, at)
    at += 24
    blocks.append((code.rstrip(b'\0').decode(), address, sdna, count, at, size))
    at += size
    if code == b'ENDB':
        break
by_address = {b[1]: b for b in blocks}

# The structs' description (DNA1).
dna = next(b for b in blocks if b[0] == 'DNA1')
at = dna[4]
assert data[at:at + 4] == b'SDNA'
at += 4

def read_names(at, tag):
    assert data[at:at + 4] == tag, tag
    n = struct.unpack_from('<i', data, at + 4)[0]
    at += 8
    names = []
    for _ in range(n):
        end = data.index(b'\0', at)
        names.append(data[at:end].decode())
        at = end + 1
    return names, (at + 3) & ~3

names, at = read_names(at, b'NAME')
types, at = read_names(at, b'TYPE')
assert data[at:at + 4] == b'TLEN'
lengths = struct.unpack_from('<%dh' % len(types), data, at + 4)
at = (at + 4 + 2 * len(types) + 3) & ~3
assert data[at:at + 4] == b'STRC'
nstructs = struct.unpack_from('<i', data, at + 4)[0]
at += 8
structs = []  # (type name, {field: (type, offset, size, array length, pointer)})
for _ in range(nstructs):
    t, nf = struct.unpack_from('<hh', data, at)
    at += 4
    fields, offset = {}, 0
    for _ in range(nf):
        ft, fn = struct.unpack_from('<hh', data, at)
        at += 4
        name = names[fn]
        pointer = name.startswith('*') or name.startswith('(*')
        array = 1
        for n in re.findall(r'\[(\d+)\]', name):
            array *= int(n)
        size = (PTR if pointer else lengths[ft]) * array
        bare = re.sub(r'[\*\(\)]|\[.*', '', name)
        fields[bare] = (types[ft], offset, size, array, pointer)
        offset += size
    structs.append((types[t], fields))
struct_index = {name: k for k, (name, _) in enumerate(structs)}

def field(block_at, struct_name, name, k=0):
    """A field of the struct at `block_at`: a number, a pointer, or a list for an array."""
    ftype, offset, size, array, pointer = structs[struct_index[struct_name]][1][name]
    fmt = 'Q' if pointer else {'float': 'f', 'int': 'i', 'short': 'h', 'char': 'b', 'double': 'd'}.get(ftype)
    if fmt is None:
        return block_at + offset  # a struct inside: its address in the file
    values = struct.unpack_from('<%d%s' % (array, fmt), data, block_at + offset)
    return values if array > 1 else values[0]

def size_of(struct_name):
    return lengths[types.index(struct_name)]

def pointed(address):
    """The block a pointer points at: (its position in the file, how many structs it holds)."""
    b = by_address.get(address)
    return (b[4], b[3]) if b else (None, 0)

def ob_name(at):
    raw = data[field(at, 'Object', 'id') + structs[struct_index['ID']][1]['name'][1]:][:66]
    return raw.split(b'\0')[0].decode(errors='replace')[2:]

out = ['# From %s by bench/blend2obj.py' % sys.argv[1].split('/')[-1]]
first = 1
for code, address, sdna, count, at, size in blocks:
    if code != 'OB' or structs[sdna][0] != 'Object':
        continue
    mesh_at, _ = pointed(field(at, 'Object', 'data'))
    if mesh_at is None or field(at, 'Object', 'type') != 1:  # 1: a mesh
        continue
    m = field(at, 'Object', 'obmat')  # 4 × 4, column by column
    def place(x, y, z):
        wx = m[0] * x + m[4] * y + m[8] * z + m[12]
        wy = m[1] * x + m[5] * y + m[9] * z + m[13]
        wz = m[2] * x + m[6] * y + m[10] * z + m[14]
        return wx, wz, -wy  # z up to y up
    totvert, totpoly = field(mesh_at, 'Mesh', 'totvert'), field(mesh_at, 'Mesh', 'totpoly')
    vert_at, _ = pointed(field(mesh_at, 'Mesh', 'mvert'))
    poly_at, _ = pointed(field(mesh_at, 'Mesh', 'mpoly'))
    loop_at, _ = pointed(field(mesh_at, 'Mesh', 'mloop'))
    uv_at, _ = pointed(field(mesh_at, 'Mesh', 'mloopuv'))
    vs, ps, ls, us = size_of('MVert'), size_of('MPoly'), size_of('MLoop'), size_of('MLoopUV')
    out.append('o %s' % ob_name(at))
    for k in range(totvert):
        out.append('v %.5f %.5f %.5f' % place(*field(vert_at + k * vs, 'MVert', 'co')))
    totloop = field(mesh_at, 'Mesh', 'totloop')
    for k in range(totloop):
        u, v = field(uv_at + k * us, 'MLoopUV', 'uv') if uv_at is not None else (0, 0)
        out.append('vt %.5f %.5f' % (u, v))
    for k in range(totpoly):
        start, n = field(poly_at + k * ps, 'MPoly', 'loopstart'), field(poly_at + k * ps, 'MPoly', 'totloop')
        corners = []
        for l in range(start, start + n):
            v = field(loop_at + l * ls, 'MLoop', 'v')
            corners.append('%d/%d' % (first + v, uv_first + l if False else 0))
        out.append(None)  # filled below
        out[-1] = ('f', [(first + field(loop_at + l * ls, 'MLoop', 'v'), l) for l in range(start, start + n)])
    print('%s: %d vertices, %d faces, %d corners, uv %s, loc %s' % (ob_name(at), totvert, totpoly, totloop, uv_at is not None,
          tuple(round(c, 2) for c in m[12:15])))
    # Texture coordinates are numbered across the whole file.
    out.append(('uvbase', totloop))
    first += totvert

# Number the texture coordinates file-wide, now each object's count is known.
lines, uv_base, pending = [], 1, []
for line in out:
    if isinstance(line, tuple) and line[0] == 'f':
        pending.append(line[1])
    elif isinstance(line, tuple) and line[0] == 'uvbase':
        for face in pending:
            lines.append('f ' + ' '.join('%d/%d' % (v, uv_base + l) for v, l in face))
        pending = []
        uv_base += line[1]
    else:
        lines.append(line)
open(sys.argv[2], 'w').write('\n'.join(lines) + '\n')

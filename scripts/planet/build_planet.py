# The planet's model (docs/planet.md): Blender reads the layout the
# generator wrote (art_src/planet/scene.json, public/map/planet/navigation.bin)
# and dresses it. Nothing here decides gameplay: every solid thing, every
# bush, pad and cache stands where scene.json puts it, and the ground is
# displaced by the generator's own heights, so the model matches the grid.
#
#   blender -b --factory-startup --python scripts/planet/build_planet.py -- \
#     [--previews DIR] [--no-export] [--samples N] [--bake-size PX]
#
# Builds the cube-sphere terrain (one mesh, six faces, a baked ground
# texture per face), the water caps, the props (one mesh per kind, linked
# duplicates per placement, so the exporter writes each mesh once), exports
# a raw GLB to $PLANET_WORK/build, and runs gltf-transform (instance, webp,
# meshopt; resize for the light model) into public/map/planet/. With
# --previews it renders the globe from four sides and five in-game views
# with Cycles.
#
# Axes: the sim and three.js share y up; Blender is z up. A sim point
# (x, y, z) is Blender (x, -z, y), and the glTF exporter's +Y up turns it
# back.

import base64
import hashlib
import json
import math
import os
import struct
import sys
import time
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCENE_JSON = os.path.join(ROOT, 'art_src', 'planet', 'scene.json')
NAV_BIN = os.path.join(ROOT, 'public', 'map', 'planet', 'navigation.bin')
ORCHARD_GLB = os.path.join(ROOT, 'public', 'map', 'star-orchard', 'map.glb')
WORK = os.environ.get('PLANET_WORK', '/tmp/planet-work')
BUILD_DIR = os.path.join(WORK, 'build')
OUT_DIR = os.path.join(ROOT, 'public', 'map', 'planet')
CACHE = os.path.join(WORK, 'cache')

FACES = [
    ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
]
BAKE_VERSION = 5


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'previews': None, 'export': True, 'samples': 12, 'bake': 2048, 'views': 'all'}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--previews':
            out['previews'] = argv[i + 1]
            i += 1
        elif a == '--no-export':
            out['export'] = False
        elif a == '--samples':
            out['samples'] = int(argv[i + 1])
            i += 1
        elif a == '--bake-size':
            out['bake'] = int(argv[i + 1])
            i += 1
        elif a == '--views':
            out['views'] = argv[i + 1]
            i += 1
        i += 1
    return out


def log(*parts):
    print('[planet]', *parts, flush=True)


# ---- coordinates -------------------------------------------------------------


def bl(p):
    """A sim point {x, y, z} (or a 3-sequence) in Blender axes."""
    if isinstance(p, dict):
        return Vector((p['x'], -p['z'], p['y']))
    return Vector((p[0], -p[2], p[1]))


def placement(at, up_h, forward=None, yaw=0.0):
    """Matrix for a prop standing at sim point `at`, lifted `up_h` meters,
    its local +Y along the sim tangent `forward` (or a yaw about the
    normal from an arbitrary tangent), local +Z along the normal."""
    p = bl(at)
    n = p.normalized()
    if forward is not None:
        f = bl(forward)
        f = (f - n * f.dot(n)).normalized()
    else:
        ref = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
        f = (ref - n * ref.dot(n)).normalized()
        f = (Matrix.Rotation(yaw, 3, n) @ f).normalized()
    x = f.cross(n).normalized()
    m = Matrix((
        (x.x, f.x, n.x, 0),
        (x.y, f.y, n.y, 0),
        (x.z, f.z, n.z, 0),
        (0, 0, 0, 1),
    ))
    m.translation = n * (p.length + up_h)
    return m


# ---- textures from the Star Orchard -----------------------------------------


def orchard_images():
    """The WebP images embedded in the shipped Star Orchard, by name."""
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    with open(ORCHARD_GLB, 'rb') as fh:
        data = fh.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    gj = json.loads(data[20:20 + jlen])
    bin_start = 20 + jlen + 8
    for img in gj.get('images', []):
        name = img.get('name', '')
        if name not in TEXTURE_SOURCES:
            continue
        bv = gj['bufferViews'][img['bufferView']]
        off = bin_start + bv.get('byteOffset', 0)
        path = os.path.join(CACHE, f'orchard_{name}.webp')
        if not os.path.exists(path):
            with open(path, 'wb') as fh:
                fh.write(data[off:off + bv['byteLength']])
        out[name] = path
    return out


# Tileable crops (source image, x, y, size in source pixels, top-left
# origin), mirrored 2 x 2 so they tile without a seam.
TEXTURE_SOURCES = {'web_floor_05', 'web_floor_01', 'web_floor_61', 'tower_facade_painted', 'web_floor_71', 'web_floor_11', 'web_floor_00'}
CROPS = {
    'limestone': ('web_floor_05', 900, 420, 480),
    'slate': ('web_floor_05', 120, 330, 560),
    'moss': ('web_floor_01', 156, 216, 96),
    'schist': ('web_floor_01', 360, 300, 110),
    'gold': ('web_floor_71', 40, 20, 160),
}


def load_image(path, name):
    img = bpy.data.images.load(path, check_existing=True)
    img.name = name
    return img


def image_pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def make_image(name, arr, colorspace='sRGB', alpha=False):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.pack()
    return img


def tile_textures():
    src = orchard_images()
    out = {}
    for key, (name, x, y, size) in CROPS.items():
        cached = os.path.join(CACHE, f'tile_{key}.png')
        if os.path.exists(cached):
            out[key] = load_image(cached, f'tile_{key}')
            continue
        img = load_image(src[name], f'src_{name}')
        px = image_pixels(img)
        h = px.shape[0]
        # Blender rows run bottom to top.
        crop = px[h - y - size:h - y, x:x + size, :]
        top = np.concatenate([crop, crop[:, ::-1]], axis=1)
        tiled = np.concatenate([top, top[::-1]], axis=0)
        tex = make_image(f'tile_{key}', tiled)
        tex.filepath_raw = cached
        tex.file_format = 'PNG'
        tex.save()
        out[key] = tex
    out['facade'] = load_image(src['tower_facade_painted'], 'facade')
    return out


# ---- the scene file ----------------------------------------------------------


def load_scene():
    with open(SCENE_JSON, 'r') as fh:
        scene = json.load(fh)
    t = scene['terrain']
    M = t['meshCellsPerFace']
    raw = zlib.decompress(base64.b64decode(t['heights']))
    heights = np.frombuffer(raw, dtype='<i2').astype(np.float32).reshape(6, M + 1, M + 1) * t['heightScale']
    p = scene['paint']
    praw = zlib.decompress(base64.b64decode(p['data']))
    n = p['cellsPerFace']
    C = len(p['channels'])
    paint = np.frombuffer(praw, dtype=np.uint8).reshape(6, n, n, C).astype(np.float32) / 255.0
    with open(NAV_BIN, 'rb') as fh:
        nav = np.frombuffer(fh.read(), dtype='<i2').reshape(6, n, n)
    digest = hashlib.sha1(open(SCENE_JSON, 'rb').read()).hexdigest()[:12]
    return scene, heights, paint, nav, digest


# ---- terrain -------------------------------------------------------------------


def face_dirs(f, M):
    N, U, V = (np.array(a, dtype=np.float64) for a in FACES[f])
    a = np.arange(M + 1)
    u = 2 * a / M - 1
    uu, vv = np.meshgrid(u, u)  # [b][a]
    d = N[None, None, :] + uu[..., None] * U[None, None, :] + vv[..., None] * V[None, None, :]
    d /= np.linalg.norm(d, axis=2, keepdims=True)
    return d  # sim axes, [b][a][3]


def region_weights(d, sharp):
    dots = np.stack([d @ np.array(FACES[f][0], dtype=np.float64) for f in range(6)], axis=-1)
    w = np.exp(sharp * (dots - 1))
    return w / w.sum(axis=-1, keepdims=True)


def build_terrain(scene, heights, materials):
    R = scene['radius']
    M = scene['terrain']['meshCellsPerFace']
    sharp = scene['regionBlend']['sharpness']
    verts, faces, uvs, mats, wa, wb = [], [], [], [], [], []
    base = 0
    for f in range(6):
        d = face_dirs(f, M)
        h = heights[f]
        p = d * (R + h[..., None])
        bp = np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1).reshape(-1, 3)
        verts.append(bp)
        w = region_weights(d, sharp).reshape(-1, 6)
        hn = h.reshape(-1, 1)
        wa.append(np.concatenate([w[:, 0:4]], axis=1))
        wb.append(np.concatenate([w[:, 4:6], hn, np.ones_like(hn)], axis=1))
        a = np.arange(M)
        aa, bb = np.meshgrid(a, a)
        i0 = (bb * (M + 1) + aa).ravel() + base
        quads = np.stack([i0, i0 + 1, i0 + M + 2, i0 + M + 1], axis=1)
        faces.append(quads)
        ua = np.stack([aa / M, bb / M], axis=-1).reshape(-1, 2)
        loop_uv = np.stack([
            ua,
            ua + [1 / M, 0],
            ua + [1 / M, 1 / M],
            ua + [0, 1 / M],
        ], axis=1).reshape(-1, 2)
        uvs.append(loop_uv)
        mats.append(np.full(len(quads), f, dtype=np.int32))
        base += (M + 1) * (M + 1)
    verts = np.concatenate(verts).astype(np.float32)
    faces = np.concatenate(faces)
    uvs = np.concatenate(uvs).astype(np.float32)
    mats = np.concatenate(mats)
    wa = np.concatenate(wa).astype(np.float32)
    wb = np.concatenate(wb).astype(np.float32)

    me = bpy.data.meshes.new('Terrain')
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set('vertex_index', faces.ravel().astype(np.int32))
    me.polygons.add(len(faces))
    me.polygons.foreach_set('loop_start', np.arange(0, faces.size, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(faces), 4, dtype=np.int32))
    me.polygons.foreach_set('material_index', mats)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', uvs.ravel())
    ca = me.color_attributes.new('regionA', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', wa.ravel())
    cb = me.color_attributes.new('regionB', 'FLOAT_COLOR', 'POINT')
    cb.data.foreach_set('color', wb.ravel())
    me.update(calc_edges=True)
    me.validate()
    for m in materials:
        me.materials.append(m)
    obj = bpy.data.objects.new('Terrain', me)
    bpy.context.scene.collection.objects.link(obj)
    # One surface: weld the face seams so the shading runs across them.
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bm.to_mesh(me)
    bm.free()
    # Gentle ground shades smooth; rock walls and steep faces stay faceted.
    count = len(me.polygons)
    nrm = np.empty(count * 3, dtype=np.float32)
    ctr = np.empty(count * 3, dtype=np.float32)
    me.polygons.foreach_get('normal', nrm)
    me.polygons.foreach_get('center', ctr)
    nrm = nrm.reshape(-1, 3)
    ctr = ctr.reshape(-1, 3)
    radial = ctr / np.linalg.norm(ctr, axis=1, keepdims=True)
    steep = (nrm * radial).sum(axis=1) < math.cos(math.radians(32))
    me.polygons.foreach_set('use_smooth', (~steep).astype(bool))
    me.set_sharp_from_angle(angle=math.radians(50))
    return obj


# ---- shader helpers ------------------------------------------------------------


class Nodes:
    def __init__(self, mat):
        mat.use_nodes = True
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def new(self, kind, **props):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x += 40
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def value(self, v):
        n = self.new('ShaderNodeValue')
        n.outputs[0].default_value = v
        return n.outputs[0]

    def rgb(self, c):
        n = self.new('ShaderNodeRGB')
        n.outputs[0].default_value = (*srgb(c), 1)
        return n.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        n = self.new('ShaderNodeMath', operation=op, use_clamp=clamp)
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        return n.outputs[0]

    def _in(self, socket, v):
        if isinstance(v, (int, float)):
            socket.default_value = v
        elif isinstance(v, tuple):
            socket.default_value = v
        else:
            self.link(v, socket)

    def mix(self, a, b, fac, blend='MIX'):
        n = self.new('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self._in(n.inputs[0], fac)
        self._in(n.inputs[6], a if not isinstance(a, tuple) else (*a, 1))
        self._in(n.inputs[7], b if not isinstance(b, tuple) else (*b, 1))
        return n.outputs[2]

    def noise(self, vec, scale, detail=3, rough=0.55):
        n = self.new('ShaderNodeTexNoise', noise_dimensions='3D')
        self.link(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        return n.outputs['Fac']

    def voronoi(self, vec, scale, feature='F1', out='Distance'):
        n = self.new('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature=feature)
        self.link(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        return n.outputs[out]

    def ramp(self, fac, stops):
        n = self.new('ShaderNodeValToRGB')
        self._in(n.inputs[0], fac)
        cr = n.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = (*srgb(stops[0][1]), 1)
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = (*srgb(col), 1)
        return n.outputs[0]

    def image(self, img, vec=None, interp='Linear', ext='REPEAT'):
        n = self.new('ShaderNodeTexImage', interpolation=interp, extension=ext)
        n.image = img
        if vec is not None:
            self.link(vec, n.inputs['Vector'])
        return n

    def smooth(self, x, e0, e1):
        n = self.new('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self._in(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = e0
        n.inputs['From Max'].default_value = e1
        return n.outputs['Result']

    def separate(self, color):
        n = self.new('ShaderNodeSeparateColor')
        self.link(color, n.inputs[0])
        return n.outputs

    def attr(self, name):
        n = self.new('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=name)
        return n

    def scale_vec(self, vec, s):
        n = self.new('ShaderNodeVectorMath', operation='SCALE')
        self.link(vec, n.inputs[0])
        n.inputs['Scale'].default_value = s
        return n.outputs[0]


def srgb(c):
    """Hex or 0..255 triple to linear floats."""
    if isinstance(c, str):
        c = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
    out = []
    for x in c:
        x = x / 255.0 if x > 1.0 or isinstance(x, int) else x
        out.append(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# ---- the ground --------------------------------------------------------------------

# Region order is the face order: ruins, groves, sanctuary, open, lakes, cliffs.
REGION_GROUND = [
    ('#a99c7c', '#8d8166', '#b9ad8c'),  # ruins: dusty limestone dirt
    ('#3f5e2c', '#2f4a22', '#55753a'),  # groves: deep moss
    ('#6f9a4a', '#5f8a3e', '#86ad5a'),  # sanctuary: kept lawns
    ('#a9984f', '#8f8240', '#c2b065'),  # open: golden steppe
    ('#5f9447', '#4e7f3b', '#77a957'),  # lakes: lush meadow
    ('#8a9692', '#76837f', '#9aa49a'),  # cliffs: blue-grey schist scree
]


def ground_material(f, paint_img_a, paint_img_b, tex):
    mat = bpy.data.materials.new(f'GroundBake_{f}')
    G = Nodes(mat)
    out = G.new('ShaderNodeOutputMaterial')
    bsdf = G.new('ShaderNodeBsdfPrincipled')
    G.link(bsdf.outputs[0], out.inputs[0])
    uvn = G.new('ShaderNodeUVMap', uv_map='UVMap')
    uv = uvn.outputs[0]
    geo = G.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    pa = G.separate(G.image(paint_img_a, uv, ext='EXTEND').outputs['Color'])
    pb = G.separate(G.image(paint_img_b, uv, ext='EXTEND').outputs['Color'])
    path, paving, shore, rock = pa[0], pa[1], pa[2], pa[3] if False else None
    # The fourth paint channel rides in paintA's alpha.
    ia = G.image(paint_img_a, uv, ext='EXTEND')
    rock = ia.outputs['Alpha']
    lush, camp = pb[0], pb[1]
    attr_a = G.attr('regionA')
    ra = G.separate(attr_a.outputs['Color'])
    rb = G.separate(G.attr('regionB').outputs['Color'])
    weights = [ra[0], ra[1], ra[2], attr_a.outputs['Alpha'], rb[0], rb[1]]
    height = rb[2]
    # Tiling coordinates in meters (planar per face).
    meters = G.scale_vec(uv, 128.0)

    n_big = G.noise(pos, 0.05, 4, 0.6)
    n_mid = G.noise(pos, 0.22, 4, 0.55)
    n_fine = G.noise(pos, 1.6, 3, 0.5)
    # Region grounds blended by weight.
    ground = None
    acc = None
    for r in range(6):
        c0, c1, c2 = REGION_GROUND[r]
        col = G.mix(G.rgb(c1), G.rgb(c0), G.smooth(n_big, 0.35, 0.65))
        col = G.mix(col, G.rgb(c2), G.math('MULTIPLY', G.smooth(n_mid, 0.55, 0.75), 0.8))
        if r == 1 or r == 5 or r == 4:
            moss = G.image(tex['moss'], G.scale_vec(meters, 0.5)).outputs['Color']
            col = G.mix(col, moss, 0.25, 'OVERLAY')
        if r == 5:
            sch = G.image(tex['schist'], G.scale_vec(meters, 0.33)).outputs['Color']
            col = G.mix(col, sch, 0.22, 'OVERLAY')
        col = G.mix(col, G.rgb('#000000'), G.math('MULTIPLY', n_fine, 0.12))
        term = G.mix((0, 0, 0), col, weights[r], 'MIX')
        acc = term if acc is None else G.mix(acc, term, 1.0, 'ADD')
    ground = acc
    # Lush: forest floor under the woods, darker and greener.
    lush_col = G.mix(G.rgb('#24361a'), G.rgb('#355226'), G.smooth(n_mid, 0.3, 0.7))
    ground = G.mix(ground, lush_col, G.math('MULTIPLY', lush, 0.85))
    # Shore sand and the lake bed.
    sand = G.mix(G.rgb('#b9a77a'), G.rgb('#9c8a60'), G.smooth(n_fine, 0.3, 0.7))
    ground = G.mix(ground, sand, G.smooth(shore, 0.15, 0.65))
    bed = G.mix(G.rgb('#3a4a3a'), G.rgb('#2b3a35'), n_mid)
    ground = G.mix(ground, bed, G.smooth(height, -0.25, -0.75))
    # Bare rock.
    schist = G.image(tex['schist'], G.scale_vec(meters, 0.25)).outputs['Color']
    rock_col = G.mix(G.rgb('#66737b'), schist, 0.35, 'OVERLAY')
    rock_col = G.mix(rock_col, G.rgb('#8494a0'), G.smooth(n_mid, 0.5, 0.8))
    ground = G.mix(ground, rock_col, G.smooth(rock, 0.25, 0.75))
    # Camp floors: trampled earth.
    camp_col = G.mix(G.rgb('#7d6a4c'), G.rgb('#68583e'), n_fine)
    camp_ring = G.math('MULTIPLY', G.smooth(camp, 0.05, 0.4), G.math('SUBTRACT', 1.0, G.smooth(camp, 0.75, 1.0)))
    ground = G.mix(ground, camp_col, G.math('ADD', G.math('MULTIPLY', G.smooth(camp, 0.2, 0.8), 0.22), G.math('MULTIPLY', camp_ring, 0.4)))
    # Worn paths: limestone chips with a ragged edge.
    edge = G.math('ADD', path, G.math('MULTIPLY', G.math('SUBTRACT', n_fine, 0.5), 0.5))
    chips = G.mix(G.rgb('#cdbb94'), G.rgb('#b4a27b'), G.smooth(n_fine, 0.35, 0.65))
    chips = G.mix(chips, G.rgb('#e2d5b4'), G.math('MULTIPLY', G.smooth(G.voronoi(pos, 2.2), 0.0, 0.25), 0.25))
    ground = G.mix(ground, chips, G.smooth(edge, 0.42, 0.62))
    # Paving: limestone slabs, slate in the Ruins and the Cliffs.
    lime = G.image(tex['limestone'], G.scale_vec(meters, 0.42)).outputs['Color']
    slate = G.image(tex['slate'], G.scale_vec(meters, 0.36)).outputs['Color']
    dark_w = G.math('ADD', G.math('MULTIPLY', weights[0], 0.45), weights[5])
    slate_soft = G.mix(slate, lime, 0.3)
    pave = G.mix(lime, slate_soft, G.math('MULTIPLY', G.smooth(dark_w, 0.3, 0.7), 0.8))
    pave = G.mix(pave, G.rgb('#7a7a6a'), G.math('MULTIPLY', G.smooth(n_mid, 0.6, 0.9), 0.35))
    ground = G.mix(ground, pave, G.smooth(paving, 0.35, 0.6))
    G.link(ground, bsdf.inputs['Base Color'])
    target = G.new('ShaderNodeTexImage')
    target.name = 'BakeTarget'
    mat['bake_target'] = target.name
    G.nt.nodes.active = target
    return mat, target


def paint_images(paint):
    out = []
    for f in range(6):
        a = paint[f][:, :, 0:4]
        b = np.concatenate([paint[f][:, :, 4:6], np.zeros_like(paint[f][:, :, 0:1]), np.ones_like(paint[f][:, :, 0:1])], axis=2)
        ia = make_image(f'paintA_{f}', a, 'Non-Color', alpha=True)
        ia.alpha_mode = 'CHANNEL_PACKED'
        ib = make_image(f'paintB_{f}', b, 'Non-Color', alpha=True)
        out.append((ia, ib))
    return out


def bake_ground(scene, heights, paint, digest, tex, size):
    os.makedirs(CACHE, exist_ok=True)
    key = f'{digest}_{BAKE_VERSION}_{size}'
    paths = [os.path.join(CACHE, f'ground_{key}_{f}.png') for f in range(6)]
    final = []
    for f in range(6):
        m = bpy.data.materials.new(f'PlanetGround_{f}')
        final.append(m)
    terrain = build_terrain(scene, heights, final)
    if all(os.path.exists(p) for p in paths):
        log('ground bake cached', key)
        imgs = [load_image(p, f'planet_ground_{f}') for f, p in enumerate(paths)]
    else:
        t0 = time.time()
        pimgs = paint_images(paint)
        bake_mats = []
        imgs = []
        for f in range(6):
            mat, target = ground_material(f, pimgs[f][0], pimgs[f][1], tex)
            img = bpy.data.images.new(f'planet_ground_{f}', size, size, alpha=False)
            target.image = img
            bake_mats.append(mat)
            imgs.append(img)
        me = terrain.data
        for f in range(6):
            me.materials[f] = bake_mats[f]
        sc = bpy.context.scene
        limit_threads()
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = 1
        sc.render.bake.use_pass_direct = False
        sc.render.bake.use_pass_indirect = False
        sc.render.bake.use_pass_color = True
        sc.render.bake.margin = 4
        for o in bpy.context.selected_objects:
            o.select_set(False)
        terrain.select_set(True)
        bpy.context.view_layer.objects.active = terrain
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
        for f, img in enumerate(imgs):
            img.filepath_raw = paths[f]
            img.file_format = 'PNG'
            img.save()
        for f in range(6):
            me.materials[f] = final[f]
        log(f'ground baked in {time.time() - t0:.1f} s')
    for f in range(6):
        G = Nodes(final[f])
        out = G.new('ShaderNodeOutputMaterial')
        bsdf = G.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.95
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
        im = G.image(imgs[f], G.new('ShaderNodeUVMap', uv_map='UVMap').outputs[0], ext='EXTEND')
        G.link(im.outputs['Color'], bsdf.inputs['Base Color'])
        G.link(bsdf.outputs[0], out.inputs[0])
    return terrain


# ---- water -----------------------------------------------------------------------


def build_water(scene, heights):
    R = scene['radius']
    level = scene['waterLevel']
    M = scene['terrain']['meshCellsPerFace']
    verts = []
    faces = []
    index = {}
    for f in range(6):
        h = heights[f]
        wet = (h[:-1, :-1] < level) | (h[1:, :-1] < level) | (h[:-1, 1:] < level) | (h[1:, 1:] < level)
        if not wet.any():
            continue
        d = face_dirs(f, M) * (R + level)
        bs, as_ = np.nonzero(wet)
        for b, a in zip(bs.tolist(), as_.tolist()):
            quad = []
            for (aa, bb) in ((a, b), (a + 1, b), (a + 1, b + 1), (a, b + 1)):
                k = (f, aa, bb)
                if k not in index:
                    p = d[bb, aa]
                    index[k] = len(verts)
                    verts.append((p[0], -p[2], p[1]))
                quad.append(index[k])
            faces.append(quad)
    me = bpy.data.meshes.new('Water')
    me.from_pydata(verts, [], faces)
    for poly in me.polygons:
        poly.use_smooth = True
    mat = bpy.data.materials.new('Water')
    G = Nodes(mat)
    out = G.new('ShaderNodeOutputMaterial')
    bsdf = G.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (*srgb('#2f7f9a'), 1)
    bsdf.inputs['Roughness'].default_value = 0.08
    bsdf.inputs['Alpha'].default_value = 0.72
    bsdf.inputs['Emission Color'].default_value = (*srgb('#1d5a70'), 1)
    bsdf.inputs['Emission Strength'].default_value = 0.15
    G.link(bsdf.outputs[0], out.inputs[0])
    mat.blend_method = 'BLEND'
    me.materials.append(mat)
    obj = bpy.data.objects.new('Water', me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---- materials -------------------------------------------------------------------

PALETTE = {
    'Slate': ('#3d5573', 0.0, 0.75),
    'SlateDark': ('#26364d', 0.0, 0.8),
    'Limestone': ('#d9ccad', 0.0, 0.85),
    'LimestoneDark': ('#b3a584', 0.0, 0.9),
    'Gold': ('#d4a640', 0.85, 0.35),
    'Bronze': ('#8c5a2e', 0.6, 0.45),
    'Obsidian': ('#171a26', 0.2, 0.3),
    'Bark': ('#5b4331', 0.0, 0.9),
    'Cypress': ('#28462a', 0.0, 0.85),
    'CypressLight': ('#36603a', 0.0, 0.85),
    'Olive': ('#5d7a38', 0.0, 0.85),
    'BushLeaf': ('#6dbb3c', 0.0, 0.7),
    'BushTop': ('#9fdc58', 0.0, 0.7),
    'Undergrowth': ('#1f3a1e', 0.0, 0.9),
    'Fern': ('#3f6e2c', 0.0, 0.85),
    'Grass': ('#86a043', 0.0, 0.9),
    'TallGrass': ('#c9ad5e', 0.0, 0.9),
    'Reed': ('#8f9447', 0.0, 0.9),
    'Lily': ('#3e7d3a', 0.0, 0.6),
    'FlowerBlue': ('#6aa6ff', 0.0, 0.6),
    'FlowerWhite': ('#f1ead6', 0.0, 0.6),
    'FlowerGold': ('#f0c84a', 0.0, 0.6),
    'Rock': ('#5b6873', 0.0, 0.85),
    'RockLight': ('#7f8c94', 0.0, 0.85),
    'Moss': ('#56723a', 0.0, 0.9),
    'Banner': ('#2a4fa8', 0.0, 0.7),
    'Hedge': ('#2e5a2b', 0.0, 0.9),
}
GLOW = {
    'Amber': ('#ffb347', 6.0),
    'Crystal': ('#7fd8ff', 8.0),
    'PadGlow': ('#5fc8ff', 5.0),
    'Rune': ('#58b8ff', 4.0),
    'Fruit': ('#78c8ff', 3.0),
}
_mats = {}


def material(name, tex=None):
    if name in _mats:
        return _mats[name]
    mat = bpy.data.materials.new(name)
    G = Nodes(mat)
    out = G.new('ShaderNodeOutputMaterial')
    bsdf = G.new('ShaderNodeBsdfPrincipled')
    G.link(bsdf.outputs[0], out.inputs[0])
    if name in PALETTE:
        c, metal, rough = PALETTE[name]
        bsdf.inputs['Base Color'].default_value = (*srgb(c), 1)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
    elif name in GLOW:
        c, k = GLOW[name]
        bsdf.inputs['Base Color'].default_value = (*srgb(c), 1)
        bsdf.inputs['Emission Color'].default_value = (*srgb(c), 1)
        bsdf.inputs['Emission Strength'].default_value = k
    elif name == 'Facade' and tex is not None:
        im = G.image(tex['facade'], G.new('ShaderNodeUVMap', uv_map='UVMap').outputs[0])
        G.link(im.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.7
    _mats[name] = mat
    return mat


# ---- mesh building ----------------------------------------------------------------


class Mesh:
    """A small bmesh builder: primitives with a material each."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.slots = []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def _faces(self, faces, mat):
        k = self.slot(mat)
        for f in faces:
            f.material_index = k
            f.smooth = False

    def lathe(self, profile, sides, mat, center=(0, 0, 0), twist=0.0, jitter=0.0, seed=0, cap=True, scale_xy=(1, 1)):
        """Revolves (radius, z) pairs; radius 0 closes a pole."""
        rng = np.random.default_rng(seed)
        rings = []
        cx, cy, cz = center
        for k, (r, z) in enumerate(profile):
            if r <= 1e-6:
                rings.append([self.bm.verts.new((cx, cy, cz + z))])
                continue
            ring = []
            for s in range(sides):
                a = 2 * math.pi * s / sides + twist * k
                rr = r * (1 + (rng.uniform(-jitter, jitter) if jitter else 0))
                ring.append(self.bm.verts.new((cx + rr * math.cos(a) * scale_xy[0], cy + rr * math.sin(a) * scale_xy[1], cz + z)))
            rings.append(ring)
        faces = []
        for a, b in zip(rings, rings[1:]):
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                for s in range(sides):
                    faces.append(self.bm.faces.new((a[0], b[s], b[(s + 1) % sides])))
            elif len(b) == 1:
                for s in range(sides):
                    faces.append(self.bm.faces.new((a[s], b[0], a[(s + 1) % sides])))
            else:
                for s in range(sides):
                    faces.append(self.bm.faces.new((a[s], b[s], b[(s + 1) % sides], a[(s + 1) % sides])))
        if cap:
            if len(rings[0]) > 1:
                faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            if len(rings[-1]) > 1:
                faces.append(self.bm.faces.new(rings[-1]))
        self._faces(faces, mat)
        return faces

    def box(self, x0, x1, y0, y1, z0, z1, mat, uv_scale=None):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        vs = r['verts']
        for v in vs:
            v.co = Vector((
                x0 if v.co.x < 0 else x1,
                y0 if v.co.y < 0 else y1,
                z0 if v.co.z < 0 else z1,
            ))
        faces = list({f for v in vs for f in v.link_faces})
        self._faces(faces, mat)
        if uv_scale:
            for f in faces:
                nrm = f.normal
                for loop in f.loops:
                    co = loop.vert.co
                    if abs(nrm.z) > 0.7:
                        u, v = co.x, co.y
                    elif abs(nrm.x) > abs(nrm.y):
                        u, v = co.y, co.z
                    else:
                        u, v = co.x, co.z
                    loop[self.uv].uv = (u / uv_scale[0], v / uv_scale[1])
        return faces

    def blob(self, center, radius, mat, subdiv=1, squash=1.0, jitter=0.0, seed=0):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0)
        rng = np.random.default_rng(seed)
        for v in r['verts']:
            k = 1 + (rng.uniform(-jitter, jitter) if jitter else 0)
            v.co = Vector((center[0] + v.co.x * radius[0] * k, center[1] + v.co.y * radius[1] * k, center[2] + v.co.z * radius[2] * k * squash))
        faces = list({f for v in r['verts'] for f in v.link_faces})
        self._faces(faces, mat)
        return faces

    def blade(self, base, top_offset, width, mat):
        b0 = self.bm.verts.new((base[0] - width, base[1], base[2]))
        b1 = self.bm.verts.new((base[0] + width, base[1], base[2]))
        t = self.bm.verts.new((base[0] + top_offset[0], base[1] + top_offset[1], base[2] + top_offset[2]))
        f = self.bm.faces.new((b0, b1, t))
        self._faces([f], mat)

    def finish(self, smooth=False):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.slots:
            me.materials.append(material(m))
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        return me


def rock_mesh(name, seed, tall=1.0, mat='Rock', top='RockLight'):
    m = Mesh(name)
    rng = np.random.default_rng(seed)
    prof = [(0.92, -0.25), (1.0, 0.15), (0.85, 0.55 * tall), (0.55, 0.85 * tall), (0.0, 1.0 * tall)]
    m.lathe(prof, 7, mat, jitter=0.18, seed=seed)
    if rng.uniform() < 2:
        m.lathe([(0.5, 0.8 * tall), (0.32, 0.95 * tall), (0.0, 1.03 * tall)], 6, top, center=(0.15, -0.1, 0), jitter=0.2, seed=seed + 1)
    return m.finish()


def cypress_mesh(name, seed, fruit=False, leaf='Cypress'):
    m = Mesh(name)
    rng = np.random.default_rng(seed)
    m.lathe([(0.2, 0.0), (0.14, 1.3)], 6, 'Bark')
    w = rng.uniform(0.85, 1.1)
    prof = [(0.0, 0.8), (0.75 * w, 1.4), (0.95 * w, 2.4), (0.9 * w, 3.8), (0.7 * w, 5.2), (0.42 * w, 6.4), (0.0, 7.5)]
    m.lathe(prof, 8, leaf, twist=0.35, jitter=0.12, seed=seed)
    if fruit:
        for k in range(7):
            a = rng.uniform(0, 2 * math.pi)
            z = rng.uniform(1.6, 5.4)
            rr = 0.85 * w * (1 - (z - 1.4) / 7.0) + 0.05
            m.blob((rr * math.cos(a), rr * math.sin(a), z), (0.13, 0.13, 0.2), 'Fruit', subdiv=1)
    return m.finish()


def round_tree_mesh(name, seed):
    m = Mesh(name)
    rng = np.random.default_rng(seed)
    m.lathe([(0.25, 0.0), (0.16, 2.2), (0.0, 2.6)], 6, 'Bark')
    for k in range(4):
        a = rng.uniform(0, 2 * math.pi)
        d = 0.0 if k == 0 else rng.uniform(0.6, 1.0)
        m.blob((d * math.cos(a), d * math.sin(a), 3.4 + rng.uniform(-0.2, 0.6)), (1.25, 1.25, 1.0), 'Olive', subdiv=1, jitter=0.12, seed=seed + k)
    return m.finish()


def bush_mesh(name, seed):
    m = Mesh(name)
    rng = np.random.default_rng(seed)
    m.blob((0, 0, 0.35), (0.95, 0.95, 0.75), 'BushLeaf', subdiv=2, jitter=0.08, seed=seed)
    for k in range(6):
        a = 2 * math.pi * k / 6 + rng.uniform(-0.3, 0.3)
        m.blob((0.62 * math.cos(a), 0.62 * math.sin(a), 0.3), (0.45, 0.45, 0.5), 'BushLeaf', subdiv=1, jitter=0.1, seed=seed + k)
    m.blob((0, 0, 0.62), (0.6, 0.6, 0.45), 'BushTop', subdiv=1, jitter=0.1, seed=seed + 9)
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.2, 0.85)
        z = 0.9 - 0.5 * d * d + 0.05
        m.blob((d * math.cos(a), d * math.sin(a), z), (0.07, 0.07, 0.07), 'FlowerGold' if k % 2 else 'FlowerWhite', subdiv=1)
    return m.finish()


def tuft_mesh(name, seed, mat, blades=6, height=0.5, spread=0.25, width=0.05, heads=None):
    m = Mesh(name)
    rng = np.random.default_rng(seed)
    for k in range(blades):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0, spread * 0.4)
        base = (d * math.cos(a), d * math.sin(a), -0.02)
        top = (spread * math.cos(a), spread * math.sin(a), height * rng.uniform(0.7, 1.1))
        m.blade(base, top, width, mat)
        if heads:
            m.blob((base[0] + top[0], base[1] + top[1], top[2]), (0.06, 0.06, 0.06), heads, subdiv=1)
    return m.finish()


def pillar_mesh(name, broken=False, seed=0, stone='Limestone'):
    m = Mesh(name)
    m.lathe([(1.25, 0.0), (1.25, 0.18), (1.05, 0.3)], 8, stone)
    top = 0.55 if broken else 0.9
    m.lathe([(0.82, 0.3), (0.78, top)], 8, stone, jitter=0.03 if not broken else 0.12, seed=seed)
    if not broken:
        m.lathe([(0.84, 0.9), (0.84, 0.94)], 8, 'Gold')
        m.lathe([(1.15, 0.94), (1.15, 1.0)], 8, stone)
    return m.finish()


def wall_mesh(name, low=False):
    m = Mesh(name)
    m.box(-0.5, 0.5, -0.5, 0.5, -0.25, 0.94, 'Slate' if not low else 'LimestoneDark')
    m.box(-0.58, 0.58, -0.5, 0.5, 0.94, 1.0, 'Gold' if not low else 'Limestone')
    return m.finish()


def spire_mesh():
    m = Mesh('spire')
    m.lathe([(5.6, -0.4), (5.6, 0.25), (4.9, 0.25), (4.9, 0.5), (4.25, 0.5), (4.25, 0.8)], 16, 'Limestone')
    m.lathe([(3.4, 0.8), (3.2, 4.0)], 8, 'SlateDark')
    m.lathe([(3.35, 4.0), (3.35, 4.5)], 8, 'Gold')
    m.lathe([(2.9, 4.5), (1.4, 27.0)], 8, 'Slate', twist=0.0)
    for z in (10.0, 16.0, 22.0):
        r = 2.9 - (2.9 - 1.4) * (z - 4.5) / 22.5
        m.lathe([(r + 0.12, z), (r + 0.12, z + 0.45)], 8, 'Gold')
    m.lathe([(1.5, 27.0), (0.0, 29.0)], 8, 'Gold')
    m.lathe([(0.0, 29.6), (1.25, 31.6), (0.0, 34.6)], 6, 'Crystal')
    m.lathe([(2.2, 31.3), (2.2, 31.6), (1.95, 31.6), (1.95, 31.3)], 24, 'Gold', cap=False)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        verts = [(3.0, 0.8), (5.0, 0.8), (3.0, 9.0)]
        bmv = []
        for (r, z) in verts:
            for t in (-0.22, 0.22):
                bmv.append(m.bm.verts.new((r * c - t * s, r * s + t * c, z)))
        fs = [
            m.bm.faces.new((bmv[0], bmv[2], bmv[4])),
            m.bm.faces.new((bmv[1], bmv[5], bmv[3])),
            m.bm.faces.new((bmv[0], bmv[1], bmv[3], bmv[2])),
            m.bm.faces.new((bmv[2], bmv[3], bmv[5], bmv[4])),
            m.bm.faces.new((bmv[4], bmv[5], bmv[1], bmv[0])),
        ]
        m._faces(fs, 'Gold')
    return m.finish()


def monolith_mesh():
    m = Mesh('monolith')
    m.lathe([(4.4, -0.5), (4.4, 0.4), (3.9, 0.7)], 12, 'SlateDark')
    for (x, y, h, r, tw) in ((0.6, 0.4, 15.0, 1.7, 0.1), (-1.6, -0.9, 10.5, 1.3, 0.3), (1.1, -1.9, 8.0, 1.1, 0.5)):
        m.lathe([(r, 0.6), (r * 0.82, h * 0.85), (0.0, h)], 6, 'Obsidian', center=(x, y, 0), twist=tw)
        m.lathe([(r * 0.95, h * 0.3), (r * 0.93, h * 0.33)], 6, 'Rune', center=(x, y, 0), cap=False)
        m.lathe([(r * 0.88, h * 0.6), (r * 0.86, h * 0.62)], 6, 'Rune', center=(x, y, 0), cap=False)
    return m.finish()


def beacon_mesh():
    m = Mesh('beacon')
    m.lathe([(1.6, -0.4), (1.6, 0.4), (1.3, 0.6)], 4, 'Limestone')
    m.lathe([(1.1, 0.6), (0.6, 12.5)], 4, 'Slate')
    m.lathe([(0.75, 4.0), (0.75, 4.3)], 4, 'Gold')
    m.lathe([(0.66, 9.0), (0.66, 9.3)], 4, 'Gold')
    m.lathe([(0.8, 12.5), (0.8, 12.8), (0.0, 13.1)], 4, 'Gold')
    m.lathe([(0.0, 13.3), (0.6, 14.4), (0.0, 16.2)], 4, 'Crystal')
    m.lathe([(1.25, 13.9), (1.25, 14.1), (1.1, 14.1), (1.1, 13.9)], 16, 'Amber', cap=False)
    return m.finish()


def pad_mesh():
    m = Mesh('pad')
    m.lathe([(1.6, -0.15), (1.6, 0.1), (1.45, 0.14)], 20, 'Gold')
    m.lathe([(1.45, 0.11), (0.0, 0.12)], 20, 'PadGlow')
    for k in range(3):
        y = -0.6 + 0.55 * k
        vs = [(-0.55, y), (0.0, y + 0.45), (0.55, y), (0.4, y - 0.12), (0.0, y + 0.25), (-0.4, y - 0.12)]
        bv = [m.bm.verts.new((x, yy, 0.14)) for (x, yy) in vs]
        f = m.bm.faces.new(bv)
        m._faces([f], 'Amber')
    return m.finish()


def gate_mesh():
    m = Mesh('gate_arch')
    for side in (-1, 1):
        y = side * 3.9
        m.box(-0.8, 0.8, y - 0.8, y + 0.8, -0.3, 0.6, 'Limestone')
        m.box(-0.6, 0.6, y - 0.6, y + 0.6, 0.6, 6.0, 'Slate')
        m.box(-0.7, 0.7, y - 0.7, y + 0.7, 6.0, 6.4, 'Gold')
    m.box(-0.65, 0.65, -4.6, 4.6, 6.4, 7.3, 'Slate')
    m.box(-0.7, 0.7, -4.7, 4.7, 7.3, 7.5, 'Gold')
    m.lathe([(0.0, 7.5), (0.5, 7.9), (0.0, 8.7)], 4, 'Crystal')
    return m.finish()


def shrine_mesh():
    m = Mesh('shrine')
    m.box(-4.4, 4.4, -4.4, 4.4, -0.4, 0.2, 'Limestone')
    for (x, y) in ((-3.4, 3.4), (3.4, 3.4), (-3.4, -3.4), (3.4, -3.4)):
        m.lathe([(0.65, 0.2), (0.55, 5.0)], 8, 'Limestone', center=(x, y, 0))
        m.lathe([(0.75, 5.0), (0.75, 5.3)], 8, 'Gold', center=(x, y, 0))
    m.box(-3.8, 3.8, -3.85, -2.95, 0.2, 4.6, 'Slate')
    m.box(-4.3, 4.3, -4.3, 4.3, 5.3, 5.8, 'SlateDark')
    m.lathe([(4.2, 5.8), (0.0, 8.2)], 4, 'Slate', twist=0.0)
    m.lathe([(0.0, 8.2), (0.35, 8.6), (0.0, 9.4)], 4, 'Gold')
    m.lathe([(0.0, 0.2), (0.6, 0.9), (0.0, 1.8)], 4, 'Amber', center=(0, -1.6, 0))
    return m.finish()


def tower_mesh():
    m = Mesh('tower_ruin')
    m.lathe([(2.6, -0.4), (2.4, 4.0)], 10, 'Slate', jitter=0.03)
    m.lathe([(2.45, 4.0), (2.45, 4.35)], 10, 'Gold')
    m.lathe([(2.3, 4.35), (2.2, 8.0)], 10, 'Slate', jitter=0.08, seed=3)
    m.lathe([(2.2, 8.0), (1.6, 9.0)], 10, 'SlateDark', jitter=0.25, seed=5, cap=True)
    return m.finish()


def statue_mesh():
    m = Mesh('statue')
    m.box(-1.1, 1.1, -1.1, 1.1, -0.3, 1.0, 'Limestone')
    m.box(-0.95, 0.95, -0.95, 0.95, 1.0, 1.15, 'Gold')
    m.lathe([(0.45, 1.15), (0.55, 2.4), (0.3, 3.0), (0.0, 3.2)], 6, 'Bronze')
    m.blob((0, 0, 3.35), (0.28, 0.28, 0.3), 'Bronze', subdiv=1)
    return m.finish()


def brazier_mesh():
    m = Mesh('brazier')
    m.lathe([(0.45, 0.0), (0.18, 0.2), (0.12, 1.1), (0.55, 1.35), (0.6, 1.55)], 8, 'Bronze')
    m.lathe([(0.0, 1.4), (0.35, 1.6), (0.0, 2.2)], 6, 'Amber')
    return m.finish()


def banner_mesh():
    m = Mesh('banner')
    m.lathe([(0.07, 0.0), (0.06, 4.2)], 6, 'Bronze')
    m.lathe([(0.12, 4.2), (0.0, 4.45)], 6, 'Gold')
    m.box(-0.03, 0.03, 0.06, 0.95, 1.6, 3.9, 'Banner')
    m.box(-0.04, 0.04, 0.3, 0.7, 2.6, 3.3, 'Gold')
    return m.finish()


def menhir_mesh(seed):
    m = Mesh(f'menhir_{seed}')
    m.lathe([(0.8, -0.3), (0.75, 0.6), (0.55, 3.8), (0.0, 4.6)], 5, 'SlateDark', jitter=0.12, seed=seed, scale_xy=(1, 0.6))
    m.lathe([(0.7, 1.8), (0.68, 2.0)], 5, 'Rune', scale_xy=(1.02, 0.63), cap=False)
    return m.finish()


def plinth_mesh(golden):
    m = Mesh('cache_plinth_gold' if golden else 'cache_plinth')
    m.lathe([(0.75, -0.2), (0.75, 0.08), (0.6, 0.14)], 8, 'Limestone')
    m.lathe([(0.45, 0.14), (0.45, 0.17)], 8, 'Gold' if golden else 'LimestoneDark')
    if golden:
        m.lathe([(0.0, 0.2), (0.18, 0.45), (0.0, 0.75)], 4, 'Amber')
    return m.finish()


def camp_ring_mesh():
    m = Mesh('camp_ring')
    for k in range(12):
        a = 2 * math.pi * k / 12
        m.blob((7.2 * math.cos(a), 7.2 * math.sin(a), 0.05), (0.45, 0.35, 0.3), 'Rock', subdiv=1, jitter=0.2, seed=k)
    m.lathe([(0.0, -0.1), (0.5, 0.2), (0.4, 0.45), (0.0, 0.5)], 6, 'Rock')
    m.lathe([(0.0, 0.4), (0.3, 0.7), (0.0, 1.2)], 4, 'Amber')
    return m.finish()


def ring_mesh(name, inner, outer, mat):
    m = Mesh(name)
    m.lathe([(outer, 0.02), (inner, 0.03)], 48, mat, cap=False)
    return m.finish()


def cliff_rock_mesh(seed):
    m = Mesh(f'cliff_rock_{seed}')
    m.lathe([(1.0, -0.2), (1.05, 0.5), (0.85, 0.92), (0.0, 1.05)], 6, 'Rock', jitter=0.22, seed=seed, scale_xy=(1.3, 0.75))
    m.lathe([(0.7, 0.85), (0.0, 1.08)], 6, 'Moss', jitter=0.2, seed=seed + 1, scale_xy=(1.2, 0.7))
    return m.finish()


def lily_mesh():
    m = Mesh('lily')
    m.lathe([(0.0, 0.0), (0.55, 0.0)], 10, 'Lily', cap=False)
    m.blob((0.15, 0.1, 0.05), (0.09, 0.09, 0.07), 'FlowerWhite', subdiv=1)
    return m.finish()


def pebbles_mesh(seed, mat='Rock'):
    m = Mesh(f'pebbles_{seed}')
    rng = np.random.default_rng(seed)
    for k in range(5):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0, 0.6)
        r = rng.uniform(0.12, 0.28)
        m.blob((d * math.cos(a), d * math.sin(a), 0.0), (r, r * 0.8, r * 0.55), mat, subdiv=1, jitter=0.2, seed=seed + k)
    return m.finish()


def undergrowth_mesh(seed):
    m = Mesh(f'undergrowth_{seed}')
    rng = np.random.default_rng(seed)
    for k in range(4):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0, 0.8)
        m.blob((d * math.cos(a), d * math.sin(a), 0.3), (0.9, 0.9, 0.6), 'Undergrowth', subdiv=1, jitter=0.15, seed=seed + k)
    return m.finish()


class Library:
    """One mesh per prop kind and variant, built on first use."""

    def __init__(self):
        self.meshes = {}

    def get(self, kind, variant=0):
        v = variant % 3
        key = f'{kind}:{v}'
        if key in self.meshes:
            return self.meshes[key]
        me = self.build(kind, v)
        self.meshes[key] = me
        return me

    def build(self, kind, v):
        if kind in ('cypress',):
            return cypress_mesh(f'cypress_{v}', 11 + v, leaf='Cypress' if v != 2 else 'CypressLight')
        if kind == 'cypress_fruit':
            return cypress_mesh(f'cypress_fruit_{v}', 21 + v, fruit=True)
        if kind == 'elder_cypress':
            return cypress_mesh('elder_cypress', 31, fruit=True, leaf='CypressLight')
        if kind == 'round_tree':
            return round_tree_mesh(f'round_tree_{v}', 41 + v)
        if kind in ('rock', 'boulder', 'border_rock', 'rubble_stone'):
            tall = {'rock': 1.0, 'boulder': 0.9, 'border_rock': 1.3, 'rubble_stone': 0.7}[kind]
            mat = 'LimestoneDark' if kind == 'rubble_stone' else 'Rock'
            return rock_mesh(f'{kind}_{v}', 51 + v * 7 + len(kind), tall, mat)
        if kind == 'bush':
            return bush_mesh(f'bush_{v}', 61 + v)
        if kind == 'grass':
            return tuft_mesh(f'grass_{v}', 71 + v, 'Grass', blades=7, height=0.45, spread=0.22)
        if kind == 'tallgrass':
            return tuft_mesh(f'tallgrass_{v}', 81 + v, 'TallGrass', blades=9, height=0.85, spread=0.3, width=0.04)
        if kind == 'flowers':
            heads = ['FlowerBlue', 'FlowerWhite', 'FlowerGold'][v]
            return tuft_mesh(f'flowers_{v}', 91 + v, 'Grass', blades=6, height=0.4, spread=0.2, heads=heads)
        if kind == 'fern':
            return tuft_mesh(f'fern_{v}', 101 + v, 'Fern', blades=8, height=0.35, spread=0.6, width=0.12)
        if kind == 'reeds':
            return tuft_mesh(f'reeds_{v}', 111 + v, 'Reed', blades=9, height=1.3, spread=0.15, width=0.03, heads='Bark')
        if kind == 'lily':
            return lily_mesh()
        if kind == 'pebbles':
            return pebbles_mesh(121 + v)
        if kind == 'undergrowth':
            return undergrowth_mesh(131 + v)
        if kind == 'pillar':
            return pillar_mesh(f'pillar_{v}', stone='Limestone' if v != 1 else 'LimestoneDark')
        if kind == 'pillar_broken':
            return pillar_mesh(f'pillar_broken_{v}', broken=True, seed=v)
        if kind == 'menhir':
            return menhir_mesh(141 + v)
        if kind == 'wall':
            return wall_mesh('wall')
        if kind == 'wall_low':
            return wall_mesh('wall_low', low=True)
        if kind == 'spire':
            return spire_mesh()
        if kind == 'monolith':
            return monolith_mesh()
        if kind == 'beacon':
            return beacon_mesh()
        if kind == 'pad':
            return pad_mesh()
        if kind == 'gate_arch':
            return gate_mesh()
        if kind == 'shrine':
            return shrine_mesh()
        if kind == 'tower_ruin':
            return tower_mesh()
        if kind == 'statue':
            return statue_mesh()
        if kind == 'brazier':
            return brazier_mesh()
        if kind == 'banner':
            return banner_mesh()
        if kind == 'cache_plinth':
            return plinth_mesh(False)
        if kind == 'cache_plinth_gold':
            return plinth_mesh(True)
        if kind == 'camp_ring':
            return camp_ring_mesh()
        if kind == 'arena_ring':
            return ring_mesh('arena_ring', 0.97, 1.0, 'Gold')
        if kind == 'cliff_rock':
            return cliff_rock_mesh(151 + v)
        raise KeyError(kind)


# ---- placing the props ----------------------------------------------------------


class Placer:
    def __init__(self, lib):
        self.lib = lib
        self.collections = {}
        self.count = 0

    def put(self, kind, variant, matrix, group=None):
        me = self.lib.get(kind, variant)
        name = group or kind
        coll = self.collections.get(name)
        if coll is None:
            coll = bpy.data.collections.new(f'props_{name}')
            bpy.context.scene.collection.children.link(coll)
            self.collections[name] = coll
        obj = bpy.data.objects.new(f'{kind}', me)
        obj.matrix_world = matrix
        coll.objects.link(obj)
        self.count += 1
        return obj


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1.0))


TREE_HEIGHT = 7.5


def place_props(scene, lib, tex):
    P = Placer(lib)
    level = scene['waterLevel']
    for p in scene['props']:
        k = p['kind']
        v = p.get('variant', 0)
        fwd = p.get('forward')
        base = placement(p['at'], p['h'], fwd)
        s = p.get('scale', 1)
        if k in ('cypress', 'cypress_fruit', 'round_tree'):
            hgt = p.get('height')
            zs = (hgt / TREE_HEIGHT) if hgt and k != 'round_tree' else s
            P.put(k, v, base @ S(s, s, zs if p.get('blocks') else s))
        elif k == 'elder_cypress':
            P.put(k, 0, base @ S(2.1, 2.1, 2.3))
        elif k in ('rock', 'boulder', 'border_rock', 'menhir'):
            if p.get('blocks'):
                r = p['r']
                hgt = p['height']
                if k == 'menhir':
                    P.put(k, v, base @ S(r / 0.75, r / 0.75, hgt / 4.6))
                else:
                    P.put(k, v, base @ S(r * 1.05, r * 1.05, hgt))
            else:
                P.put(k, v, base @ S(s, s, s * 0.8))
        elif k in ('pillar', 'pillar_broken'):
            r = p['r']
            P.put(k, v, base @ S(r / 0.82, r / 0.82, p['height'] / (1.0 if k == 'pillar' else 0.55 / 0.55)))
        elif k in ('spire', 'monolith', 'beacon', 'tower_ruin', 'statue', 'brazier'):
            P.put(k, 0, base)
        elif k == 'lily':
            P.put(k, v, placement(p['at'], level + 0.02, fwd) @ S(s, s, 1))
        elif k == 'banner':
            P.put(k, v, base)
        elif k in ('rubble_stone',):
            P.put(k, v, base @ S(s, s, s * 0.7))
        else:
            P.put(k, v, base @ S(s, s, s))
    for w in scene['walls']:
        m = placement(w['at'], w['h'], w['forward'])
        P.put(w['kind'], 0, m @ S(w['thickness'], w['length'], w['height']))
    for g in scene['gates']:
        P.put('gate_arch', 0, placement(g['at'], g['h'], g['forward']))
    for sh in scene['shrines']:
        P.put('shrine', 0, placement(sh['at'], sh['h'], sh['forward']))
    for pad in scene['pads']:
        P.put('pad', 0, placement(pad['at'], pad['h'], pad['forward']))
    for c in scene['caches']:
        P.put('cache_plinth_gold' if c['golden'] else 'cache_plinth', 0, placement(c['at'], c['h']))
    for c in scene['camps']:
        P.put('camp_ring', 0, placement(c['at'], c['h']))
    for a in scene['arenas']:
        P.put('arena_ring', 0, placement(a['at'], a['h'] + 0.02) @ S(a['r'], a['r'], 1))
        P.put('arena_ring', 0, placement(a['at'], a['h'] + 0.02) @ S(a['r'] * 0.55, a['r'] * 0.55, 1))
    for b in scene['bushes']:
        r = b['r']
        P.put('bush', b.get('variant', 0), placement(b['at'], b['h'] - 0.1, None, yaw=r * 7.0) @ S(r, r, 1.0 + 0.12 * r))
    log(f'placed {P.count} props in {len(P.collections)} kinds')
    return P


# ---- unique pieces: halls, hedges, bridges, ramps, cliff dressing ---------------


def sample_height(heights, scene, d):
    """Bilinear ground height of the render terrain at sim direction d."""
    R = scene['radius']
    M = scene['terrain']['meshCellsPerFace']
    x, y, z = d
    ax, ay, az = abs(x), abs(y), abs(z)
    if ax >= ay and ax >= az:
        f = 0 if x >= 0 else 1
    elif ay >= az:
        f = 2 if y >= 0 else 3
    else:
        f = 4 if z >= 0 else 5
    N, U, V = (np.array(a) for a in FACES[f])
    dv = np.array(d)
    pn = dv @ N
    u = (dv @ U) / pn
    v = (dv @ V) / pn
    fa = (u + 1) / 2 * M
    fb = (v + 1) / 2 * M
    a0 = min(M - 1, max(0, int(math.floor(fa))))
    b0 = min(M - 1, max(0, int(math.floor(fb))))
    ta = min(1, max(0, fa - a0))
    tb = min(1, max(0, fb - b0))
    h = heights[f]
    return float((h[b0, a0] * (1 - ta) + h[b0, a0 + 1] * ta) * (1 - tb) + (h[b0 + 1, a0] * (1 - ta) + h[b0 + 1, a0 + 1] * ta) * tb)


def unit(p):
    v = np.array([p['x'], p['y'], p['z']], dtype=np.float64)
    return v / np.linalg.norm(v)


def slerp_np(a, b, t):
    om = math.acos(max(-1.0, min(1.0, float(a @ b))))
    if om < 1e-9:
        return a
    return (math.sin((1 - t) * om) * a + math.sin(t * om) * b) / math.sin(om)


def to_bl_point(d, radius):
    return Vector((d[0] * radius, -d[2] * radius, d[1] * radius))


def build_unique(scene, heights, tex):
    R = scene['radius']
    objs = []
    # Halls: solid buildings with the Star Orchard's painted facades.
    for m in scene['masses']:
        if m['kind'] != 'hall':
            continue
        b = m['box']
        mesh = Mesh('hall')
        a, w, hh = b['a'], b['b'], m['height']
        mesh.box(-w, w, -a, a, -1.2, hh, 'Facade', uv_scale=(3.0, hh + 1.2))
        mesh.box(-w - 0.25, w + 0.25, -a - 0.25, a + 0.25, hh, hh + 0.4, 'Gold')
        mesh.box(-w + 0.4, w - 0.4, -a + 0.4, a - 0.4, hh + 0.4, hh + 0.9, 'SlateDark')
        mesh.box(-w * 0.5, w * 0.5, -a * 0.6, a * 0.6, hh + 0.9, hh + 2.6, 'Slate')
        me = mesh.finish()
        me.materials[mesh.slots.index('Facade')] = material('Facade', tex)
        o = bpy.data.objects.new('hall', me)
        o.matrix_world = placement(m['center'], m['h'], b['forward'])
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
    # Hedges: their outline, raised.
    for m in scene['masses']:
        if m['kind'] != 'hedge':
            continue
        bm = bmesh.new()
        ring_lo, ring_hi = [], []
        for q in m['outline']:
            d = unit(q)
            ring_lo.append(bm.verts.new(to_bl_point(d, R + q['h'] - 0.3)))
            ring_hi.append(bm.verts.new(to_bl_point(d, R + q['h'] + m['height'])))
        n = len(ring_lo)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((ring_lo[i], ring_lo[j], ring_hi[j], ring_hi[i]))
        bm.faces.new(ring_hi)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new('hedge')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material('Hedge'))
        o = bpy.data.objects.new('hedge', me)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
    # Bridges: a deck from shore to shore, railings with gold posts.
    for b in scene['bridges']:
        A, B = unit(b['a']), unit(b['b'])
        steps = max(4, int(b['length'] / 0.8))
        bm = bmesh.new()
        width = b['width'] / 2 + 0.35
        side_prev = None
        rows = []
        for k in range(steps + 1):
            t = k / steps
            d = slerp_np(A, B, t)
            h = b['h0'] + (b['h1'] - b['h0']) * t + b['arch'] * 4 * t * (1 - t)
            ahead = slerp_np(A, B, min(1, t + 0.01)) - slerp_np(A, B, max(0, t - 0.01))
            side = np.cross(d, ahead)
            side /= np.linalg.norm(side)
            pts = []
            for (off, dz) in ((-width, 0.12), (width, 0.12), (width, -0.45), (-width, -0.45)):
                q = d + side * (off / R)
                q /= np.linalg.norm(q)
                pts.append(bm.verts.new(to_bl_point(q, R + h + dz)))
            rows.append((pts, d, side, h))
        for (p0, *_), (p1, *_) in zip(rows, rows[1:]):
            for i in range(4):
                j = (i + 1) % 4
                bm.faces.new((p0[i], p1[i], p1[j], p0[j]))
        bm.faces.new(rows[0][0][::-1])
        bm.faces.new(rows[-1][0])
        me = bpy.data.meshes.new('bridge')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material('LimestoneDark'))
        o = bpy.data.objects.new('bridge', me)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
        # Railings.
        rail = Mesh('bridge_rail')
        for k, (pts, d, side, h) in enumerate(rows):
            for sgn in (-1, 1):
                q = d + side * (sgn * (width - 0.12) / R)
                q /= np.linalg.norm(q)
                base = to_bl_point(q, R + h + 0.1)
                if k % 3 == 0:
                    rail.lathe([(0.11, 0.0), (0.11, 1.0), (0.0, 1.15)], 4, 'Gold', center=tuple(base))
        for sgn in (-1, 1):
            for (pa, da, sa, ha), (pb, db, sb, hb) in zip(rows, rows[1:]):
                qa = da + sa * (sgn * (width - 0.12) / R)
                qb = db + sb * (sgn * (width - 0.12) / R)
                qa /= np.linalg.norm(qa)
                qb /= np.linalg.norm(qb)
                va = [rail.bm.verts.new(to_bl_point(qa, R + ha + z)) for z in (0.8, 0.95)]
                vb = [rail.bm.verts.new(to_bl_point(qb, R + hb + z)) for z in (0.8, 0.95)]
                f = rail.bm.faces.new((va[0], vb[0], vb[1], va[1]))
                rail._faces([f], 'Slate')
        me = rail.finish()
        o = bpy.data.objects.new('bridge_rail', me)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
    # Ramps: a balustrade of stone posts with gold caps along both sides,
    # stepping up from foot to head.
    for r in scene['ramps']:
        A, B = unit(r['a']), unit(r['b'])
        L = R * math.acos(max(-1, min(1, float(A @ B))))
        steps = max(3, int(L / 1.3))
        posts = Mesh('ramp_posts')
        side = np.cross(slerp_np(A, B, 0.5), B - A)
        side /= np.linalg.norm(side)
        for k in range(steps + 1):
            t = k / steps
            d = slerp_np(A, B, t)
            hr = r['bottom'] + (r['top'] - r['bottom']) * t
            for sgn in (-1, 1):
                q = d + side * (sgn * (r['width'] / 2 + 0.25) / R)
                q /= np.linalg.norm(q)
                lo = min(hr, sample_height(heights, scene, q)) - 0.3
                base = to_bl_point(q, R + lo)
                up = base.normalized()
                h = hr + 0.75 - lo
                n0 = len(posts.bm.verts)
                posts.lathe([(0.3, 0.0), (0.3, h), (0.36, h), (0.36, h + 0.18), (0.0, h + 0.3)], 4, 'Limestone', center=(0, 0, 0))
                # Stand the post on the sphere's normal at its foot.
                posts.bm.verts.ensure_lookup_table()
                vs = [posts.bm.verts[i] for i in range(n0, len(posts.bm.verts))]
                rot = up.to_track_quat('Z', 'Y').to_matrix()
                for v in vs:
                    v.co = base + rot @ v.co
        me = posts.finish()
        o = bpy.data.objects.new('ramp_posts', me)
        bpy.context.scene.collection.objects.link(o)
        objs.append(o)
    return objs


def place_cliff_rocks(scene, heights, P):
    """Rock slabs along every plateau rim, off the ramps."""
    R = scene['radius']
    ramps = [(unit(r['a']), unit(r['b']), r['width']) for r in scene['ramps']]
    for c in scene['cliffs']:
        center = unit(c['center'])
        pts = c['outline']
        for k in range(0, len(pts), 2):
            q = pts[k]
            d = unit(q)
            near_ramp = False
            for (A, B, w) in ramps:
                m = slerp_np(A, B, 0.5)
                if R * math.acos(max(-1, min(1, float(m @ d)))) < w / 2 + 6.5:
                    near_ramp = True
            if near_ramp:
                continue
            out = d - center
            out = out - d * float(out @ d)
            out /= np.linalg.norm(out)
            outside = d + out * (1.4 / R)
            outside /= np.linalg.norm(outside)
            low = sample_height(heights, scene, outside)
            top = c['top']
            hgt = max(1.0, top - low + 0.35)
            fwd = {'x': float(out[0]), 'y': float(out[1]), 'z': float(out[2])}
            at = {'x': d[0] * R, 'y': d[1] * R, 'z': d[2] * R}
            m = placement(at, low - 0.2, fwd)
            P.put('cliff_rock', k, m @ S(1.5, 1.2, hgt))


# ---- previews --------------------------------------------------------------------


def preview_world():
    world = bpy.data.worlds.new('Space')
    bpy.context.scene.world = world
    G = Nodes(world)
    out = G.new('ShaderNodeOutputWorld')
    bg = G.new('ShaderNodeBackground')
    coord = G.new('ShaderNodeTexCoord').outputs['Generated']
    stars = G.voronoi(coord, 900.0)
    star = G.math('LESS_THAN', stars, 0.035)
    neb = G.noise(coord, 3.0, 6, 0.6)
    sky = G.mix(G.rgb('#03050c'), G.rgb('#0d1630'), G.smooth(neb, 0.45, 0.8))
    col = G.mix(sky, G.rgb('#ffffff'), G.math('MULTIPLY', star, 0.9))
    G.link(col, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    G.link(bg.outputs[0], out.inputs[0])
    # A soft fill so the night side still reads.
    return world


def add_sun(direction, strength=4.0, color='#fff1d6', name='Sun'):
    d = Vector(direction).normalized()
    light = bpy.data.lights.new(name, 'SUN')
    light.energy = strength
    light.color = srgb(color)
    light.angle = math.radians(2.5)
    obj = bpy.data.objects.new(name, light)
    obj.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(obj)
    return obj


def camera_at(name, eye, target, up=None, lens=35):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.clip_start = 0.5
    cam.clip_end = 2000
    obj = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(obj)
    eye = Vector(eye)
    fwd = (Vector(target) - eye).normalized()
    up = Vector(up) if up is not None else Vector((0, 0, 1))
    right = fwd.cross(up).normalized()
    true_up = right.cross(fwd).normalized()
    m = Matrix((
        (right.x, true_up.x, -fwd.x, eye.x),
        (right.y, true_up.y, -fwd.y, eye.y),
        (right.z, true_up.z, -fwd.z, eye.z),
        (0, 0, 0, 1),
    ))
    obj.matrix_world = m
    return obj


def game_view(scene, heights_fn, at, heading, name):
    """The in-game camera: 18 m above the ground, looking down at 55
    degrees along `heading` (a sim tangent at `at`)."""
    p = bl(at).normalized()
    t = bl(heading)
    t = (t - p * t.dot(p)).normalized()
    R = scene['radius']
    ground = R + heights_fn(at)
    target = p * ground
    back = 18 / math.tan(math.radians(55))
    eye = target + p * 18 - t * back
    cam = camera_at(name, eye, target, up=p, lens=24 * math.tan(math.radians(25)) / math.tan(math.radians(25)) * 1.0)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24
    cam.data.lens = 12 / math.tan(math.radians(25))
    return cam


# The build box also serves the game: Cycles stays on a few threads.
RENDER_THREADS = 3


def limit_threads():
    sc = bpy.context.scene
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = RENDER_THREADS


def render(path, cam, samples, res=(960, 540)):
    sc = bpy.context.scene
    limit_threads()
    sc.camera = cam
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.cycles.transparent_max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    log(f'rendered {os.path.basename(path)} in {time.time() - t0:.1f} s')


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o.type == 'MESH')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        use_selection=True,
        export_cameras=False,
        export_lights=False,
        export_vertex_color='NONE',
        export_image_format='WEBP',
        export_materials='EXPORT',
        export_apply=False,
    )


def gltf_transform(*argv):
    import subprocess
    env = dict(os.environ)
    env['PATH'] = '/opt/node22/bin:' + env.get('PATH', '')
    cmd = ['pnpm', 'dlx', '@gltf-transform/cli', *argv]
    r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'gltf-transform {argv[0]} failed: {r.stderr[-2000:]}')


def compress(raw, out_full, out_light):
    """GPU instances for the repeated props, WebP textures, meshopt
    geometry; the light model caps every texture at 384 pixels."""
    a = os.path.join(BUILD_DIR, 'instanced.glb')
    b = os.path.join(BUILD_DIR, 'webp.glb')
    gltf_transform('instance', raw, a, '--min', '2')
    gltf_transform('webp', a, b, '--quality', '78')
    gltf_transform('meshopt', b, out_full, '--level', 'medium')
    c = os.path.join(BUILD_DIR, 'light-resized.glb')
    d = os.path.join(BUILD_DIR, 'light-webp.glb')
    gltf_transform('resize', a, c, '--width', '384', '--height', '384')
    gltf_transform('webp', c, d, '--quality', '75')
    gltf_transform('meshopt', d, out_light, '--level', 'medium')
    for f in (a, b, c, d):
        os.remove(f)


def nav_check(scene, heights, nav):
    """How far the mesh's ground sits from the grid's heights where
    champions walk (the renderer lifts them by the grid). Bridge decks are
    left out: there the grid carries the deck, the mesh the lake bed."""
    R = scene['radius']
    decks = [(slerp_np(unit(b['a']), unit(b['b']), 0.5), b['length'] / 2 + 1.5) for b in scene['bridges']]
    n = nav.shape[1]
    rng = np.random.default_rng(1)
    worst = 0.0
    total = 0.0
    count = 0
    for _ in range(20000):
        f = int(rng.integers(6))
        i = int(rng.integers(n))
        j = int(rng.integers(n))
        h = nav[f, j, i]
        if h == -32768:
            continue
        N, U, V = (np.array(a, dtype=np.float64) for a in FACES[f])
        u = (2 * i + 1) / n - 1
        v = (2 * j + 1) / n - 1
        d = N + u * U + v * V
        d /= np.linalg.norm(d)
        if any(R * math.acos(max(-1.0, min(1.0, float(m @ d)))) < reach for (m, reach) in decks):
            continue
        diff = abs(sample_height(heights, scene, d) - h * 0.001)
        worst = max(worst, diff)
        total += diff
        count += 1
    return total / max(1, count), worst


def main():
    opts = args()
    t_start = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene, heights, paint, nav, digest = load_scene()
    log('scene', digest, 'props', len(scene['props']))
    tex = tile_textures()
    bake_ground(scene, heights, paint, digest, tex, opts['bake'])
    build_water(scene, heights)
    mean, worst = nav_check(scene, heights, nav)
    log(f'ground vs grid heights on walkable cells: mean {mean:.3f} m, worst {worst:.3f} m')
    lib = Library()
    P = place_props(scene, lib, tex)
    place_cliff_rocks(scene, heights, P)
    build_unique(scene, heights, tex)
    log(f'model built at {time.time() - t_start:.1f} s, {len(lib.meshes)} prop meshes, {P.count} placements')
    if opts['export']:
        raw = os.path.join(BUILD_DIR, 'planet-raw.glb')
        export_glb(raw)
        log(f'exported raw {os.path.getsize(raw) / 1e6:.1f} MB at {time.time() - t_start:.1f} s')
        full = os.path.join(OUT_DIR, 'planet.glb')
        light = os.path.join(OUT_DIR, 'planet-light.glb')
        compress(raw, full, light)
        log(f'planet.glb {os.path.getsize(full) / 1e6:.2f} MB, planet-light.glb {os.path.getsize(light) / 1e6:.2f} MB at {time.time() - t_start:.1f} s')
    if opts['previews']:
        render_previews(scene, heights, opts)
    log(f'done in {time.time() - t_start:.1f} s')


def render_previews(scene, heights, opts):
    os.makedirs(opts['previews'], exist_ok=True)
    preview_world()
    sides = {
        'globe_lakes': (0.25, 0.4, 1.0),
        'globe_ruins': (1.0, 0.4, -0.25),
        'globe_cliffs': (-0.25, -0.35, -1.0),
        'globe_groves': (-1.0, -0.35, 0.25),
    }
    want = opts['views']
    for name, d in sides.items():
        if want not in ('all', 'globe', name):
            continue
        dv = np.array(d, dtype=np.float64)
        dv /= np.linalg.norm(dv)
        eye = bl(tuple(dv * 430))
        cam = camera_at(name, eye, (0, 0, 0), up=(0, 0, 1), lens=50)
        key = dv + np.array([0.3, 0.45, 0.2])
        sun = add_sun(bl(tuple(key / np.linalg.norm(key))), 4.2)
        fill = add_sun(bl(tuple(-key / np.linalg.norm(key))), 1.4, '#8fa8ff', 'Fill')
        render(os.path.join(opts['previews'], f'{name}.png'), cam, opts['samples'])
        bpy.data.objects.remove(sun)
        bpy.data.objects.remove(fill)
    R = scene['radius']
    arenas = {a['id']: a for a in scene['arenas']}

    def pnt(d):
        return {'x': float(d[0]) * R, 'y': float(d[1]) * R, 'z': float(d[2]) * R}

    def offset(at, toward, meters):
        a = unit(at)
        b = unit(toward)
        return slerp_np(a, b, meters / (R * math.acos(max(-1, min(1, float(a @ b))))))

    views = []
    north = {'x': 0, 'y': R, 'z': 0}
    w = arenas['warden']['at']
    views.append(('view_sanctuary', pnt(offset(w, north, 4)), north))
    pf = arenas['pyrefang']['at']
    ruins_look = pnt(unit(pf) + np.array([0, 0.25, -0.25]))
    views.append(('view_ruins', pnt(offset(pf, ruins_look, 14)), pf))
    groves_camp = [c for c in scene['camps'] if unit(c['at'])[0] < -0.6][0]
    views.append(('view_groves', groves_camp['at'], {'x': -R, 'y': 0, 'z': 0}))
    br = scene['bridges'][0]
    mid = slerp_np(unit(br['a']), unit(br['b']), 0.5)
    views.append(('view_lakes', pnt(mid), br['b']))
    ramp = scene['ramps'][4]
    views.append(('view_cliffs', pnt(slerp_np(unit(ramp['a']), unit(ramp['b']), 0.3)), ramp['b']))
    for name, at, toward in views:
        if want not in ('all', 'views', name):
            continue
        d = unit(at)
        t = unit(toward) - d * float(unit(toward) @ d)
        t /= np.linalg.norm(t)
        h = sample_height(heights, scene, d)
        heading = {'x': float(t[0]), 'y': float(t[1]), 'z': float(t[2])}
        cam = game_view(scene, lambda _a, hh=h: hh, at, heading, name)
        sun_dir = d * 1.0 + t * 0.35 + np.cross(d, t) * 0.5
        sun = add_sun(bl(tuple(sun_dir / np.linalg.norm(sun_dir))), 4.0)
        render(os.path.join(opts['previews'], f'{name}.png'), cam, opts['samples'])
        bpy.data.objects.remove(sun)


if __name__ == '__main__':
    main()

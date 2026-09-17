"""Elowen's spell effects, modelled in Blender by script: layered translucent
mist geometry with turbulent alpha textures, morph poses for growth and a
preview animation per spell. One scene per spell and one for the auto (FX A, FX Q, FX W, FX E, FX R),
everything centred on the origin in source units (she stands 1 m), saved
into art_src/models_raw/elowen/elowen_v2_segmented.blend beside her rig;
scripts/export_elowen_effects.py ships them.

Run inside Blender with the source file open (the Python console or a text
block), or headless to rebuild and save:
  blender -b art_src/models_raw/elowen/elowen_v2_segmented.blend     --python scripts/build_elowen_effects.py -- --save [--preview] [--only=A,E]
Previews (mp4 next to the blend, frames under .tmp/) need ffmpeg on PATH.
"""
import math
import os
import random
import subprocess

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRATCH = os.environ.get('ELOWEN_FX_FRAMES', os.path.join(ROOT, '.tmp', 'elowen-fx'))
PREVIEW_DIR = os.path.join(ROOT, 'art_src', 'models_raw', 'elowen')
SCALE = 3.98  # world units per source metre (manifest height 4.2 over 1.055)
PALE = (0.58, 0.82, 1.0)
DEEP = (0.32, 0.62, 1.0)
WHITE = (0.93, 0.98, 1.0)
FPS = 24


# ------------------------------------------------------------ textures
def make_image(name, w, h, fn):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(u, v)
    a = np.clip(fn(U, V), 0, 1)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., 3] = a
    img.pixels = px.ravel().tolist()
    img.pack()
    return img


def value_noise(w, h, cells_u, cells_v, seed, octaves=4, stretch=1.0):
    """Tileable fractal value noise in [0,1], stretched along U."""
    rng = np.random.RandomState(seed)
    out = np.zeros((h, w))
    amp = 1.0
    total = 0.0
    cu, cv = cells_u, cells_v
    for _ in range(octaves):
        g = rng.rand(int(cv) + 1, int(cu) + 1)
        g[:, -1] = g[:, 0]
        g[-1, :] = g[0, :]
        ys = np.linspace(0, cv, h, endpoint=False)
        xs = np.linspace(0, cu, w, endpoint=False)
        X, Y = np.meshgrid(xs, ys)
        x0 = np.floor(X).astype(int); y0 = np.floor(Y).astype(int)
        fx = X - x0; fy = Y - y0
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
        a = g[y0, x0]; b = g[y0, x0 + 1]; c = g[y0 + 1, x0]; d = g[y0 + 1, x0 + 1]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy)
        total += amp
        amp *= 0.5
        cu *= 2
        cv *= 2
    return out / total


def textures(reuse=True):
    """The three alpha images; the packed ones are kept when present, the
    other scenes' materials hold them."""
    names = ('elowen_mist_ribbon', 'elowen_mist_soft', 'elowen_mist_veil')
    if reuse and all(bpy.data.images.get(n) for n in names):
        return tuple(bpy.data.images[n] for n in names)
    w, h = 512, 128
    n1 = value_noise(w, h, 6, 2, 11)
    n2 = value_noise(w, h, 14, 3, 5)
    U = (np.arange(w) + 0.5) / w
    V = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(U, V)
    # A ribbon: soft ends and edges, filaments streaked along its length,
    # a brighter spine near the middle.
    def ribbon(UU, VV):
        edge = np.sin(np.pi * UU) ** 0.7 * np.sin(np.pi * VV) ** 0.9
        wisp = np.clip((n1 - 0.35) * 2.2, 0, 1) * 0.7 + np.clip((n2 - 0.4) * 2.5, 0, 1) * 0.5
        spine = np.exp(-((VV - 0.5) ** 2) * 18) * 0.5
        return edge * np.clip(wisp + spine, 0, 1)
    rib = make_image('elowen_mist_ribbon', w, h, ribbon)
    # A soft puff: radial falloff eaten by turbulence.
    ns = value_noise(256, 256, 4, 4, 3)
    def puff(UU, VV):
        r = np.hypot(UU - 0.5, VV - 0.5) * 2
        return np.clip(1 - r, 0, 1) ** 1.4 * (0.45 + 0.55 * np.clip((ns - 0.3) * 2, 0, 1))
    soft = make_image('elowen_mist_soft', 256, 256, puff)
    # A veil: dense luminous foot, tattered rising streaks, a soft top.
    nv1 = value_noise(w, h, 10, 2, 21, stretch=3)
    nv2 = value_noise(w, h, 24, 4, 8)
    def veil(UU, VV):
        foot = (1 - VV) ** 1.3
        streak = np.clip((nv1 - 0.3) * 2.4, 0, 1) * (0.5 + 0.5 * np.clip((nv2 - 0.35) * 2, 0, 1))
        top = np.clip(1 - (VV - 0.55) / 0.45, 0, 1)
        return np.clip(foot * 0.55 + streak * 0.75, 0, 1) * top * np.sin(np.pi * np.clip(VV, 0.02, 1)) ** 0.25
    veil_img = make_image('elowen_mist_veil', w, h, veil)
    return rib, soft, veil_img


def mist_material(name, color, strength, image, alpha=1.0, additive=False):
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = alpha
    nt.links.new(tex.outputs['Alpha'], mul.inputs[0])
    nt.links.new(mul.outputs[0], bsdf.inputs['Alpha'])
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = strength * 0.35
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    try:
        mat.surface_render_method = 'BLENDED'
    except Exception:
        mat.blend_method = 'BLEND'
    mat.use_backface_culling = False
    mat['additive'] = additive
    mat.diffuse_color = (*color, alpha)
    return mat


# ------------------------------------------------------------ geometry
def ribbon_points(fn, n):
    """fn(s) -> (Vector position, half width) for s in [0,1]."""
    return [fn(i / (n - 1)) for i in range(n)]


def ribbon_mesh(name, poses, up_fn=None):
    """A strip through several poses: poses[k] is a list of (point, half
    width) with identical length; the first is the Basis, the rest become
    Pose_00.. shape keys. Width runs across a direction perpendicular to the
    tangent: up_fn(point, tangent) or a vertical-leaning default."""
    n = len(poses[0])
    verts = []
    faces = []
    uvs = []

    def build(pose):
        out = []
        for i, (p, hw) in enumerate(pose):
            p0 = pose[max(0, i - 1)][0]
            p1 = pose[min(n - 1, i + 1)][0]
            tan = (p1 - p0)
            if tan.length < 1e-9:
                tan = Vector((0, 0, 1))
            tan.normalize()
            if up_fn:
                w = up_fn(p, tan)
            else:
                radial = Vector((p.x, p.y, 0))
                w = tan.cross(radial) if radial.length > 1e-6 else tan.cross(Vector((1, 0, 0)))
                if w.length < 1e-6:
                    w = Vector((0, 0, 1))
            w.normalize()
            out.append(p - w * hw)
            out.append(p + w * hw)
        return out

    verts = build(poses[0])
    for i in range(n - 1):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    for i in range(n):
        uvs.append((i / (n - 1), 0.0))
        uvs.append((i / (n - 1), 1.0))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = uvs[vi]
    ob = bpy.data.objects.new(name, me)
    if len(poses) > 1:
        ob.shape_key_add(name='Basis')
        for k, pose in enumerate(poses[1:]):
            key = ob.shape_key_add(name=f'Pose_{k:02d}')
            for i, co in enumerate(build(pose)):
                key.data[i].co = co
    for p in me.polygons:
        p.use_smooth = True
    return ob


def join(objs, name):
    for o in objs:
        bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def grid_mesh(name, fn, nu, nv, poses=1):
    """A parametric sheet fn(u, v, k) -> Vector, k the pose index (0 basis)."""
    def build(k):
        return [fn(i / (nu - 1), j / (nv - 1), k) for j in range(nv) for i in range(nu)]
    verts = build(0)
    faces = []
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i
            faces.append((a, a + 1, a + nu + 1, a + nu))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = ((vi % nu) / (nu - 1), (vi // nu) / (nv - 1))
    ob = bpy.data.objects.new(name, me)
    if poses > 1:
        ob.shape_key_add(name='Basis')
        for k in range(1, poses):
            key = ob.shape_key_add(name=f'Pose_{k - 1:02d}')
            for i, co in enumerate(build(k)):
                key.data[i].co = co
    for p in me.polygons:
        p.use_smooth = True
    return ob


def quads_mesh(name, centers, size, poses=None):
    """Small camera-agnostic flecks: three crossed quads per centre."""
    verts = []
    faces = []
    uvs = []
    axes = [(Vector((1, 0, 0)), Vector((0, 0, 1))), (Vector((0, 1, 0)), Vector((0, 0, 1))),
            (Vector((1, 0, 0)), Vector((0, 1, 0)))]

    def build(cs):
        out = []
        for c in cs:
            for a, b in axes:
                out += [c - a * size - b * size, c + a * size - b * size, c + a * size + b * size,
                        c - a * size + b * size]
        return out
    verts = build(centers)
    for q in range(len(verts) // 4):
        faces.append((4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 3))
        uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs[me.loops[li].vertex_index]
    ob = bpy.data.objects.new(name, me)
    if poses:
        ob.shape_key_add(name='Basis')
        for k, cs in enumerate(poses):
            key = ob.shape_key_add(name=f'Pose_{k:02d}')
            for i, co in enumerate(build(cs)):
                key.data[i].co = co
    return ob


def scene_for(name):
    sc = bpy.data.scenes.get(name)
    if sc:
        for o in list(sc.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    else:
        sc = bpy.data.scenes.new(name)
    sc.render.fps = FPS
    bpy.context.window.scene = sc
    return sc


def place(sc, ob, kind, **props):
    sc.collection.objects.link(ob)
    ob['effectKind'] = kind
    for k, v in props.items():
        ob[k] = v
    return ob


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------ Q: mist lance
def build_q(rib, soft):
    sc = scene_for('FX Q')
    m_core = mist_material('Elowen_MistCore', WHITE, 6.0, rib, 1.0, additive=True)
    m_mist = mist_material('Elowen_MistRibbon', PALE, 2.2, rib, 0.75, additive=True)
    m_sheath = mist_material('Elowen_MistSheath', DEEP, 1.2, rib, 0.45, additive=True)
    m_burst = mist_material('Elowen_MistBurst', PALE, 2.6, rib, 0.8, additive=True)
    L = 0.7
    # The core: a bright spindle along +Z (tip at +Z), a strip seen edge-on
    # from any side thanks to three crossed strips.
    cores = []
    for j in range(3):
        ang = j * math.pi / 3

        def fn(s, ang=ang):
            z = -L * 0.35 + s * L
            hw = 0.045 * math.sin(math.pi * s) ** 0.6 * (1 - 0.5 * s)
            return Vector((0, 0, z)), hw
        up = lambda p, t, ang=ang: Vector((math.cos(ang), math.sin(ang), 0))
        cores.append(ribbon_mesh(f'core{j}', [ribbon_points(fn, 24)], up))
    for c in cores:
        sc.collection.objects.link(c)
        c.data.materials.append(m_core)
    core = join(cores, 'Elowen_LanceCore')
    core['effectKind'] = 'core'
    # The mist: three helical ribbons around the core, widening toward the tail.
    ribs = []
    for j in range(3):
        ph = j * 2 * math.pi / 3

        def fn(s, ph=ph):
            z = L * 0.6 - s * L * 1.25
            r = 0.05 + 0.13 * s
            a = ph + s * 2 * math.pi * 1.6
            hw = 0.03 + 0.09 * s
            return Vector((r * math.cos(a), r * math.sin(a), z)), hw
        ribs.append(ribbon_mesh(f'rib{j}', [ribbon_points(fn, 40)]))
    for r in ribs:
        sc.collection.objects.link(r)
        r.data.materials.append(m_mist)
    mist = join(ribs, 'Elowen_LanceMist')
    mist['effectKind'] = 'spin'
    mist['spin'] = 9.0  # radians per second in the runtime
    # The sheath: a translucent trailing cone.
    def sheath(u, v, k):
        a = u * 2 * math.pi
        z = L * 0.45 - v * L * 1.3
        r = 0.02 + 0.2 * v ** 0.8
        return Vector((r * math.cos(a), r * math.sin(a), z))
    sh = grid_mesh('Elowen_LanceSheath', sheath, 20, 10)
    sc.collection.objects.link(sh)
    sh.data.materials.append(m_sheath)
    sh['effectKind'] = 'sheath'
    # The impact: eight curling petals unfurling from a point over 14 poses,
    # plus a ground wave.
    petals = []
    NP = 14
    for j in range(8):
        ang = j * 2 * math.pi / 8 + 0.2
        tilt = 0.35 + 0.25 * (j % 2)
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP)

            def fn(s, ang=ang, tilt=tilt, g=g):
                d = s * g
                r = 0.55 * d
                z = 0.12 * d + 0.25 * d * d * tilt
                sway = 0.35 * d * d
                x = r * math.cos(ang + sway)
                y = r * math.sin(ang + sway)
                hw = (0.02 + 0.11 * math.sin(math.pi * s) ** 0.8) * d * (0.3 + 0.7 * g) + 0.005
                return Vector((x, y, z)), hw
            poses.append(ribbon_points(fn, 16))
        petals.append(ribbon_mesh(f'petal{j}', poses))
    for p in petals:
        sc.collection.objects.link(p)
        p.data.materials.append(m_burst)
    burst = join(petals, 'Elowen_LanceImpact')
    burst['effectKind'] = 'burst'
    burst['poses'] = NP
    def wave(u, v, k):
        g = smooth01(k / 10) if k else 0.0
        a = u * 2 * math.pi
        r = (0.05 + 0.6 * g) * (0.75 + 0.25 * v)
        return Vector((r * math.cos(a), r * math.sin(a), 0.02 + 0.03 * v))
    wv = grid_mesh('Elowen_LanceWave', wave, 32, 3, poses=11)
    sc.collection.objects.link(wv)
    wv.data.materials.append(m_burst)
    wv['effectKind'] = 'wave'
    wv['poses'] = 10
    return sc


# ------------------------------------------------------------ W: veil
def build_w(rib, soft, veil_img):
    sc = scene_for('FX W')
    R = 3.5 / SCALE
    H = 0.9
    NP = 12
    m_outer = mist_material('Elowen_VeilOuter', PALE, 1.4, veil_img, 0.55)
    m_inner = mist_material('Elowen_VeilInner', WHITE, 1.8, veil_img, 0.35, additive=True)
    m_wisp = mist_material('Elowen_VeilWisp', WHITE, 2.4, rib, 0.7, additive=True)
    m_ground = mist_material('Elowen_VeilGround', DEEP, 1.6, soft, 0.5, additive=True)
    m_fleck = mist_material('Elowen_VeilFleck', WHITE, 4.0, soft, 0.9, additive=True)

    def dome(radius, height, ragged):
        def fn(u, v, k):
            g = smooth01(k / NP) if k else 0.0
            a = u * 2 * math.pi
            frill = 1 + ragged * 0.06 * math.sin(a * 9 + v * 4) * (1 - v)
            r = radius * frill * (0.3 + 0.7 * g) * math.sqrt(max(0.0, 1 - v * v * 0.55))
            z = height * g * v
            return Vector((r * math.cos(a), r * math.sin(a), z))
        return fn
    outer = grid_mesh('Elowen_VeilOuter', dome(R, H, 1.0), 48, 10, poses=NP + 1)
    inner = grid_mesh('Elowen_VeilInner', dome(R * 0.8, H * 0.85, 1.0), 40, 10, poses=NP + 1)
    for ob, m, spin in ((outer, m_outer, 0.18), (inner, m_inner, -0.3)):
        sc.collection.objects.link(ob)
        ob.data.materials.append(m)
        ob['effectKind'] = 'veil'
        ob['poses'] = NP
        ob['spin'] = spin
    wisps = []
    for j in range(7):
        ph = j * 2 * math.pi / 7
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP)

            def fn(s, ph=ph, g=g):
                a = ph + s * 2.4 + 0.4 * math.sin(s * 5 + ph)
                r = R * (0.95 - 0.35 * s) * (0.3 + 0.7 * g)
                z = (0.05 + H * 1.1 * s) * g
                hw = 0.045 + 0.05 * math.sin(math.pi * s)
                return Vector((r * math.cos(a), r * math.sin(a), z)), hw
            poses.append(ribbon_points(fn, 28))
        wisps.append(ribbon_mesh(f'wisp{j}', poses))
    for w in wisps:
        sc.collection.objects.link(w)
        w.data.materials.append(m_wisp)
    wg = join(wisps, 'Elowen_VeilWisps')
    wg['effectKind'] = 'wisps'
    wg['poses'] = NP
    wg['spin'] = 0.5
    def ground(u, v, k):
        g = smooth01(k / NP) if k else 0.0
        a = u * 2 * math.pi
        r = R * (0.3 + 0.7 * g) * (0.55 + 0.5 * v)
        return Vector((r * math.cos(a), r * math.sin(a), 0.01 + 0.1 * (1 - v) * g))
    gr = grid_mesh('Elowen_VeilGround', ground, 40, 4, poses=NP + 1)
    sc.collection.objects.link(gr)
    gr.data.materials.append(m_ground)
    gr['effectKind'] = 'ground'
    gr['poses'] = NP
    rng = random.Random(7)
    centers = []
    for i in range(26):
        a = rng.random() * 2 * math.pi
        r = R * (0.25 + 0.7 * math.sqrt(rng.random()))
        centers.append(Vector((r * math.cos(a), r * math.sin(a), 0.1 + rng.random() * H * 0.9)))
    fl = quads_mesh('Elowen_VeilFlecks', centers, 0.018)
    sc.collection.objects.link(fl)
    fl.data.materials.append(m_fleck)
    fl['effectKind'] = 'flecks'
    fl['spin'] = 0.35
    return sc


# ------------------------------------------------------------ E: drifting step
def build_e(rib, soft):
    """The drifting step is a blink: a flash of mist where she leaves and
    where she lands (a bright core, ten tufts thrown outward, a ground ring,
    six poses each: a quarter second), and a streak between the two. The
    streak is authored one metre long along +Z; the runtime lays it along
    the step and stretches it to the step's true length."""
    sc = scene_for('FX E')
    NP = 6
    m_core = mist_material('Elowen_StepCore', WHITE, 5.0, soft, 1.0, additive=True)
    m_flash = mist_material('Elowen_StepFlash', PALE, 3.0, rib, 0.85, additive=True)
    m_ring = mist_material('Elowen_StepRing', PALE, 1.8, soft, 0.6, additive=True)
    m_trail = mist_material('Elowen_StepTrail', PALE, 2.4, rib, 0.7, additive=True)
    H = 0.55  # chest height, where the flash sits
    # The core: three crossed vertical strips swelling from a point.
    cores = []
    for j in range(3):
        ang = j * math.pi / 3
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP) if k else 0.0

            def fn(s, g=g):
                z = H - 0.22 * g + s * 0.44 * g
                hw = 0.005 + 0.13 * g * math.sin(math.pi * s) ** 0.6
                return Vector((0, 0, z)), hw
            poses.append(ribbon_points(fn, 12))
        up = lambda p, t, ang=ang: Vector((math.cos(ang), math.sin(ang), 0))
        cores.append(ribbon_mesh(f'stepcore{j}', poses, up))
    for c in cores:
        sc.collection.objects.link(c)
        c.data.materials.append(m_core)
    core = join(cores, 'Elowen_StepCore')
    core['effectKind'] = 'core'
    core['poses'] = NP
    # The tufts: ten short ribbons thrown out of the core in every
    # direction, thinning at the tip.
    tufts = []
    for j in range(10):
        a = j * 2.399
        e = 0.45 * math.sin(j * 1.7)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP) if k else 0.0

            def fn(s, d=d, g=g):
                p = Vector((0, 0, H)) + d * (0.5 * s * g) + Vector((0, 0, 0.08 * s * s * g))
                hw = 0.005 + (0.02 + 0.06 * math.sin(math.pi * s) ** 0.8) * g * (1 - 0.4 * s)
                return p, hw
            poses.append(ribbon_points(fn, 12))
        tufts.append(ribbon_mesh(f'tuft{j}', poses))
    for t in tufts:
        sc.collection.objects.link(t)
        t.data.materials.append(m_flash)
    flash = join(tufts, 'Elowen_StepFlash')
    flash['effectKind'] = 'burst'
    flash['poses'] = NP

    def ring(u, v, k):
        g = smooth01(k / NP) if k else 0.0
        a = u * 2 * math.pi
        r = (0.12 + 0.45 * g) * (0.6 + 0.4 * v)
        return Vector((r * math.cos(a), r * math.sin(a), 0.02))
    rg = grid_mesh('Elowen_StepRing', ring, 32, 3, poses=NP + 1)
    sc.collection.objects.link(rg)
    rg.data.materials.append(m_ring)
    rg['effectKind'] = 'ring'
    rg['poses'] = NP
    # The streak: three crossed strips from z = 0 to z = 1, soft at both
    # ends, laid flat in the source scene for the preview only.
    strips = []
    for j in range(3):
        ang = j * math.pi / 3

        def fn(s):
            return Vector((0, 0, s)), 0.02 + 0.07 * math.sin(math.pi * s) ** 0.5
        up = lambda p, t, ang=ang: Vector((math.cos(ang), math.sin(ang), 0))
        strips.append(ribbon_mesh(f'streak{j}', [ribbon_points(fn, 24)], up))
    for st in strips:
        sc.collection.objects.link(st)
        st.data.materials.append(m_trail)
    trail = join(strips, 'Elowen_StepTrail')
    trail['effectKind'] = 'trail'
    trail.location = (0, 0, H)
    trail.rotation_euler = (-math.pi / 2, 0, 0)
    trail.scale = (1, 1, 1.6)
    return sc


# ------------------------------------------------------------ A: attack wisp
def build_a(rib, soft):
    """The auto: a small wisp thrown from her hand, a bright spindle with
    two mist ribbons turning round it, authored along +Z like the lance at
    half its size; and its impact, five small petals bursting from a point
    over eight poses."""
    sc = scene_for('FX A')
    m_core = mist_material('Elowen_WispCore', WHITE, 6.0, rib, 1.0, additive=True)
    m_mist = mist_material('Elowen_WispMist', PALE, 2.4, rib, 0.75, additive=True)
    m_burst = mist_material('Elowen_WispBurst', PALE, 2.6, rib, 0.8, additive=True)
    L = 0.32
    cores = []
    for j in range(3):
        ang = j * math.pi / 3

        def fn(s):
            z = -L * 0.4 + s * L
            hw = 0.03 * math.sin(math.pi * s) ** 0.6 * (1 - 0.4 * s)
            return Vector((0, 0, z)), hw
        up = lambda p, t, ang=ang: Vector((math.cos(ang), math.sin(ang), 0))
        cores.append(ribbon_mesh(f'wispcore{j}', [ribbon_points(fn, 16)], up))
    for c in cores:
        sc.collection.objects.link(c)
        c.data.materials.append(m_core)
    core = join(cores, 'Elowen_WispCore')
    core['effectKind'] = 'core'
    ribs = []
    for j in range(2):
        ph = j * math.pi

        def fn(s, ph=ph):
            z = L * 0.5 - s * L * 1.3
            r = 0.03 + 0.07 * s
            a = ph + s * 2 * math.pi * 1.4
            hw = 0.02 + 0.05 * s
            return Vector((r * math.cos(a), r * math.sin(a), z)), hw
        ribs.append(ribbon_mesh(f'wisprib{j}', [ribbon_points(fn, 30)]))
    for r in ribs:
        sc.collection.objects.link(r)
        r.data.materials.append(m_mist)
    mist = join(ribs, 'Elowen_WispMist')
    mist['effectKind'] = 'spin'
    mist['spin'] = 12.0
    NP = 8
    petals = []
    for j in range(5):
        a = j * 2 * math.pi / 5 + 0.4
        e = 0.5 * math.sin(j * 2.1)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = Vector((1, 0, 0))
        side.normalize()
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP) if k else 0.0

            def fn(s, d=d, side=side, g=g):
                dd = s * g
                p = d * (0.3 * dd) + side * (0.12 * dd * dd)
                hw = 0.004 + (0.015 + 0.06 * math.sin(math.pi * s) ** 0.8) * dd * (0.3 + 0.7 * g)
                return p, hw
            poses.append(ribbon_points(fn, 12))
        petals.append(ribbon_mesh(f'wisppetal{j}', poses))
    for p in petals:
        sc.collection.objects.link(p)
        p.data.materials.append(m_burst)
    burst = join(petals, 'Elowen_WispBurst')
    burst['effectKind'] = 'burst'
    burst['poses'] = NP
    burst.location = (0.6, 0, 0.3)
    return sc


# ------------------------------------------------------------ R: whiteout
def build_r(rib, soft, veil_img):
    sc = scene_for('FX R')
    R = 5.0 / SCALE
    NP = 12
    m_wall = mist_material('Elowen_StormWall', PALE, 1.5, veil_img, 0.5)
    m_rib = mist_material('Elowen_StormRibbon', WHITE, 2.4, rib, 0.7, additive=True)
    m_eye = mist_material('Elowen_StormEye', WHITE, 2.0, rib, 0.65, additive=True)
    m_ground = mist_material('Elowen_StormGround', DEEP, 1.2, soft, 0.45, additive=True)
    m_fleck = mist_material('Elowen_StormFleck', WHITE, 4.0, soft, 0.9, additive=True)
    # The wall of wind: a curtain on the rim, rising, ragged top.
    def wall(u, v, k):
        g = smooth01(k / NP) if k else 0.0
        a = u * 2 * math.pi
        r = R * (0.97 + 0.03 * v) * (0.5 + 0.5 * g)
        top = 1.0 + 0.12 * math.sin(a * 11) + 0.08 * math.sin(a * 5 + 1)
        return Vector((r * math.cos(a), r * math.sin(a), top * v * g))
    wl = grid_mesh('Elowen_StormWall', wall, 72, 8, poses=NP + 1)
    sc.collection.objects.link(wl)
    wl.data.materials.append(m_wall)
    wl['effectKind'] = 'wall'
    wl['poses'] = NP
    wl['spin'] = 0.35
    # Twelve tall ribbons climbing the wall in a twist.
    ribs = []
    for j in range(12):
        ph = j * 2 * math.pi / 12
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP)

            def fn(s, ph=ph, g=g):
                a = ph + s * 1.6
                r = R * (1.0 - 0.08 * s) * (0.5 + 0.5 * g)
                z = (0.02 + 1.25 * s) * g
                hw = 0.05 + 0.07 * math.sin(math.pi * s) ** 0.5
                return Vector((r * math.cos(a), r * math.sin(a), z)), hw
            poses.append(ribbon_points(fn, 26))
        ribs.append(ribbon_mesh(f'storm{j}', poses))
    for r in ribs:
        sc.collection.objects.link(r)
        r.data.materials.append(m_rib)
    rg = join(ribs, 'Elowen_StormRibbons')
    rg['effectKind'] = 'spin'
    rg['poses'] = NP
    rg['spin'] = 0.9
    # The eye: a flat spiral of mist on the ground pulled to the centre.
    eyes = []
    for j in range(4):
        ph = j * math.pi / 2
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP)

            def fn(s, ph=ph, g=g):
                a = ph + s * 2 * math.pi * 1.5
                r = R * 0.75 * (1 - s) ** 0.8 * g + 0.03
                hw = 0.04 + 0.12 * (1 - s) * g
                return Vector((r * math.cos(a), r * math.sin(a), 0.03 + 0.05 * (1 - s))), hw
            poses.append(ribbon_points(fn, 40))
        eyes.append(ribbon_mesh(f'eye{j}', poses, lambda p, t: Vector((0, 0, 1)).cross(t).normalized() if abs(t.z) < 0.99 else Vector((1, 0, 0))))
    for e in eyes:
        sc.collection.objects.link(e)
        e.data.materials.append(m_eye)
    eg = join(eyes, 'Elowen_StormEye')
    eg['effectKind'] = 'eye'
    eg['poses'] = NP
    eg['spin'] = -1.6
    # The central vortex: ribbons rising in a cone over the eye.
    vs = []
    for j in range(6):
        ph = j * math.pi / 3
        poses = []
        for k in range(NP + 1):
            g = smooth01(k / NP)

            def fn(s, ph=ph, g=g):
                a = ph + s * 2 * math.pi * 1.1
                r = (0.06 + 0.35 * s) * g
                z = (0.05 + 1.6 * s) * g
                hw = 0.03 + 0.06 * s
                return Vector((r * math.cos(a), r * math.sin(a), z)), hw
            poses.append(ribbon_points(fn, 30))
        vs.append(ribbon_mesh(f'vortex{j}', poses))
    for v in vs:
        sc.collection.objects.link(v)
        v.data.materials.append(m_rib)
    vg = join(vs, 'Elowen_StormVortex')
    vg['effectKind'] = 'vortex'
    vg['poses'] = NP
    vg['spin'] = 2.2
    def ground(u, v, k):
        g = smooth01(k / NP) if k else 0.0
        a = u * 2 * math.pi
        r = R * g * (0.05 + 0.95 * v)
        return Vector((r * math.cos(a), r * math.sin(a), 0.01))
    gr = grid_mesh('Elowen_StormGround', ground, 48, 4, poses=NP + 1)
    sc.collection.objects.link(gr)
    gr.data.materials.append(m_ground)
    gr['effectKind'] = 'ground'
    gr['poses'] = NP
    rng = random.Random(3)
    centers = []
    for i in range(60):
        a = rng.random() * 2 * math.pi
        r = R * (0.15 + 0.8 * math.sqrt(rng.random()))
        centers.append(Vector((r * math.cos(a), r * math.sin(a), 0.1 + rng.random() * 1.1)))
    fl = quads_mesh('Elowen_StormFlecks', centers, 0.02)
    sc.collection.objects.link(fl)
    fl.data.materials.append(m_fleck)
    fl['effectKind'] = 'flecks'
    fl['spin'] = 1.2
    return sc


# ------------------------------------------------------------ previews
def preview(sc, name, seconds, spins=True, height=1.0, dist=3.0, rise_frames=12, fade_from=None):
    """Keyframes for the viewport only: poses rise over rise_frames, spinning
    parts turn at their runtime rate; a camera and a dark floor; frames to
    mp4."""
    N = int(seconds * FPS)
    sc.frame_start = 1
    sc.frame_end = N
    bpy.context.window.scene = sc
    for ob in list(sc.objects):
        if ob.type in ('CAMERA', 'LIGHT') or ob.name.startswith('_'):
            bpy.data.objects.remove(ob, do_unlink=True)
    for ob in sc.objects:
        ob.animation_data_clear()
        keys = ob.data.shape_keys
        if keys:
            keys.animation_data_clear()
            n = len(keys.key_blocks) - 1
            for f in range(1, N + 1):
                pose = min(n - 1, (f - 1) / rise_frames * n - 1) if rise_frames else n - 1
                for i, kb in enumerate(list(keys.key_blocks)[1:]):
                    kb.value = max(0.0, 1 - abs(pose - i))
                    kb.keyframe_insert('value', frame=f)
        if spins and ob.get('spin'):
            ob.rotation_euler = (0, 0, 0)
            ob.keyframe_insert('rotation_euler', frame=1)
            ob.rotation_euler = (0, 0, ob['spin'] * seconds)
            ob.keyframe_insert('rotation_euler', frame=N)
            for fc in ob.animation_data.action.layers[0].strips[0].channelbags[0].fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    floor = bpy.data.meshes.new('_floor')
    floor.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('_floor', floor)
    sc.collection.objects.link(fo)
    fm = bpy.data.materials.new('_floor')
    fm.use_nodes = True
    bs = next(n for n in fm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (0.09, 0.08, 0.07, 1)
    bs.inputs['Roughness'].default_value = 0.9
    floor.materials.append(fm)
    cam = bpy.data.objects.new('_cam', bpy.data.cameras.new('_cam'))
    sc.collection.objects.link(cam)
    cam.location = (dist * 0.7, -dist, height + dist * 0.75)
    look = Vector((0, 0, height * 0.45)) - cam.location
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    sc.camera = cam
    light = bpy.data.objects.new('_light', bpy.data.lights.new('_light', 'SUN'))
    light.data.energy = 1.5
    light.rotation_euler = (0.9, 0.2, 0.6)
    sc.collection.objects.link(light)
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError as e:
        eng = [x.strip(" '") for x in str(e).split('(')[-1].rstrip(')').split(',')]
        sc.render.engine = next(x for x in eng if 'EEVEE' in x)
    if hasattr(sc.eevee, 'use_bloom'):
        sc.eevee.use_bloom = True
    sc.render.resolution_x = 720
    sc.render.resolution_y = 560
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else sc.view_settings.view_transform
    sc.world = sc.world or bpy.data.worlds.new('_world')
    sc.world.use_nodes = True
    bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.02, 0.025, 0.035, 1)
    bg.inputs[1].default_value = 1.0
    out = os.path.join(SCRATCH, f'{name}_fx_frames')
    os.makedirs(out, exist_ok=True)
    for x in os.listdir(out):
        os.remove(os.path.join(out, x))
    sc.render.filepath = os.path.join(out, 'f_')
    bpy.ops.render.render(animation=True, scene=sc.name)
    mp4 = os.path.join(PREVIEW_DIR, f'elowen_fx_{name.lower()}_preview.mp4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '2',
                    '-framerate', str(FPS), '-i', os.path.join(out, 'f_%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4], check=True)
    return mp4, out


def build_all(previews=False, only=None):
    """Rebuilds every scene (or the keys in `only`), previews on request."""
    rib, soft, veil_img = textures()
    main_scene = bpy.context.window.scene
    builders = {
        'A': (lambda: build_a(rib, soft), dict(seconds=1.0, height=0.3, dist=1.6, rise_frames=8)),
        'Q': (lambda: build_q(rib, soft), dict(seconds=1.5, height=0.3, dist=1.8, rise_frames=14)),
        'W': (lambda: build_w(rib, soft, veil_img), dict(seconds=2.0, height=0.9, dist=2.6, rise_frames=12)),
        'E': (lambda: build_e(rib, soft), dict(seconds=0.6, height=0.6, dist=2.0, rise_frames=6)),
        'R': (lambda: build_r(rib, soft, veil_img), dict(seconds=2.5, height=1.2, dist=3.4, rise_frames=14)),
    }
    scenes = {}
    for name, (build, opts) in builders.items():
        if only and name not in only:
            continue
        scenes[name] = (build(), opts)
    if previews:
        for name, (sc, opts) in scenes.items():
            preview(sc, name, opts.pop('seconds'), **opts)
    bpy.context.window.scene = main_scene
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            if x.users == 0 and not x.use_fake_user:
                coll.remove(x)
    return scenes


if __name__ == '__main__':
    import sys
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    keys = [a[7:] for a in args if a.startswith('--only=')]
    build_all(previews='--preview' in args, only=set(keys[0].split(',')) if keys else None)
    if '--save' in args:
        bpy.ops.wm.save_mainfile()

"""The Pyrefang's fire, modelled in Blender by script over the rigged body in
art_src/models_raw/pyrefang/pyrefang_segmented.blend: the hide's lava cracks
made to glow, a mane of flame tongues along the crest, the spine and the
tail, a plume past the tail's tip, the maw lit, and embers
drifting up. Every flame is one mesh per zone with three morph poses
(Pose_00..02) cycled for the flicker, skinned to the rig, so the same files
can ship the way Elowen's mist does (scripts/build_elowen_effects.py).

Run inside Blender with the source file open, step by step:
  import build_pyrefang_effects as b; b.build_all()
or headless:
  blender -b art_src/models_raw/pyrefang/pyrefang_segmented.blend \
    --python scripts/build_pyrefang_effects.py -- --save
"""
import math
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

FPS = 24
FLAME = (1.0, 0.30, 0.03)
CORE = (1.0, 0.62, 0.14)
TIP = (0.85, 0.10, 0.02)
EMBER = (1.0, 0.28, 0.04)
COLLECTION = 'Pyrefang'
RIG = 'PyrefangRig'
BODY_PARTS = ('Pyrefang_Head', 'Pyrefang_Neck', 'Pyrefang_Body', 'Pyrefang_Tail')
POSES = 3


# ------------------------------------------------------------ textures
def _noise(w, h, cells_u, cells_v, seed, octaves=3):
    """Tileable fractal value noise in [0,1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp = 1.0
    total = 0.0
    cu, cv = cells_u, cells_v
    for _ in range(octaves):
        grid = rng.random((cv + 1, cu + 1))
        grid[-1, :] = grid[0, :]
        grid[:, -1] = grid[:, 0]
        u = np.linspace(0, cu, w, endpoint=False)
        v = np.linspace(0, cv, h, endpoint=False)
        U, V = np.meshgrid(u, v)
        iu, iv = U.astype(int), V.astype(int)
        fu, fv = U - iu, V - iv
        fu = fu * fu * (3 - 2 * fu)
        fv = fv * fv * (3 - 2 * fv)
        a = grid[iv, iu]
        b = grid[iv, iu + 1]
        c = grid[iv + 1, iu]
        d = grid[iv + 1, iu + 1]
        out += amp * ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv)
        total += amp
        amp *= 0.5
        cu *= 2
        cv *= 2
    return out / total


def _image(name, w, h, alpha, rgb=None):
    # keep the datablock when it exists: materials already point at it
    img = bpy.data.images.get(name)
    if img and tuple(img.size) != (w, h):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, w, h, alpha=True)
    px = np.ones((h, w, 4), dtype=np.float32)
    if rgb is not None:
        px[..., :3] = rgb
    px[..., 3] = np.clip(alpha, 0, 1)
    img.pixels = px.ravel().tolist()
    img.pack()
    return img


def textures():
    """pyre_flame: four flame tongues side by side (a tongue picks a band so
    the mane is not one shape repeated), base solid, tip ragged; pyre_spark:
    a soft dot for the embers and the maw."""
    w, h, bands = 512, 512, 4
    alpha = np.zeros((h, w))
    v = (np.arange(h) + 0.5) / h
    for k in range(bands):
        u = (np.arange(w // bands) + 0.5) / (w // bands)
        U, V = np.meshgrid(u, v)
        width = 0.5 * (1 - 0.75 * V ** 1.3)
        uu = (U - 0.5) / width
        mask = np.clip(1 - uu * uu, 0, 1) ** 1.2
        n = _noise(w // bands, h, 3, 7, 11 + k, octaves=4)
        rag = np.clip(n * 1.8 - 0.4 - 0.55 * V ** 2, 0, 1)
        a = mask * rag * np.clip(1.6 - 1.6 * V, 0, 1) ** 0.5
        a *= np.clip(V / 0.12, 0, 1) ** 1.5  # no hard edge at the base
        alpha[:, k * (w // bands):(k + 1) * (w // bands)] = a
    # a bright core near the base, the flame colour through the middle, a
    # deep red at the tip
    rgb = np.zeros((h, w, 3))
    lo = np.clip(v / 0.45, 0, 1)
    hi = np.clip((v - 0.45) / 0.55, 0, 1)
    for i, (c0, c1, c2) in enumerate(zip(CORE, FLAME, TIP)):
        mid = c0 * (1 - lo) + c1 * lo
        rgb[..., i] = (mid * (1 - hi) + c2 * hi)[:, None]
    flame = _image('pyre_flame', w, h, alpha, rgb)
    s = 64
    u = (np.arange(s) + 0.5) / s - 0.5
    U, V = np.meshgrid(u, u)
    r = np.sqrt(U * U + V * V) * 2
    spark = _image('pyre_spark', s, s, np.clip(1 - r, 0, 1) ** 1.6)
    return flame, spark


def fire_material(name, image, strength, color=FLAME, additive=True):
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
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    bsdf.inputs['Emission Strength'].default_value = strength
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        if image.name == 'pyre_flame':
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Emission Color'].default_value = (*color, 1)
    else:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    try:
        mat.surface_render_method = 'BLENDED'
    except Exception:
        mat.blend_method = 'BLEND'
    mat.use_backface_culling = False
    mat['additive'] = additive
    mat.diffuse_color = (*color, 1)
    return mat


# ------------------------------------------------------------ the hide
def body_glow(darken=0.5, gain=9.0):
    """The lava cracks of the base colour emit: emission colour is the
    texture, its strength the texture's redness, and the hide itself goes
    darker toward obsidian."""
    mat = bpy.data.materials['Pyrefang_Body']
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    for n in list(nt.nodes):
        if n.get('pyre_glow'):
            nt.nodes.remove(n)

    def node(kind, **kw):
        n = nt.nodes.new(kind)
        n['pyre_glow'] = True
        for k, val in kw.items():
            setattr(n, k, val)
        return n
    dark = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    dark.inputs['Factor'].default_value = 1.0
    dark.inputs[7].default_value = (darken, darken, darken, 1)
    nt.links.new(tex.outputs['Color'], dark.inputs[6])
    nt.links.new(dark.outputs[2], bsdf.inputs['Base Color'])
    sep = node('ShaderNodeSeparateColor')
    nt.links.new(tex.outputs['Color'], sep.inputs[0])
    red = node('ShaderNodeMath', operation='SUBTRACT')
    nt.links.new(sep.outputs['Red'], red.inputs[0])
    nt.links.new(sep.outputs['Blue'], red.inputs[1])
    shaped = node('ShaderNodeMath', operation='SUBTRACT')
    nt.links.new(red.outputs[0], shaped.inputs[0])
    shaped.inputs[1].default_value = 0.18
    strength = node('ShaderNodeMath', operation='MULTIPLY', use_clamp=False)
    nt.links.new(shaped.outputs[0], strength.inputs[0])
    strength.inputs[1].default_value = gain
    clamp = node('ShaderNodeMath', operation='MAXIMUM')
    nt.links.new(strength.outputs[0], clamp.inputs[0])
    clamp.inputs[1].default_value = 0.0
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(clamp.outputs[0], bsdf.inputs['Emission Strength'])
    bsdf.inputs['Roughness'].default_value = 0.55
    return mat


# ------------------------------------------------------------ geometry
def ridge_profile(parts=BODY_PARTS, half_width=0.015, step=0.01):
    """The top of the body along the midline: {y_cm: (x, y, z)} of the
    highest vertex per centimetre of y, so the crest, the back's spikes and
    the tail's ridge all come from the mesh."""
    prof = {}
    for name in parts:
        o = bpy.data.objects[name]
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if abs(p.x) < half_width:
                k = round(p.y / step)
                if k not in prof or p.z > prof[k].z:
                    prof[k] = p.copy()
    return prof


def ridge_point(prof, y, step=0.01):
    k = round(y / step)
    for d in (0, 1, -1, 2, -2, 3, -3):
        if k + d in prof:
            p = prof[k + d].copy()
            p.y = y
            return p
    return None


def spike_tips(parts, y_min, y_max, half_width=0.05, radius=0.025, rise=0.012, gap=0.018):
    """The tips of the spikes: vertices near the midline that stand `rise`
    above the mean height of their neighbourhood, one per `gap`, with the
    height they stand out by. The crest and the back get their flames from
    these rather than from a sampled line."""
    pts = []
    for name in parts:
        o = bpy.data.objects[name]
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            if abs(p.x) < half_width and y_min <= p.y <= y_max:
                pts.append(p)
    arr = np.array([[p.x, p.y, p.z] for p in pts])
    tips = []
    for i, p in enumerate(arr):
        d = np.hypot(arr[:, 0] - p[0], arr[:, 1] - p[1])
        near = arr[d < radius]
        if len(near) < 6:
            continue
        stand = p[2] - near[:, 2].mean()
        if stand > rise and p[2] >= near[:, 2].max() - 1e-6:
            tips.append((Vector(p), stand))
    tips.sort(key=lambda t: -t[1])
    kept = []
    for p, stand in tips:
        if all((p - q).length > gap for q, _ in kept):
            kept.append((p, stand))
    kept.sort(key=lambda t: t[0].y)
    return kept


def bone_segments(rig):
    return {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in rig.data.bones
            if b.use_deform}


def nearest_bone(p, segs, names):
    def d(n):
        a, b = segs[n]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
        return (p - (a + ab * t)).length
    return min(names, key=d)


class Tongues:
    """Flame tongues accumulated into one mesh with POSES morph poses. A
    tongue is two crossed cards (sagittal and transverse) of `segments`
    quads, tapering, leaning back and wavering differently per pose."""

    def __init__(self, segments=7):
        self.segments = segments
        self.verts = [[] for _ in range(POSES + 1)]
        self.faces = []
        self.uvs = []
        self.groups = []  # (bone, first vertex, count)
        self.rng = random.Random(7)

    CARDS = 3

    def add(self, base, up, height, width, lean, bone, band=None, sway=0.35, sink=None):
        up = up.normalized()
        # lean: a world-space direction the tip drifts toward (backward, +Y);
        # the base sinks into the body so no card edge shows at the root
        sink = min(0.02, 0.3 * height) if sink is None else sink
        base = base - up * sink
        height = height + sink
        n0 = len(self.verts[0])
        band = self.rng.randrange(4) if band is None else band
        phase = self.rng.random() * math.tau
        sag = Vector((0, 1, 0)) if abs(up.y) < 0.9 else Vector((1, 0, 0))
        side = up.cross(sag).normalized()
        sag = side.cross(up).normalized()
        spin = self.rng.random() * math.pi
        axes = []
        for c in range(self.CARDS):
            a = spin + c * math.pi / self.CARDS
            axes.append(sag * math.cos(a) + side * math.sin(a))
        for k in range(POSES + 1):
            pts = []
            ang = 0 if k == 0 else phase + (k - 1) * math.tau / POSES
            for i in range(self.segments + 1):
                s = i / self.segments
                curl = lean * (s * s) * height
                wob = (side * math.sin(ang + s * 2.2) + sag * math.cos(ang * 1.3 + s * 1.7)) * (
                    0.0 if k == 0 else sway * height * s * s)
                stretch = up * height * s * (1.0 if k == 0 else 1.0 + 0.18 * math.sin(ang + 0.7))
                p = base + stretch + curl + wob
                w = width * (1 - 0.65 * s)
                for axis in axes:
                    pts += [p - axis * w, p + axis * w]
            self.verts[k] += pts
        u0 = band / 4
        ring = 2 * self.CARDS
        for i in range(self.segments):
            s0, s1 = i / self.segments, (i + 1) / self.segments
            for c in range(self.CARDS):
                a = n0 + i * ring + c * 2
                b = n0 + (i + 1) * ring + c * 2
                self.faces.append((a, a + 1, b + 1, b))
                self.uvs.append(((u0, s0), (u0 + 0.25, s0), (u0 + 0.25, s1), (u0, s1)))
        self.groups.append((bone, n0, len(self.verts[0]) - n0))

    def build(self, name, material, rig, collection):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts[0], [], self.faces)
        me.update()
        uv = me.uv_layers.new(name='UVMap')
        for poly, quad in zip(me.polygons, self.uvs):
            for li, t in zip(poly.loop_indices, quad):
                uv.data[li].uv = t
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        ob.shape_key_add(name='Basis')
        for k in range(POSES):
            key = ob.shape_key_add(name=f'Pose_{k:02d}')
            for i, co in enumerate(self.verts[k + 1]):
                key.data[i].co = co
        for bone, first, count in self.groups:
            vg = ob.vertex_groups.get(bone) or ob.vertex_groups.new(name=bone)
            vg.add(list(range(first, first + count)), 1.0, 'REPLACE')
        ob.parent = rig
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.modifiers.new('Armature', 'ARMATURE').object = rig
        ob['effectKind'] = 'flame'
        return ob


def _remove(name):
    ob = bpy.data.objects.get(name)
    if ob:
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)


def _ctx():
    rig = bpy.data.objects[RIG]
    col = bpy.data.collections[COLLECTION]
    flame = bpy.data.images.get('pyre_flame') or textures()[0]
    mat = bpy.data.materials.get('Pyrefang_Flame') or fire_material('Pyrefang_Flame', flame, 1.4)
    return rig, col, mat, bone_segments(rig), ridge_profile()


def _mane(t, tips, prof, y_min, y_max, bones, segs, up, lean, tall, wide, rnd):
    """A tongue on every spike tip, sized by how far the spike stands out,
    and a short filler tongue on the ridge between tips so the mane reads
    as one fire rather than a row of torches."""
    # a tip far below the ridge line is a bump on the flank, not a spike
    top = [(p, s) for p, s in tips
           if ridge_point(prof, p.y) is not None and p.z > ridge_point(prof, p.y).z - 0.03]
    tips = top
    for p, stand in tips:
        h = tall * (0.7 + 0.3 * min(1.0, stand / 0.04)) * (0.85 + 0.3 * rnd.random())
        t.add(p, up, h, wide, lean, nearest_bone(p, segs, bones))
    y = y_min
    while y < y_max:
        p = ridge_point(prof, y)
        if p is not None and all((p - q).length > 0.014 for q, _ in tips):
            h = tall * (0.35 + 0.25 * rnd.random())
            t.add(p, up, h, wide * 0.7, lean, nearest_bone(p, segs, bones), sway=0.5)
        y += 0.013


def crest_flames():
    """The head's crest: the tallest tongues, swept back over the neck,
    one per crest spike."""
    rig, col, mat, segs, prof = _ctx()
    _remove('Pyrefang_FX_Crest')
    t = Tongues()
    tips = spike_tips(('Pyrefang_Head', 'Pyrefang_Neck'), -0.47, -0.29, half_width=0.05)
    _mane(t, tips, prof, -0.45, -0.29, ['Head', 'Neck02', 'Neck01'], segs,
          Vector((0, 0.35, 1)), Vector((0, 1, -0.2)) * 0.9, 0.13, 0.02, random.Random(5))
    return t.build('Pyrefang_FX_Crest', mat, rig, col)


def spine_flames():
    """The back: a mane from the withers to the rump, one tongue per
    spike of the ridge."""
    rig, col, mat, segs, prof = _ctx()
    _remove('Pyrefang_FX_Spine')
    t = Tongues()
    tips = spike_tips(('Pyrefang_Body',), -0.29, 0.10, half_width=0.03)
    _mane(t, tips, prof, -0.28, 0.09, ['Neck01', 'Chest', 'Spine', 'Hips'], segs,
          Vector((0, 0.25, 1)), Vector((0, 1, -0.3)) * 0.8, 0.10, 0.017, random.Random(3))
    return t.build('Pyrefang_FX_Spine', mat, rig, col)


def tail_fire():
    """The tail: tongues shrinking toward the tip, then the plume, a long
    tongue past the tip that streams behind the creature."""
    rig, col, mat, segs, prof = _ctx()
    _remove('Pyrefang_FX_Tail')
    t = Tongues()
    tails = [f'Tail{i:02d}' for i in range(1, 9)]
    y = 0.10
    while y < 0.47:
        p = ridge_point(prof, y)
        if p:
            s = (y - 0.10) / 0.37
            h = 0.07 - 0.03 * s
            t.add(p, Vector((0, 0.3, 1)), h, 0.014 - 0.005 * s, Vector((0, 1, -0.2)) * 0.9,
                  nearest_bone(p, segs, tails))
        y += 0.016
    tip = Vector((0, 0.47, 0.045))
    for i in range(4):
        t.add(tip + Vector((0, 0.03 * i, 0.004 * i)), Vector((0, 1, 0.12 + 0.05 * i)), 0.16 + 0.03 * i,
              0.016 - 0.003 * i, Vector((0, 0.1, 0.4)) * 0.5, 'Tail08', band=i, sway=0.55, sink=0.0)
    return t.build('Pyrefang_FX_Tail', mat, rig, col)


def maw_glow():
    """The glow inside the open maw, riding the head. (The eyes are left
    to the texture: lit spheres placed by guess sat beside them.)"""
    rig, col, mat, segs, prof = _ctx()
    spark = bpy.data.images.get('pyre_spark') or textures()[1]
    halo = bpy.data.materials.get('Pyrefang_Halo') or fire_material('Pyrefang_Halo', spark, 2.5, FLAME)
    for n in ('Pyrefang_FX_Eyes', 'Pyrefang_FX_Maw'):
        _remove(n)
    verts, faces, uvs = [], [], []

    def card(c, a, b, w, h):
        base = len(verts)
        verts.extend([c - a * w - b * h, c + a * w - b * h, c + a * w + b * h, c - a * w + b * h])
        faces.append((base, base + 1, base + 2, base + 3))
        uvs.append(((0, 0), (1, 0), (1, 1), (0, 1)))
    # a transverse card and a sagittal one, never a flat one: a flat card
    # reads as a line from any raised view
    card(Vector((0, -0.44, 0.377)), Vector((1, 0, 0)), Vector((0, 0, 1)), 0.04, 0.018)
    card(Vector((0, -0.44, 0.377)), Vector((0, 1, 0)), Vector((0, 0, 1)), 0.045, 0.018)
    me = bpy.data.meshes.new('Pyrefang_FX_Maw')
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly, quad in zip(me.polygons, uvs):
        for li, tt in zip(poly.loop_indices, quad):
            uv.data[li].uv = tt
    me.materials.append(halo)
    maw = bpy.data.objects.new('Pyrefang_FX_Maw', me)
    col.objects.link(maw)
    vg = maw.vertex_groups.new(name='Head')
    vg.add(list(range(len(maw.data.vertices))), 1.0, 'REPLACE')
    maw.parent = rig
    maw.matrix_parent_inverse = Matrix.Identity(4)
    maw.modifiers.new('Armature', 'ARMATURE').object = rig
    return maw


def embers(count=90):
    """Sparks rising off the mane and the tail: crossed cards per fleck,
    the poses lift and scatter them, the cycle lets them pop back low."""
    rig, col, mat, segs, prof = _ctx()
    spark = bpy.data.images.get('pyre_spark') or textures()[1]
    em = bpy.data.materials.get('Pyrefang_Ember') or fire_material('Pyrefang_Ember', spark, 3.5, EMBER)
    _remove('Pyrefang_FX_Embers')
    rnd = random.Random(21)
    centers = []
    for _ in range(count):
        y = rnd.uniform(-0.45, 0.55)
        p = ridge_point(prof, min(0.47, max(-0.455, y)))
        if p is None:
            continue
        c = p + Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.02, 0.02), rnd.uniform(0.0, 0.08)))
        if y > 0.47:
            c = Vector((rnd.uniform(-0.04, 0.04), y + 0.05, 0.05 + rnd.uniform(0, 0.08)))
        centers.append((c, rnd.uniform(0.6, 1.4), rnd.random() * math.tau))
    axes = [(Vector((1, 0, 0)), Vector((0, 0, 1))), (Vector((0, 1, 0)), Vector((0, 0, 1)))]
    size = 0.004

    def build(k):
        out = []
        for c, speed, ph in centers:
            rise = 0 if k == 0 else 0.045 * speed * (k / POSES)
            drift = Vector((0.012 * math.sin(ph + k), 0.02 * speed * (k / POSES), rise))
            p = c + drift
            s = size * (1.0 if k == 0 else 1.0 - 0.6 * (k / POSES))
            for a, b in axes:
                out += [p - a * s - b * s, p + a * s - b * s, p + a * s + b * s, p - a * s + b * s]
        return out
    verts = build(0)
    faces = [(4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 3) for q in range(len(verts) // 4)]
    me = bpy.data.meshes.new('Pyrefang_FX_Embers')
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    quad = ((0, 0), (1, 0), (1, 1), (0, 1))
    for poly in me.polygons:
        for li, tt in zip(poly.loop_indices, quad):
            uv.data[li].uv = tt
    me.materials.append(em)
    ob = bpy.data.objects.new('Pyrefang_FX_Embers', me)
    col.objects.link(ob)
    ob.shape_key_add(name='Basis')
    for k in range(1, POSES + 1):
        key = ob.shape_key_add(name=f'Pose_{k - 1:02d}')
        for i, co in enumerate(build(k)):
            key.data[i].co = co
    ob['effectKind'] = 'embers'
    # each fleck rides the bone nearest its seed
    names = [n for n in segs if n != 'Jaw']
    for q, (c, speed, ph) in enumerate(centers):
        b = nearest_bone(c, segs, names)
        vg = ob.vertex_groups.get(b) or ob.vertex_groups.new(name=b)
        vg.add(list(range(q * 8, q * 8 + 8)), 1.0, 'REPLACE')
    ob.parent = rig
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.modifiers.new('Armature', 'ARMATURE').object = rig
    return ob


# ------------------------------------------------------------ motion
def animate(seconds=8.0, flicker_hz=3.2, ember_hz=0.9, turntable=True):
    """Keys for the viewport: the flame poses cycle round (circular blend
    between neighbouring poses), the embers run their rise and pop back,
    the rig turns once on the spot."""
    sc = bpy.context.scene or bpy.data.scenes[0]
    N = int(seconds * FPS)
    sc.frame_start, sc.frame_end = 1, N
    sc.render.fps = FPS
    rig = bpy.data.objects[RIG]
    for ob in bpy.data.objects:
        if not ob.name.startswith('Pyrefang_FX_'):
            continue
        keys = ob.data.shape_keys
        if not keys:
            continue
        keys.animation_data_clear()
        hz = ember_hz if ob['effectKind'] == 'embers' else flicker_hz
        blocks = list(keys.key_blocks)[1:]
        n = len(blocks)
        for f in range(1, N + 1):
            t = (f - 1) / FPS
            phase = (t * hz) % n
            for i, kb in enumerate(blocks):
                d = abs(phase - i)
                d = min(d, n - d)
                kb.value = max(0.0, 1 - d)
                kb.keyframe_insert('value', frame=f)
    if turntable:
        rig.animation_data_clear()
        rig.rotation_mode = 'XYZ'
        rig.rotation_euler = (0, 0, 0)
        rig.keyframe_insert('rotation_euler', frame=1)
        rig.rotation_euler = (0, 0, math.tau)
        rig.keyframe_insert('rotation_euler', frame=N)
        act = rig.animation_data.action
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for kp in fc.keyframe_points:
                            kp.interpolation = 'LINEAR'
    sc.frame_set(1)


def build_all():
    textures()
    body_glow()
    crest_flames()
    spine_flames()
    tail_fire()
    maw_glow()
    embers()
    animate()


if __name__ == '__main__' and bpy.app.background:
    build_all()
    if '--save' in sys.argv:
        bpy.ops.wm.save_mainfile()

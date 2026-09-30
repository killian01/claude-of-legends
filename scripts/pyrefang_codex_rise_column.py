"""The fire column the Pyrefang rises from, for the Codex_Emerge scene.

Built the way the Elowen spell effects are (scripts/build_elowen_effects.py)
and in the spirit of the tower shot (src/render/vfx/tower_shot_fx.ts): layered
additive effect geometry with morph poses, driven continuously, and an animated
emissive material, so the fire moves from the first frame to the last instead
of cutting between stills. The beats follow the painted sheet the user supplied
on 2026-09-28 (`art_src/models_raw/pyrefang/rise_fire_sheet.png`):

  0.00 s  a lava swirl opens on the floor and a crown of small flames ignites;
  0.15 s  helical tongues of fire climb and twist round the curled body;
  0.35 s  they tighten into a vortex, 0.55 s the full column stands;
  0.95 s  the column opens in two lobes;
  1.25 s  it falls back into low flames that die by 1.75 s while the pit cools.

Every tongue is a ribbon with one shape key per beat; the keys cross-fade every
frame, the ribbons turn, and the flame veins stream up the ribbons (a scrolled,
tileable noise under a tongue mask), so the motion is continuous. Sparks leap
out of the burst, a shock ring runs over the floor, an orange light follows the
fire.

Everything is centred on the curled body, in source metres (the Pyrefang is
about 1 m long), deterministic (fixed seeds, no time source), and named in the
Codex convention (actions CodexFX_Rise_*). The client will rebuild the same
look from the exported meshes and morphs with a scrolling fire shader.
"""

import math
import random

import bpy
import numpy as np
from mathutils import Vector

SEED = 22
PIT_RADIUS = .45
# Beats of the column: (time in seconds, pose index). Pose 0 is the Basis,
# the fire hidden at the floor; poses 1..5 are rise, vortex, full, open, low.
COLUMN_BEATS = ((0.0, 0), (.15, 1), (.35, 2), (.55, 3), (.75, 3), (.95, 4), (1.25, 5), (1.70, 0))
CROWN_BEATS = ((0.0, 0), (.06, 1), (.20, 2), (.50, 1), (.75, 0), (1.10, 1), (1.40, 2), (1.75, 0))
FIRE_END = 1.75


def _smooth(x):
    x = max(0.0, min(1.0, x))
    return x*x*x*(x*(6*x-15)+10)


def _beat_weights(t, beats, poses):
    """Weights of each pose at time t: a smooth cross-fade between beats."""
    weights = [0.0]*poses
    if t <= beats[0][0]:
        weights[beats[0][1]] = 1.0
        return weights
    for (t0, p0), (t1, p1) in zip(beats, beats[1:]):
        if t <= t1:
            k = _smooth((t-t0)/(t1-t0))
            weights[p0] += 1-k
            weights[p1] += k
            return weights
    weights[beats[-1][1]] = 1.0
    return weights


def _fire(t):
    """How much fire stands at time t, 0..1, for the light."""
    heights = (0.0, .45, .85, 1.0, .85, .35)
    return sum(w*h for w, h in zip(_beat_weights(t, COLUMN_BEATS, 6), heights))


# ------------------------------------------------------------ textures
def _noise(w, h, cells_u, cells_v, seed, octaves=4):
    """Tileable fractal value noise in [0, 1]."""
    rng = np.random.RandomState(seed)
    out = np.zeros((h, w))
    amp, total, cu, cv = 1.0, 0.0, cells_u, cells_v
    for _ in range(octaves):
        grid = rng.rand(int(cv)+1, int(cu)+1)
        grid[:, -1] = grid[:, 0]
        grid[-1, :] = grid[0, :]
        ys = np.linspace(0, cv, h, endpoint=False)
        xs = np.linspace(0, cu, w, endpoint=False)
        y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
        fy, fx = ys-y0, xs-x0
        fy, fx = fy*fy*(3-2*fy), fx*fx*(3-2*fx)
        a = grid[y0][:, x0]
        b = grid[y0][:, x0+1]
        c = grid[y0+1][:, x0]
        d = grid[y0+1][:, x0+1]
        top = a+(b-a)*fx[None, :]
        bottom = c+(d-c)*fx[None, :]
        out += amp*(top+(bottom-top)*fy[:, None])
        total += amp
        amp *= .5
        cu, cv = cu*2, cv*2
    return out/total


def _image(name, rgba):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    h, w = rgba.shape[:2]
    image = bpy.data.images.new(name, w, h, alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())
    image.pack()
    return image


def _veins_image():
    """Tileable fire veins along U: long bright filaments that fork and
    wander, over a dimmer turbulent body. Grey; the material colours it."""
    w, h = 512, 128
    streak = _noise(w, h, 3, 12, 7)
    fine = _noise(w, h, 6, 26, 13)
    body = _noise(w, h, 4, 5, 29)
    ridge = 1-np.abs(2*streak-1)
    ridge2 = 1-np.abs(2*fine-1)
    value = np.clip(.75*ridge**5 + .55*ridge2**7 + .35*body, 0, 1)
    rgba = np.ones((h, w, 4))
    rgba[..., :3] = value[..., None]
    return _image('pyre_fx_veins', rgba)


def _swirl_image():
    """The floor: spiral arms of lava round a hot centre, fading out."""
    size = 256
    u = (np.arange(size)+.5)/size*2-1
    x, y = np.meshgrid(u, u)
    r = np.sqrt(x*x+y*y)
    angle = np.arctan2(y, x)
    arms = (.5+.5*np.cos(5*angle + 7*r))**4
    grain = _noise(size, size, 8, 8, 41)
    hot = np.exp(-(r/.25)**2)
    value = np.clip((.65*arms*(.6+.6*grain) + .9*hot) * np.clip(1-r, 0, 1)**1.2, 0, 1)
    rgba = np.ones((size, size, 4))
    rgba[..., 1] = .28+.6*value
    rgba[..., 2] = .05+.35*value**2
    rgba[..., 3] = value
    return _image('pyre_fx_swirl', rgba)


def _dot_image():
    size = 64
    u = (np.arange(size)+.5)/size*2-1
    x, y = np.meshgrid(u, u)
    value = np.clip(1-np.sqrt(x*x+y*y), 0, 1)**1.6
    rgba = np.ones((size, size, 4))
    rgba[..., 3] = value
    return _image('pyre_fx_dot', rgba)


# ------------------------------------------------------------ materials
def _fire_material(name, veins, strength=3.2):
    """Emissive fire: veins streaming along U under a tongue mask (soft
    edges across V, a bright root, a tapering tip), coloured from deep red
    through orange and yellow to white. A 'Codex fade' node multiplies the
    alpha; the 'Codex scroll' Mapping location is keyed to stream the veins."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    new, link = nt.nodes.new, nt.links.new
    out = new('ShaderNodeOutputMaterial')
    bsdf = new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Emission Strength'].default_value = strength
    coord = new('ShaderNodeTexCoord')
    mapping = new('ShaderNodeMapping')
    mapping.name = 'Codex scroll'
    tex = new('ShaderNodeTexImage')
    tex.image = veins
    tex.extension = 'REPEAT'
    link(coord.outputs['UV'], mapping.inputs['Vector'])
    link(mapping.outputs['Vector'], tex.inputs['Vector'])
    split = new('ShaderNodeSeparateXYZ')
    link(coord.outputs['UV'], split.inputs['Vector'])

    def op(operation, a, b=None):
        node = new('ShaderNodeMath')
        node.operation = operation
        for index, value in enumerate((a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                node.inputs[index].default_value = value
            else:
                link(value, node.inputs[index])
        return node.outputs[0]

    along, across = split.outputs['X'], split.outputs['Y']
    edge = op('POWER', op('SINE', op('MULTIPLY', across, math.pi)), .9)
    root = op('MINIMUM', op('MULTIPLY', along, 14.0), 1.0)
    taper = op('POWER', op('SUBTRACT', 1.0, along), .8)
    mask = op('MULTIPLY', op('MULTIPLY', edge, root), taper)
    raw = op('MULTIPLY', mask, op('ADD', op('MULTIPLY', tex.outputs['Color'], 1.3), .05))
    intensity = op('POWER', raw, 1.5)
    ramp = new('ShaderNodeValToRGB')
    elements = ramp.color_ramp.elements
    elements[0].position, elements[0].color = 0.0, (.15, .0, .0, 1)
    elements[1].position, elements[1].color = 1.0, (1.0, .82, .45, 1)
    for position, color in ((.2, (.55, .02, .0, 1)), (.45, (.95, .16, .01, 1)),
                            (.7, (1.0, .40, .03, 1)), (.88, (1.0, .64, .14, 1))):
        elements.new(position).color = color
    link(intensity, ramp.inputs['Fac'])
    link(ramp.outputs['Color'], bsdf.inputs['Emission Color'])
    fade = new('ShaderNodeMath')
    fade.name = 'Codex fade'
    fade.operation = 'MULTIPLY'
    fade.inputs[1].default_value = 1.0
    link(op('MINIMUM', op('MULTIPLY', intensity, 2.2), 1.0), fade.inputs[0])
    link(fade.outputs[0], bsdf.inputs['Alpha'])
    link(bsdf.outputs[0], out.inputs['Surface'])
    mat.surface_render_method = 'BLENDED'
    mat.use_backface_culling = False
    mat['additive'] = True
    return mat


def _glow_material(name, image, color, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    fade = nt.nodes.new('ShaderNodeMath')
    fade.name = 'Codex fade'
    fade.operation = 'MULTIPLY'
    fade.inputs[1].default_value = 1.0
    nt.links.new(tex.outputs['Alpha'], fade.inputs[0])
    nt.links.new(fade.outputs[0], bsdf.inputs['Alpha'])
    if color is None:
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    else:
        bsdf.inputs['Emission Color'].default_value = (*color, 1)
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    mat.surface_render_method = 'BLENDED'
    mat.use_backface_culling = False
    mat['additive'] = True
    return mat


# ------------------------------------------------------------ geometry
def _ribbon(name, poses, collection, material):
    """A strip through several poses (lists of (point, half width)), UV U
    along its length; pose 0 is the Basis, the rest become shape keys."""
    n = len(poses[0])

    def build(pose):
        verts = []
        for i, (p, half) in enumerate(pose):
            tangent = pose[min(n-1, i+1)][0] - pose[max(0, i-1)][0]
            if tangent.length < 1e-9:
                tangent = Vector((0, 0, 1))
            tangent.normalize()
            radial = Vector((p.x, p.y, 0))
            across = tangent.cross(radial) if radial.length > 1e-6 else tangent.cross(Vector((1, 0, 0)))
            if across.length < 1e-6:
                across = Vector((1, 0, 0))
            across.normalize()
            verts += [p - across*half, p + across*half]
        return verts

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(build(poses[0]), [], [(2*i, 2*i+1, 2*i+3, 2*i+2) for i in range(n-1)])
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop in poly.loop_indices:
            index = mesh.loops[loop].vertex_index
            uv.data[loop].uv = ((index//2)/(n-1), index % 2)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    collection.objects.link(ob)
    ob.shape_key_add(name='Basis')
    for k, pose in enumerate(poses[1:], 1):
        key = ob.shape_key_add(name=f'Pose_{k:02d}')
        key.data.foreach_set('co', np.array([tuple(v) for v in build(pose)], dtype=np.float32).ravel())
    return ob


def _helix(angle, height, r0, r1, twist, width, lean=0.0, lobe=0.0, n=18):
    """Points of one climbing tongue: it leaves the floor at radius r0, winds
    by `twist` radians while narrowing to r1, leans out with `lean`, and is
    drawn toward the nearer of two lobes (angle 0 or pi) by `lobe`."""
    points = []
    target = 0.0 if math.cos(angle) >= 0 else math.pi
    for i in range(n):
        s = i/(n-1)
        theta = angle + twist*s
        if lobe:
            delta = math.atan2(math.sin(target-theta), math.cos(target-theta))
            theta += lobe*s*delta
        r = r0 + (r1-r0)*s + lean*s*s
        half = width*(1-.8*s)*(.55+.45*math.sin(math.pi*min(1.0, s*1.6))**.5)
        points.append((Vector((r*math.cos(theta), r*math.sin(theta), height*s)), max(half, 1e-4)))
    return points


def _disk(name, radius, material, collection, inner=0.0, segments=64):
    verts = []
    if inner <= 0:
        verts.append((0, 0, 0))
        verts += [(radius*math.cos(math.tau*i/segments), radius*math.sin(math.tau*i/segments), 0)
                  for i in range(segments)]
        faces = [(0, 1+i, 1+(i+1) % segments) for i in range(segments)]
    else:
        for i in range(segments):
            a = math.tau*i/segments
            verts += [(inner*math.cos(a), inner*math.sin(a), 0), (radius*math.cos(a), radius*math.sin(a), 0)]
        faces = [(2*i, 2*i+1, 2*((i+1) % segments)+1, 2*((i+1) % segments)) for i in range(segments)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop, index in zip(poly.loop_indices, poly.vertices):
            x, y, _ = verts[index]
            uv.data[loop].uv = (.5+.5*x/radius, .5+.5*y/radius)
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    collection.objects.link(ob)
    return ob


def _spark(name, material, collection):
    s = .012
    verts = [(-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s), (0, -s, -s), (0, s, -s), (0, s, s), (0, -s, s)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [(0, 1, 2, 3), (4, 5, 6, 7)])
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        for loop, corner in zip(poly.loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
            uv.data[loop].uv = corner
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    collection.objects.link(ob)
    return ob


def _key_fade(material, times, fps, fn):
    fade = material.node_tree.nodes['Codex fade'].inputs[1]
    for t in times:
        fade.default_value = fn(t)
        fade.keyframe_insert('default_value', frame=1+t*fps)


def _key_scroll(material, times, fps, speed, offset=0.0):
    location = material.node_tree.nodes['Codex scroll'].inputs['Location']
    for t in times:
        location.default_value = (-(offset+speed*t), 0, 0)
        location.keyframe_insert('default_value', frame=1+t*fps)


def _key_poses(ob, times, fps, beats, poses):
    keys = ob.data.shape_keys.key_blocks
    for t in times:
        weights = _beat_weights(t, beats, poses)
        for k in range(1, poses):
            keys[k].value = weights[k]
            keys[k].keyframe_insert('value', frame=1+t*fps)


# ------------------------------------------------------------ the effect
def build_rise_column(scene, fps=24, duration=3.0):
    """Add the whole rise effect to `scene`, keyed over the Emerge clip."""
    rng = random.Random(SEED)
    collection = bpy.data.collections.new('Codex_Emerge_RiseColumn')
    scene.collection.children.link(collection)
    times = [i/fps for i in range(int(duration*fps)+1)]
    veins = _veins_image()
    swirl_image = _swirl_image()
    dot = _dot_image()

    # The floor: a lava swirl opens and turns, hot during the column, then
    # cools to a dim glow while the creature stands.
    swirl_mat = _glow_material('CodexFX_Rise_Swirl', swirl_image, None, 2.6)
    swirl = _disk('Codex_Rise_Swirl', PIT_RADIUS, swirl_mat, collection)
    swirl.location.z = .002
    for t in times:
        grow = .35 + .65*_smooth(t/.18)
        swirl.scale = (grow, grow, 1)
        swirl.rotation_euler = (0, 0, -2.4*t)
        swirl.keyframe_insert('scale', frame=1+t*fps)
        swirl.keyframe_insert('rotation_euler', frame=1+t*fps)
    _key_fade(swirl_mat, times, fps, lambda t: _smooth(t/.08)*(1-.8*_smooth((t-1.2)/1.5)))

    # A shock ring runs out over the floor with the burst.
    ring_mat = _glow_material('CodexFX_Rise_Ring', dot, (1.0, .55, .16), 3.0)
    ring = _disk('Codex_Rise_Ring', 1.0, ring_mat, collection, inner=.9)
    ring.location.z = .003
    for t in times:
        s = .3 + 1.1*_smooth(t/.45)
        ring.scale = (s, s, 1)
        ring.keyframe_insert('scale', frame=1+t*fps)
    _key_fade(ring_mat, times, fps, lambda t: 1-_smooth(t/.45))

    # The crown: small flames round the pit licking outward, first to light
    # and last to die.
    crown_mat = _fire_material('CodexFX_Rise_Crown', veins, 1.2)
    for i in range(20):
        a = math.tau*i/20 + rng.uniform(-.08, .08)
        tall = rng.uniform(.8, 1.2)

        def tongue(height, width, out, a=a):
            points = []
            for j in range(10):
                s = j/9
                r = .34 + out*s
                half = width*(1-.85*s)
                points.append((Vector((r*math.cos(a+.25*s), r*math.sin(a+.25*s),
                                       height*math.sin(math.pi*.5*s))), max(half, 1e-4)))
            return points
        poses = [tongue(.004, .001, .02), tongue(.10*tall, .035, .10), tongue(.20*tall, .045, .06)]
        ob = _ribbon(f'Codex_Rise_Crown{i:02}', poses, collection, crown_mat)
        _key_poses(ob, times, fps, CROWN_BEATS, 3)
    _key_scroll(crown_mat, times, fps, 2.2)
    _key_fade(crown_mat, times, fps, lambda t: 1-_smooth((t-FIRE_END+.3)/.3))

    # The column: tongues winding up round the body, and a tighter core.
    column_mat = _fire_material('CodexFX_Rise_Column', veins, 1.1)
    core_mat = _fire_material('CodexFX_Rise_Core', veins, 1.6)
    for i in range(22):
        core = i >= 16
        count = 6 if core else 16
        a = math.tau*(i-16 if core else i)/count + rng.uniform(-.1, .1)
        k = rng.uniform(.9, 1.12)
        if core:
            poses = [_helix(a, .02, .05, .05, 0, .001),
                     _helix(a, .50*k, .07, .03, 3.0, .05),
                     _helix(a, 1.05*k, .06, .02, 5.0, .06),
                     _helix(a, 1.25*k, .09, .04, 4.4, .07),
                     _helix(a, .85*k, .10, .10, 2.4, .05, lean=.18, lobe=.5),
                     _helix(a, .20*k, .10, .12, 1.0, .04)]
        else:
            poses = [_helix(a, .02, .30, .30, 0, 0.002),
                     _helix(a, .42*k, .30, .14, 1.7, 0.128),
                     _helix(a, .92*k, .27, .07, 3.2, 0.145),
                     _helix(a, 1.12*k, .33, .16, 2.6, 0.170),
                     _helix(a, .90*k, .30, .30, 1.5, 0.153, lean=.30, lobe=.55),
                     _helix(a, .30*k, .34, .40, .6, 0.111)]
        ob = _ribbon(f'Codex_Rise_{"Core" if core else "Tongue"}{i:02}', poses, collection,
                     core_mat if core else column_mat)
        _key_poses(ob, times, fps, COLUMN_BEATS, 6)
        spin = (3.4 if core else 1.6) * (1 if i % 2 == 0 else .85)
        for t in times:
            ob.rotation_euler = (0, 0, spin*t)
            ob.keyframe_insert('rotation_euler', frame=1+t*fps)
    _key_scroll(column_mat, times, fps, 2.6)
    _key_scroll(core_mat, times, fps, 3.6, .4)
    _key_fade(column_mat, times, fps, lambda t: 1-_smooth((t-FIRE_END+.25)/.25))
    _key_fade(core_mat, times, fps, lambda t: 1-_smooth((t-1.3)/.3))

    # Sparks thrown up and out by the burst, falling back and dying.
    spark_mat = _glow_material('CodexFX_Rise_Spark', dot, (1.0, .6, .18), 6.0)
    for i in range(48):
        ob = _spark(f'Codex_Rise_Spark{i:02}', spark_mat, collection)
        a = rng.uniform(0, math.tau)
        speed = rng.uniform(.3, .9)
        up = rng.uniform(1.6, 3.4)
        born = rng.uniform(0, .6)
        life = rng.uniform(.6, 1.2)
        for t in times:
            age = t-born
            k = max(0.0, age)
            r = .15 + speed*k
            size = (1-_smooth(k/life)) if 0 < age < life else 0.0
            ob.location = (r*math.cos(a+1.4*k), r*math.sin(a+1.4*k), max(.01, .05 + up*k - 2.9*k*k))
            ob.scale = (max(size, 1e-3),)*3
            ob.keyframe_insert('location', frame=1+t*fps)
            ob.keyframe_insert('scale', frame=1+t*fps)
    _key_fade(spark_mat, times, fps, lambda t: 1-.5*_smooth(t/2.0))

    # The fire lights its surroundings, then only the cooling pit does.
    data = bpy.data.lights.new('Codex_Rise_Light', 'POINT')
    data.color = (1.0, .45, .12)
    data.shadow_soft_size = .3
    light = bpy.data.objects.new('Codex_Rise_Light', data)
    collection.objects.link(light)
    light.location = (0, 0, .4)
    for t in times:
        data.energy = 10 + 120*_fire(t)*(1+.15*math.sin(math.tau*8*t)) + 40*math.exp(-t/.1)
        data.keyframe_insert('energy', frame=1+t*fps)

    # The fire stands round the curled body, not round the rig's origin: an
    # empty at the body's centre carries every piece of the effect.
    scene.frame_set(1)
    depsgraph = scene.view_layers[0].depsgraph
    depsgraph.update()
    points = []
    for ob in scene.objects:
        if ob.type == 'MESH' and ob.name.startswith('Pyrefang_') and '_FX_' not in ob.name:
            evaluated = ob.evaluated_get(depsgraph)
            coords = np.empty(len(evaluated.data.vertices)*3, dtype=np.float32)
            evaluated.data.vertices.foreach_get('co', coords)
            matrix = np.array(evaluated.matrix_world)
            points.append(coords.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3])
    centre = np.concatenate(points).mean(axis=0) if points else np.zeros(3)
    origin = bpy.data.objects.new('Codex_Rise_Origin', None)
    collection.objects.link(origin)
    origin.location = (float(centre[0]), float(centre[1]), 0.0)
    for ob in collection.objects:
        if ob is not origin:
            ob.parent = origin

    # The Codex convention: every effect action is named CodexFX_*.
    for ob in collection.objects:
        holders = [ob, ob.data]
        if ob.type == 'MESH' and ob.data.shape_keys:
            holders.append(ob.data.shape_keys)
        for index, holder in enumerate(holders):
            if holder is not None and holder.animation_data and holder.animation_data.action:
                suffix = ('', '_Data', '_Poses')[index]
                holder.animation_data.action.name = 'CodexFX_Rise_' + ob.name[len('Codex_Rise_'):] + suffix
    for mat in {slot.material for ob in collection.objects for slot in ob.material_slots}:
        tree = mat.node_tree
        if tree.animation_data and tree.animation_data.action:
            tree.animation_data.action.name = mat.name + '_Radiance'
    return {'objects': len(collection.objects), 'fire_end_s': FIRE_END, 'tongues': 22,
            'crown': 20, 'sparks': 48, 'centre_xy_m': [float(centre[0]), float(centre[1])]}

"""Independent Pyrefang animation study. No source actions are read or sampled.

Run with Blender in background mode, without a startup blend:
  blender -b --factory-startup --python scripts/build_pyrefang_codex.py -- --build
  blender -b --factory-startup --python scripts/build_pyrefang_codex.py -- --stills
  blender -b --factory-startup --python scripts/build_pyrefang_codex.py -- --render

Only the model collection and its rest rig are appended from the original file.
All incoming animation data is detached before evaluation. Outputs live in a
separate codex directory. This script never saves to the original blend.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pyrefang_codex_skin import repair_body
from pyrefang_codex_hind_refit import refit_right_hind
from pyrefang_codex_legs import LegSolver
from pyrefang_codex_tail_skin import soften_tail
from pyrefang_codex_tail_rig import apply_tail_curve
from pyrefang_codex_tail_motion import tail_direction
from pyrefang_codex_idle import FORE_UNDER, HIND_UNDER, idle_controls
from pyrefang_codex_walk import WALK_DURATION, walk_controls, walk_event_times
from pyrefang_codex_curves import smooth_loop, smooth_tail, smooth_walk
from pyrefang_codex_vfx import animate_effects
from pyrefang_codex_rise_column import build_rise_column

SOURCE = ROOT / 'art_src/models_raw/pyrefang/pyrefang_segmented.blend'
OUT = SOURCE.parent / 'codex'
FPS = 24
TAU = math.tau
CLIPS = {'Idle': 10.0, 'Walk': WALK_DURATION, 'Attack': 1.4, 'Roar': 1.5, 'Rise': 2.5,
         'Emerge': 3.0, 'Death': 3.0}
RIG = None
BODY = []
REST = {}
LEGS = None


def smooth(v):
    v = max(0.0, min(1.0, v))
    return v * v * v * (v * (6 * v - 15) + 10)


def track(t, points):
    if t <= points[0][0]:
        return points[0][1]
    for (a, x), (b, y) in zip(points, points[1:]):
        if t <= b:
            return x + (y - x) * smooth((t - a) / (b - a))
    return points[-1][1]


def pulse(t, a, b, c):
    return track(t, [(a, 0), (b, 1), (c, 0)])


def rot(name, x=0, y=0, z=0):
    RIG.pose.bones[name].rotation_euler = tuple(math.radians(v) for v in (x, y, z))


def move(name, world_delta):
    RIG.pose.bones[name].location = REST[name].to_3x3().inverted() @ Vector(world_delta)


def reset():
    for pb in RIG.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.matrix_basis = Matrix.Identity(4)


def mesh_points(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    coords = np.empty(len(ev.data.vertices) * 3, dtype=np.float32)
    ev.data.vertices.foreach_get('co', coords)
    mat = np.array(ev.matrix_world)
    return coords.reshape(-1, 3) @ mat[:3, :3].T + mat[:3, 3]


def lowest(objects=None):
    return min(float(mesh_points(ob)[:, 2].min()) for ob in (objects or BODY))


def orient_segment(name, head, tip):
    """Align a rest bone to an analytically solved segment without stretching."""
    bone = RIG.data.bones[name]
    rest_axis = bone.tail_local - bone.head_local
    q = rest_axis.rotation_difference(tip - head)
    mat = (q.to_matrix() @ REST[name].to_3x3()).to_4x4()
    mat.translation = head
    RIG.pose.bones[name].matrix = mat
    bpy.context.view_layer.update()


def leg(side, front, delta=(0, 0, 0), toe=0, shoulder_offset=(0, 0, 0)):
    LEGS.pose(side, front, delta, toe, shoulder_offset)


# Claw tips of a tucked leg, from its hip joint in the turned hip frame.
EMERGE_TUCK = {('L', False): (.000, -.060, 0)}


def emerge_legs(feet):
    """Blend each leg between its folded place under the curled body and its
    standing place. The folded place rides the posed girdle, so the paws
    follow the C of the spine instead of staying on their standing prints."""
    for (side, front), (fold, lift, pitch) in feet.items():
        sign = 1 if side == 'L' else -1
        under = FORE_UNDER if front else HIND_UNDER
        rest = LEGS.rest_toe(side, front)
        stand = Vector((rest.x + under[0], rest.y + under[1], rest.z + under[2]))
        girdle = 'Chest' if front else 'Hips'
        turn = (RIG.pose.bones[girdle].matrix @ REST[girdle].inverted()).to_3x3()
        joint = RIG.pose.bones[side + ('_UpperArm' if front else '_Thigh')].head
        rest_joint = RIG.data.bones[side + ('_UpperArm' if front else '_Thigh')].head_local
        # The folded place is the paw's own standing print, carried round by
        # its girdle's turn: the legs fold under a body lying on its belly,
        # the way the Death clip lays it down, and follow the C of the spine.
        offset = stand - rest_joint
        offset.z = 0
        if (side, front) in EMERGE_TUCK:
            # The outer hind leg of the C lies along the flank, its paw drawn
            # forward under the belly instead of swinging out with the hip.
            offset = Vector(EMERGE_TUCK[(side, front)])
        folded = joint + turn @ offset
        folded.z = stand.z
        toe = stand.lerp(folded, fold)
        toe.z += lift
        # The folded paw lies flat and points where its girdle points.
        ahead = turn @ Vector((0, -1, 0))
        heading = math.degrees(math.atan2(ahead.x, -ahead.y))
        # The knee and elbow bend in the girdle's turned plane; a tucked leg
        # folds its knee in against the flank instead of out.
        bias = -.10 if (side, front) in EMERGE_TUCK else .12
        pole = turn @ Vector((sign*bias, 1 if front else -1, 0))
        LEGS.pose_toe(side, front, toe, pitch, paw_yaw=fold*heading,
                      pole=pole.lerp(Vector((sign*.12, 1 if front else -1, 0)), 1-fold))


def neutral(t, breathing=1):
    breath = math.sin(TAU * t / 3) * breathing
    move('Hips', (0, 0, -0.026 + 0.0018 * breath))
    rot('Spine', -1.2 * breath)
    rot('Chest', -0.8 * breath)
    rot('Neck01', 1.0 * breath)
    rot('Neck02', 0.6 * breath)
    rot('Head', 0.4 * breath)
    rot('Jaw', 1.4 + 0.7 * breath)


def pose(clip, t):
    reset()
    end = CLIPS[clip]
    life = 1 if clip in ('Idle', 'Walk') else math.sin(math.pi * min(1, t / end)) ** 2
    neutral(t if clip in ('Idle', 'Walk') else 0, life)
    targets = {(s, f): [0, 0, 0] for s in ('L', 'R') for f in (True, False)}
    toes = {k: 0 for k in targets}
    shoulder_offsets = {}
    use_ik = True

    if clip == 'Idle':
        controls = idle_controls(t)
        move('Hips', controls['hips'])
        for name, angles in controls['rotations'].items():
            rot(name, *angles)
        RIG.pose.bones['Chest'].scale = controls['chest_scale']
        targets.update(controls['paws'])
        toes.update(controls['toes'])

    elif clip == 'Walk':
        controls = walk_controls(t, end)
        move('Hips', controls['hips'])
        for name, angles in controls['rotations'].items():
            rot(name, *angles)
        shoulder_offsets = controls['shoulder_offsets']
        # The walk places the claw tips and pitches each paw about them.
        use_ik = False
        bpy.context.view_layer.update()
        for (side, front), (offset, pitch) in controls['feet'].items():
            rest = LEGS.rest_toe(side, front)
            toe = (rest.x+offset[0], offset[1], offset[2])
            LEGS.pose_toe(side, front, toe, pitch, shoulder_offsets.get(side, (0, 0, 0)))

    elif clip == 'Attack':
        # Revision 16: a readable, telegraphed bite. The body loads back onto
        # the haunches with the neck cocked and the maw opening, lunges with
        # a fore paw step, snaps shut at exactly 0.55 s, tears with two head
        # shakes, then walks its weight back to the idle start pose.
        coil = track(t, [(0, 0), (.06, 0), (.36, 1), (.44, .85), (.52, 0), (end, 0)])
        lunge = track(t, [(0, 0), (.38, 0), (.53, 1), (.72, .95), (1.18, 0), (end, 0)])
        tear = (pulse(t, .56, .63, .70) - pulse(t, .66, .73, .80)
                + .5*pulse(t, .76, .82, .88))
        settle = pulse(t, 1.0, 1.14, 1.32)
        move('Hips', (.004*coil, .032*coil - .090*lunge,
                      -.026 - .022*coil - .014*lunge + .003*settle))
        rot('Hips', 3*coil - 2*lunge, 0, 2*coil)
        rot('Spine', 5*coil + 2*lunge, 0, 2.5*coil)
        rot('Chest', 6*coil + 6*lunge, 0, -1.5*coil)
        rot('Neck01', -15*coil + 14*lunge, 0, -2*coil + 3*tear)
        rot('Neck02', -6*coil - 10*lunge, 0, 5*tear)
        rot('Head', -3*coil + 2*lunge + 2*settle, 4*tear, 9*tear)
        jaw = track(t, [(0, 1.4), (.14, 1.4), (.34, 30), (.49, 44), (.535, 38),
                        (.55, .2), (.62, 0), (.78, 4), (1.10, 1.4), (end, 1.4)])
        rot('Jaw', jaw)
        # The near fore paw reaches with the lunge and walks back after it.
        step_out = track(t, [(0, 0), (.36, 0), (.52, 1), (1.02, 1), (1.26, 0), (end, 0)])
        lift = pulse(t, .36, .44, .53) + pulse(t, 1.02, 1.13, 1.26)
        targets[('L', True)] = [0, -.090*step_out, .032*lift]
        toes[('L', True)] = 30*lift

    elif clip == 'Roar':
        # Revision 16: head down to gather, then the chest rears with a fore
        # paw raised, the maw opens wide and trembles while the head sweeps,
        # and the paw stamps down before the body settles.
        gather = pulse(t, 0, .24, .44)
        rear = track(t, [(0, 0), (.24, 0), (.50, 1), (1.02, .92), (1.28, .08), (end, 0)])
        sweep = track(t, [(0, 0), (.50, 0), (.62, -1), (1.00, 1), (1.24, 0), (end, 0)])
        roar = track(t, [(0, 0), (.42, 0), (.56, 1), (1.02, 1), (1.20, 0), (end, 0)])
        tremor = roar*math.sin(TAU*13*t)
        stamp = pulse(t, 1.04, 1.13, 1.30)
        move('Hips', (0, .026*rear - .006*gather, -.026 - .014*gather - .017*rear - .006*stamp))
        rot('Hips', -6*rear, 0, 0)
        rot('Spine', 3*gather - 9*rear)
        rot('Chest', 3*gather - 9*rear + .8*tremor, 0, 2*sweep)
        rot('Neck01', 8*gather - 14*rear, 0, 3*sweep)
        rot('Neck02', 6*gather - 12*rear, 0, 5*sweep)
        rot('Head', 6*gather - 6*rear + 1.2*tremor, 2*sweep, 6*sweep)
        rot('Jaw', 1.4 + 6*gather + 46*roar + 3*tremor)
        paw = pulse(t, .34, .62, 1.10)
        targets[('R', True)] = [-.004*paw, -.035*paw, .075*paw]
        toes[('R', True)] = 42*paw

    elif clip == 'Rise':
        stand = track(t, [(0, 0), (.27, 0), (.80, .36), (1.35, 1), (end, 1)])
        shoulders = track(t, [(0, 0), (.26, 0), (.80, 1), (end, 1)])
        stretch = pulse(t, 1.30, 1.65, 2.20)
        wake = pulse(t, .06, .30, .60)
        move('Hips', (0, .02 * (1 - stand), -.026 - .135 * (1 - stand)))
        rot('Spine', -9 * (shoulders - stand) - 1.8 * stretch)
        rot('Chest', -6 * (shoulders - stand) - 1.5 * stretch)
        rot('Neck01', 9 * (1 - shoulders) - 4 * stretch)
        rot('Neck02', 8 * (1 - shoulders) - 7 * stretch - 4 * wake)
        rot('Head', 7 * (1 - shoulders) - 2 * stretch + 1.8 * wake)
        rot('Jaw', 1.4 + 3 * wake + 26 * pulse(t, 1.28, 1.62, 2.02))
        # Revision 16: a yawn in the stretch, then a shake runs from the
        # shoulders to the head, shedding embers before the idle start.
        shake = pulse(t, 1.86, 2.02, 2.36) * math.sin(TAU * 6.5 * (t - 1.86))
        head_shake = pulse(t, 1.92, 2.08, 2.42) * math.sin(TAU * 6.5 * (t - 1.92))
        RIG.pose.bones['Chest'].rotation_euler[1] += math.radians(7 * shake)
        RIG.pose.bones['Spine'].rotation_euler[1] += math.radians(4 * shake)
        RIG.pose.bones['Neck02'].rotation_euler[2] += math.radians(8 * head_shake)
        RIG.pose.bones['Head'].rotation_euler[1] += math.radians(10 * head_shake)
        for key in targets:
            tuck = (1 - shoulders) if key[1] else (1 - stand)
            targets[key][1] = .035 * tuck if key[1] else -.018 * tuck
        targets[('L', True)][2] = .022 * pulse(t, .27, .43, .65)
        targets[('R', False)][2] = .016 * pulse(t, .88, 1.04, 1.25)

    elif clip == 'Emerge':
        # Revision 16: the rise out of the ring's lava pit (CONTEXT.md, Ring).
        # It starts as a curled ember ball asleep: belly on the floor, the
        # spine bent into a C, the head brought back to the right hip, all four
        # legs folded under the body and the tail lying round to the muzzle.
        # It breathes twice, lifts its head slowly with a yawn, unwinds, sets
        # its fore paws down one after the other, steps its hind paws out of
        # the fold as the haunch rises, and lands on the idle start pose,
        # which is also the Roar start.
        # Breathing only lifts the curled body off its resting belly.
        breath = (.5 - .5*math.cos(TAU * t / .9)) * track(t, [(0, 1), (.9, 1), (1.4, 0), (end, 0)])
        curl = track(t, [(0, 1), (.9, 1), (2.1, 0), (end, 0)])
        uncoil = track(t, [(0, 1), (.75, 1), (1.65, 0), (end, 0)])
        haunch = track(t, [(0, 1), (1.9, 1), (2.7, 0), (end, 0)])
        push = pulse(t, 1.7, 2.2, 2.7)
        land = pulse(t, 2.55, 2.72, 2.95)
        move('Hips', (0, .010*haunch,
                      -.026 - .142*haunch + .003*breath + .005*push - .004*land))
        rot('Hips', 4*curl - 3*push, 0, 24*curl)
        rot('Spine', 4*curl - 1.2*breath - 4*push, 0, 30*curl)
        rot('Chest', 4*curl - 1.0*breath - 5*push + 2*land, 0, 28*curl)
        rot('Neck01', -20*uncoil - 5*push, 0, 34*uncoil)
        rot('Neck02', 4*uncoil - 6*push, 0, 30*uncoil)
        rot('Head', 10*uncoil - 6*push + 3*land, 10*uncoil, 22*uncoil)
        rot('Jaw', 1.4 + 24*pulse(t, 1.0, 1.35, 1.85))
        emerge_feet = {}
        for key in targets:
            side, front = key
            if front:
                # Each fore paw lifts out of the tuck and plants, left first.
                a = 1.45 if side == 'L' else 1.75
                plant = track(t, [(0, 0), (a, 0), (a+.40, 1), (end, 1)])
                lift = pulse(t, a, a+.18, a+.40)
                emerge_feet[key] = (1-plant, .040*lift, 24*lift)
            else:
                # A hind paw steps out of the fold while the haunch rises,
                # the tucked left one first, instead of sliding on the floor.
                a = 1.95 if side == 'L' else 2.25
                step = pulse(t, a, a+.18, a+.42)
                fold = track(t, [(0, 1), (a, 1), (a+.42, 0), (end, 0)])
                emerge_feet[key] = (fold, .032*step, 18*step)
        use_ik = False

    elif clip == 'Death':
        hit = pulse(t, 0, .12, .40)
        front = track(t, [(0, 0), (.36, 0), (.90, 1), (end, 1)])
        sink = track(t, [(0, 0), (.45, 0), (.96, .40), (1.40, 1), (end, 1)])
        headfall = track(t, [(0, 0), (.93, 0), (1.87, 1), (2.03, .97), (2.19, 1), (end, 1)])
        last = pulse(t, 2.18, 2.35, 2.65)
        # Forelegs give way first, hindquarters follow. The pelvis never rolls.
        pelvis_pitch = -2 * hit + 3 * sink
        move('Hips', (.002 * hit, .014 * hit - .008 * sink,
                      -.026 - .146 * sink + .001 * last))
        rot('Hips', pelvis_pitch, .8 * hit, 1.2 * hit)
        rot('Spine', -3 * hit + 12 * front - 8 * sink - .4 * last)
        rot('Chest', -3 * hit + 5 * front - 3 * sink - .3 * last)
        rot('Neck01', -12 * hit + 5 * front + 5 * headfall)
        rot('Neck02', -12 * hit + 3 * headfall, 0, 3 * headfall)
        rot('Head', -14 * hit + 4 * headfall, 3 * hit, 4 * headfall)
        rot('Jaw', 1.4 + 30 * hit + 2.5 * headfall - .5 * last)
        # Paws slide a short distance while the elbows fold, then stay still.
        for (side, is_front) in targets:
            sign = 1 if side == 'L' else -1
            if is_front:
                settle = track(t, [(0, 0), (.40, 0), (1.15, 1), (end, 1)])
                targets[(side, is_front)] = [sign * .012 * settle, 0, 0]
            else:
                targets[(side, is_front)] = [sign * .020 * sink, -.048 * sink,
                                            .006 * sink if side == 'R' else 0]

    bpy.context.view_layer.update()
    if clip == 'Emerge':
        emerge_legs(emerge_feet)
    if use_ik:
        for (side, front), delta in targets.items():
            # Every clip stands on the same planted stance, paws under the body.
            delta = [a+b for a, b in zip(delta, FORE_UNDER if front else HIND_UNDER)]
            leg(side, front, delta, toes[(side, front)], shoulder_offsets.get(side, (0, 0, 0)))
    bpy.context.view_layer.update()
    lengths = [RIG.data.bones[f'Tail{i:02}'].length for i in range(1, 9)]
    total = sum(lengths)
    distance = 0.0
    directions = []
    for length in lengths:
        directions.append(tail_direction(clip, t, (distance + length*.5) / total))
        distance += length
    apply_tail_curve(RIG, directions)
    bpy.context.view_layer.update()
    # Correct only residual sole penetration. Large collapse contacts use the
    # entire deformed body, including jaw and tail, without a guessed floor.
    zmin = lowest()
    correction = max(0, .001 - zmin)
    if correction:
        move('Root', (0, 0, correction))
        bpy.context.view_layer.update()
    return correction


def init_source():
    global RIG, BODY, REST, LEGS
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with bpy.data.libraries.load(str(SOURCE), link=False) as (src, dest):
        if 'Pyrefang' not in src.collections:
            raise RuntimeError('The Pyrefang model collection is missing')
        dest.collections = ['Pyrefang']
    collection = dest.collections[0]
    bpy.context.scene.collection.children.link(collection)
    # Clear incoming keys, drivers and NLA before updating the dependency graph.
    for ob in collection.all_objects:
        ob.animation_data_clear()
        if ob.type == 'MESH' and ob.data.shape_keys:
            ob.data.shape_keys.animation_data_clear()
            for key in ob.data.shape_keys.key_blocks:
                key.value = 0
        if ob.data and hasattr(ob.data, 'animation_data_clear'):
            ob.data.animation_data_clear()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    RIG = bpy.data.objects['PyrefangRig']
    RIG.animation_data_clear()
    RIG.location = (0, 0, 0)
    RIG.rotation_euler = (0, 0, 0)
    RIG.scale = (1, 1, 1)
    BODY = [ob for ob in collection.all_objects if ob.type == 'MESH' and not ob.name.startswith('Pyrefang_FX')]
    reset()
    bpy.context.view_layer.update()
    # The right hind bones must sit on their mesh before REST is captured.
    hind_refit = refit_right_hind(RIG, BODY)
    REST = {b.name: b.matrix_local.copy() for b in RIG.data.bones}
    report = repair_body(RIG, BODY)
    report['hind_refit'] = hind_refit
    report['tail_surface'] = soften_tail(RIG, BODY)
    LEGS = LegSolver(RIG, BODY)
    report['limb_solver'] = LEGS.report()
    return report


def material(name, color, metallic=0, rough=.5):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    return mat


def point_at(ob, point):
    ob.rotation_euler = (Vector(point) - ob.location).to_track_quat('-Z', 'Y').to_euler()


def stage():
    scene = bpy.context.scene
    scene.name = 'Pyrefang - Codex Study'
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('Codex Studio')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.035, .047, .070, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .4
    scene.view_settings.view_transform = 'AgX'
    # Unobtrusive plinth with a contact reference and readable shadows.
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=.91, depth=.035, location=(0, .05, -.0185))
    plinth = bpy.context.object
    plinth.name = 'Codex_Stage'
    plinth.data.materials.append(material('Codex Basalt', (.052, .072, .092), .45, .38))
    bevel = plinth.modifiers.new('Soft edge', 'BEVEL')
    bevel.width, bevel.segments = .012, 3
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.040))
    bpy.context.object.name = 'Codex_Backdrop'
    bpy.context.object.data.materials.append(material('Codex Background', (.013, .020, .031), .1, .7))
    for name, pos, power, color, size in [
        ('Key', (1.1, -.9, 1.6), 90, (1, .74, .50), 1.6),
        ('Fill', (-1, -.4, .9), 65, (.40, .65, 1), 1.2),
        ('Rim', (.15, 1.1, 1.5), 130, (1, .26, .075), 1.0),
    ]:
        data = bpy.data.lights.new('Codex_' + name, 'AREA')
        data.energy, data.color, data.shape, data.size = power, color, 'DISK', size
        ob = bpy.data.objects.new('Codex_' + name, data)
        scene.collection.objects.link(ob)
        ob.location = pos
        point_at(ob, (0, 0, .25))
    data = bpy.data.cameras.new('Codex_Camera')
    cam = bpy.data.objects.new('Codex_Camera', data)
    scene.collection.objects.link(cam)
    cam.location = (1.55, -1.35, .98)
    point_at(cam, (0, .02, .27))
    data.type, data.ortho_scale = 'ORTHO', 1.76
    scene.camera = cam
    # Hide bone overlays on opening. The action remains editable in Dope Sheet.
    RIG.show_in_front = False
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.region_3d.view_camera_zoom = 0
                area.spaces.active.shading.type = 'MATERIAL'
                area.spaces.active.overlay.show_overlays = False


def bake():
    OUT.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    skin_report = init_source()
    stage()
    report = {'source_sha256': digest, 'fps': FPS, 'source_actions_used': False,
              'skin_repair': skin_report, 'clips': {}}
    for clip, duration in CLIPS.items():
        action = bpy.data.actions.new('Codex_' + clip)
        action.use_fake_user = True
        action['author'] = 'Codex'
        action['loop'] = clip in ('Idle', 'Walk')
        action['duration'] = duration
        action['source'] = 'Independently authored from the rest mesh and rig; no source animation curves'
        if clip == 'Attack':
            action['release'] = .55
        RIG.animation_data_create()
        RIG.animation_data.action = action
        # Fast lunges and rears need denser keys to keep planted soles planted.
        sample_rate = FPS*3 if clip in ('Walk', 'Attack', 'Roar', 'Emerge') else FPS
        times = {i / sample_rate for i in range(math.floor(duration * sample_rate) + 1)}
        times.add(duration)
        if clip == 'Walk':
            events = walk_event_times(duration)
            # Replace nearby grid samples with the exact contact times.
            # Near-duplicate keys amplify float32 Bezier handle rounding.
            times = {t for t in times if all(abs(t-event) >= .5/sample_rate
                                           for event in events)}
            times.update(events)
        if clip == 'Attack':
            times.add(.55)
        if clip == 'Death':
            times.add(2.7)
        stats = []
        endpoints = []
        for t in sorted(times):
            lift = pose(clip, t)
            stats.append(lift)
            for pb in RIG.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=1 + t * FPS, group=pb.name)
                pb.keyframe_insert('location', frame=1 + t * FPS, group=pb.name)
                pb.keyframe_insert('scale', frame=1 + t * FPS, group=pb.name)
            if t == 0 or t == duration:
                endpoints.append({pb.name: list(pb.rotation_euler) + list(pb.location) for pb in RIG.pose.bones})
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        for key in fc.keyframe_points:
                            key.interpolation = 'LINEAR'
        if clip == 'Idle':
            smooth_loop(action)
        elif clip == 'Walk':
            smooth_walk(action)
        else:
            smooth_tail(action,
                        still_frame=1+2.7*FPS if clip == 'Death' else None)
        action.use_frame_range = True
        action.frame_start, action.frame_end = 1, 1 + duration * FPS
        loop_error = max(abs(a-b) for name in endpoints[0] for a,b in zip(endpoints[0][name], endpoints[1][name]))
        report['clips'][clip] = {'duration': duration, 'keyed_samples': len(times), 'max_ground_correction_m': max(stats), 'endpoint_difference': loop_error}
        print('CODEX_CLIP', clip, report['clips'][clip], flush=True)
    RIG.animation_data.action = bpy.data.actions['Codex_Idle']
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, int(CLIPS['Idle'] * FPS)
    scene.frame_set(1)
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    for name, frame in [('Idle | 10 sec', 1), ('Notice', 118), ('Weight shift', 185), ('Settle', 220)]:
        scene.timeline_markers.new(name, frame=frame)
    # Self-contained packed materials and an embedded guide for the .blend.
    guide = bpy.data.texts.new('READ ME - Codex animations')
    guide.write('PYREFANG / CODEX - REVISION 16\nChoose one of the six Codex scenes in the top bar, then press Space to preview.\nEach scene has its own rig and duration. No source animations are present.\nEditable actions: Codex_Idle, Walk, Attack, Roar, Rise, Death. 24 fps.\nDurations: 10 / 1.333333 / 1.4 / 1.5 / 2.5 / 3 seconds. Attack release: 0.55 seconds.\nRevision 15 repairs quantized skin seams across all six clips, including the neck collar. The separate jaw remains free to open. Revision 16 refits the right hind leg bones onto their mesh and reauthors the walk as a feline gait: long strides, paws peeling off on their claw tips and hanging during the swing, rolling shoulder blades.\nThe tail uses a spatial curve controller, parallel transport and B-Bone skin.\nThin flame continuation follows the same curve with a delayed tip.\nSource animation curves were removed before evaluating the rest rig.\nOriginal source blend and previews are untouched. Browser previews: index.html.\n')
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    RIG.select_set(True)
    bpy.context.view_layer.objects.active = RIG
    make_clip_scenes()
    for clip, duration in CLIPS.items():
        clip_scene = bpy.data.scenes['Codex_' + clip]
        clip_rig = next(ob for ob in clip_scene.objects if ob.type == 'ARMATURE')
        report['clips'][clip]['effects'] = animate_effects(clip_scene, clip_rig, clip, duration, FPS)
        print('CODEX_EFFECTS', clip, flush=True)
    # The fire column the creature rises from, around the Emerge clip.
    report['clips']['Emerge']['rise_column'] = build_rise_column(bpy.data.scenes['Codex_Emerge'], FPS,
                                                                  CLIPS['Emerge'])
    bpy.context.window.scene = scene
    scene.frame_set(1)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'pyrefang_codex.blend'))
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == digest, 'Source file changed'
    (OUT / 'build_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    # The local review gallery, when this checkout has it.
    gallery = ROOT / 'scripts/pyrefang_codex_gallery.html'
    if gallery.exists():
        shutil.copyfile(gallery, OUT / 'index.html')


def make_clip_scenes():
    """One ready-to-play scene per clip; no manual action/range setup needed."""
    base = bpy.context.scene
    base.name = 'Codex_Idle'
    model = bpy.data.collections['Pyrefang']
    for clip, duration in CLIPS.items():
        if clip == 'Idle':
            continue
        scene = base.copy()
        scene.name = 'Codex_' + clip
        scene.use_fake_user = True
        scene.collection.children.unlink(model)
        collection = bpy.data.collections.new('Codex_' + clip + '_Model')
        scene.collection.children.link(collection)
        copies = {}
        for ob in model.all_objects:
            clone = ob.copy()
            clone.name = ob.name + '_' + clip
            collection.objects.link(clone)
            copies[ob] = clone
        for original, clone in copies.items():
            if original.parent in copies:
                clone.parent = copies[original.parent]
            for modifier in clone.modifiers:
                if modifier.type == 'ARMATURE' and modifier.object in copies:
                    modifier.object = copies[modifier.object]
        rig = copies[RIG]
        rig.animation_data.action = bpy.data.actions['Codex_' + clip]
        rig.animation_data.action_slot = rig.animation_data.action.slots[0]
        for view_layer in scene.view_layers:
            view_layer.objects.active = rig
        scene.frame_start, scene.frame_end = 1, math.ceil(duration * FPS)
        scene.frame_set(1)
        for marker in list(scene.timeline_markers):
            scene.timeline_markers.remove(marker)
        scene.timeline_markers.new(clip, frame=1)
        if clip == 'Attack':
            scene.timeline_markers.new('Bite | 0.55 seconds', frame=14)
        if clip == 'Death':
            scene.timeline_markers.new('Rest', frame=66)
    base.frame_set(1)


def open_result():
    global RIG, BODY, REST
    bpy.ops.wm.open_mainfile(filepath=str(OUT / 'pyrefang_codex.blend'), load_ui=False)
    RIG = bpy.data.objects['PyrefangRig']
    BODY = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('Pyrefang_') and not o.name.startswith('Pyrefang_FX')]
    REST = {b.name: b.matrix_local.copy() for b in RIG.data.bones}


def select_clip(clip, t):
    global RIG, BODY, REST
    scene = bpy.data.scenes['Codex_' + clip]
    bpy.context.window.scene = scene
    RIG = next(ob for ob in scene.objects if ob.type == 'ARMATURE')
    BODY = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('Pyrefang_') and not o.name.startswith('Pyrefang_FX')]
    REST = {b.name: b.matrix_local.copy() for b in RIG.data.bones}
    action = bpy.data.actions['Codex_' + clip]
    RIG.animation_data.action = action
    if action.slots:
        RIG.animation_data.action_slot = action.slots[0]
    f = 1 + t * FPS
    scene.frame_set(math.floor(f), subframe=f % 1)


def render(stills=False, only=None):
    open_result()
    for clip, duration in CLIPS.items():
        if only and clip != only:
            continue
        if stills:
            times = {'Idle': [2.91, 7.10, 7.95], 'Walk': [0, WALK_DURATION/4, WALK_DURATION/2], 'Attack': [.34, .50, .55],
                     'Roar': [.23, .6, .90], 'Rise': [0, .70, 1.65], 'Emerge': [0, 1.35, 1.95], 'Death': [.13, 1.3, 2.7]}[clip]
        else:
            times = [i / FPS for i in range(math.ceil(duration * FPS))]
        folder = OUT / ('stills' if stills else 'frames') / clip.lower()
        folder.mkdir(parents=True, exist_ok=True)
        for i, t in enumerate(times):
            select_clip(clip, t)
            scene = bpy.context.scene
            scene.render.filepath = str(folder / f'{i:04}.png')
            bpy.ops.render.render(write_still=True)
        print('CODEX_RENDERED', clip, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--stills', action='store_true')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--clip', choices=list(CLIPS))
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.build:
        bake()
    if args.stills or args.render:
        render(args.stills, args.clip)

"""Idle, hit reaction, quadruped void emergence and death on the Tripo rig.

Call ``build_extra_clips(rig, meshes)`` after the quadruped walk rig is built.
No files are opened/saved, no old actions removed, and no geometry, bind pose,
skin weights or constraints modified. The source walk and attack are retained.
The returned clip mapping gives the action names for canonical glTF names.
Spawn alone intentionally starts below the ground; its body must be occluded
by the game's ground/portal until it emerges. Every other clip is measured on
the evaluated skin and grounded. Death ends motionless with a clamped corpse.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from voidmaul_walk import (LIMBS, _fcurves, _matrix, _measure_soles,
                          _set_pose_matrix, _sole_samples, _update, _world_delta)

FPS = 24
SPECS = (
    ('Idle', 'Voidmaul_Idle_Loop_96f', 96, True),
    ('Hurt', 'Voidmaul_Hurt_20f', 20, False),
    ('Death', 'Voidmaul_Death_77f', 77, False),
    ('Spawn', 'Voidmaul_Spawn_96f', 96, False),
)
SPINES = ('tripo::Spine_0', 'tripo::Spine_1', 'tripo::Spine_2',
          'tripo::Spine_3', 'tripo::Spine_4')


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def track(time, points):
    if time <= points[0][0]:
        return points[0][1]
    for (a, x), (b, y) in zip(points, points[1:]):
        if time <= b:
            return x + (y - x) * smooth((time - a) / (b - a))
    return points[-1][1]


def rotation(x=0, y=0, z=0):
    return (Quaternion((0, 0, 1), math.radians(z))
            @ Quaternion((0, 1, 0), math.radians(y))
            @ Quaternion((1, 0, 0), math.radians(x)))


def _description(name, time, height):
    """Model-space body motion; limb placement is authored separately."""
    pose = {'global': Vector(), 'body': Vector(), 'rotation': Quaternion(),
            'spine': {}, 'contact': set(LIMBS)}
    if name == 'Idle':
        a = math.tau * time / 4
        # One slow, perfectly closing weight shift and two smaller breaths.
        breath, sway = math.sin(2 * a), math.sin(a)
        pose['body'] = height * Vector((.0025*sway, .0015*math.sin(a)*math.sin(a),
                                       -.003+.0022*breath))
        pose['rotation'] = rotation(x=.32*breath, y=.48*sway, z=.25*math.sin(a))
        pose['spine'] = {SPINES[0]: rotation(x=-.22*breath, y=-.18*sway),
                         SPINES[1]: rotation(x=.28*breath, z=-.35*math.sin(a)),
                         SPINES[3]: rotation(y=-.20*sway)}
    elif name == 'Hurt':
        recoil = track(time, [(0, 0), (.10, 1), (.24, .70), (.50, -.10), (20/FPS, 0)])
        settle = track(time, [(0, 0), (.16, 0), (.30, 1), (.50, .55), (20/FPS, 0)])
        pose['body'] = height * Vector((-.006*recoil, .011*recoil,
                                       -.012*settle-.002*recoil))
        pose['rotation'] = rotation(x=-1.7*recoil+1.2*settle,
                                    y=-1.5*recoil, z=2.2*recoil)
        pose['spine'] = {SPINES[0]: rotation(x=-.8*recoil),
                         SPINES[1]: rotation(y=1.1*recoil, z=-1.7*recoil),
                         SPINES[3]: rotation(x=.9*recoil)}
    else:
        raise ValueError('Death and Spawn use their dedicated builders')
    return pose


def _apply(rig, name, time, height, rests, floor, clearance):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
    _update()
    pose = _description(name, time, height)
    global_bone = rig.pose.bones['CTRL_Global']
    global_rest = rests['CTRL_Global']
    _set_pose_matrix(global_bone, _matrix(global_rest.translation+pose['global'],
                                        global_rest.to_quaternion()))
    _update()
    body_rest = rests['CTRL_Body']
    body_position = body_rest.translation + pose['global'] + pose['body']
    _set_pose_matrix(rig.pose.bones['CTRL_Body'],
                     _matrix(body_position, pose['rotation'] @ body_rest.to_quaternion()))
    _update()
    for bone_name, delta in pose['spine'].items():
        if bone_name in rig.pose.bones:
            _world_delta(rig.pose.bones[bone_name], delta)
            _update()
    expected = {}
    for label in LIMBS:
        name_foot, name_pole = 'CTRL_'+label+'_Foot', 'CTRL_'+label+'_Pole'
        foot_rest, pole_rest = rests[name_foot], rests[name_pole]
        position = foot_rest.translation + pose['global']
        foot_rotation = foot_rest.to_quaternion()
        pole_position = pole_rest.translation + pose['global']
        expected[label] = floor + clearance
        _set_pose_matrix(rig.pose.bones[name_foot], _matrix(position, foot_rotation))
        _set_pose_matrix(rig.pose.bones[name_pole], _matrix(pole_position, pole_rest.to_quaternion()))
    _update()
    return pose, expected


def _key_all(rig, frame):
    for bone in rig.pose.bones:
        for path in ('location', 'rotation_quaternion'):
            bone.keyframe_insert(data_path=path, frame=frame, group=bone.name)


def build_extra_clips(rig, meshes):
    """Create four actions and return evaluated per-frame contact/ground QA.

    The active action, old actions, scene range and exact pose are preserved.
    Existing action names are never replaced: reruns receive Blender's normal
    numerical suffix and the returned mapping identifies those new actions.
    """
    if rig.type != 'ARMATURE':
        raise TypeError('Expected an armature')
    meshes = [mesh for mesh in meshes if mesh.type == 'MESH']
    required = ['CTRL_Global', 'CTRL_Body', 'CTRL_Pelvis']
    required += ['CTRL_'+label+'_'+suffix for label in LIMBS for suffix in ('Foot', 'Pole')]
    if any(name not in rig.pose.bones for name in required):
        raise ValueError('The completed Voidmaul quadruped control rig is required')
    scene = bpy.context.scene
    rig.animation_data_create()
    old_action = rig.animation_data.action
    old_slot = getattr(rig.animation_data, 'action_slot', None)
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    old_range = (scene.frame_start, scene.frame_end)
    old_pose = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
    old_rotation_modes = {bone.name: bone.rotation_mode for bone in rig.pose.bones}
    previous_actions = [action.name for action in bpy.data.actions]
    if old_action:
        old_action.use_fake_user = True
    inverse = rig.matrix_world.inverted()
    points = [inverse @ mesh.matrix_world @ vertex.co
              for mesh in meshes for vertex in mesh.data.vertices]
    if not points:
        raise ValueError('No creature vertices supplied')
    height = max(point.z for point in points)-min(point.z for point in points)
    floor, samples = _sole_samples(rig, meshes, height)
    clearance = height * .00035
    rests = {name: rig.data.bones[name].matrix_local.copy() for name in required}
    report = {'fps': FPS, 'height': height, 'floor': floor,
              'sole_clearance': clearance, 'previous_actions_preserved': previous_actions,
              'previous_active_action': old_action.name if old_action else None,
              'clips': {}}
    try:
        for canonical, action_name, period, looping in SPECS:
            if canonical == 'Death':
                from voidmaul_death import build_death
                death = build_death(rig, meshes, action_name=action_name)
                death['frames'] = death['frame_range']
                death['loop'] = False
                death['max_supporting_sole_height_error'] = death['max_supporting_sole_error']
                death['max_floor_penetration_after_emergence'] = death['max_mesh_floor_penetration']
                report['clips'][canonical] = death
                continue
            if canonical == 'Spawn':
                from voidmaul_spawn import build_spawn
                report['clips'][canonical] = build_spawn(rig, meshes, action_name=action_name)
                continue
            rig.animation_data.action = None
            action = bpy.data.actions.new(action_name)
            action.use_fake_user = True
            rig.animation_data.action = action
            clip = {'action': action.name, 'duration_seconds': period/FPS,
                    'frames': [1, period+1], 'loop': looping,
                    'max_supporting_sole_height_error': 0.0,
                    'max_foot_height_correction': 0.0, 'max_global_floor_lift': 0.0,
                    'max_floor_penetration_after_emergence': 0.0,
                    'contact_windows': {}, 'ground_bounds': [], 'warnings': []}
            active_plants = {label: None for label in LIMBS}
            windows = {label: [] for label in LIMBS}
            start_points = None
            last_points = None
            for frame in range(1, period+2):
                scene.frame_set(frame)
                time = 0 if looping and frame == period+1 else (frame-1)/FPS
                pose, expected = _apply(rig, canonical, time, height, rests, floor, clearance)
                corrections = {label: 0.0 for label in expected}
                # Correct contact from the actual deformed soles, including
                # the generated skin weights and arbitrarily rolled foot bones.
                for iteration in range(10):
                    measured, _, _ = _measure_soles(rig, meshes, samples)
                    residual = {label: target-measured[label] for label, target in expected.items()}
                    if not residual or max(abs(value) for value in residual.values()) <= height*.000025:
                        break
                    for label, error in residual.items():
                        bone = rig.pose.bones['CTRL_'+label+'_Foot']
                        matrix = bone.matrix.copy()
                        matrix.translation.z += error
                        corrections[label] += error
                        _set_pose_matrix(bone, matrix)
                    _update()
                measured, minimum, _ = _measure_soles(rig, meshes, samples)
                errors = [abs(measured[label]-expected[label]) for label in pose['contact']]
                clip['max_supporting_sole_height_error'] = max(
                    [clip['max_supporting_sole_height_error']] + errors)
                clip['max_foot_height_correction'] = max(
                    [clip['max_foot_height_correction']] + [abs(value) for value in corrections.values()])
                clip['max_floor_penetration_after_emergence'] = max(
                    clip['max_floor_penetration_after_emergence'], floor-minimum)
                clip['ground_bounds'].append({'frame': frame, 'minimum_z': minimum,
                                               'supporting_soles_z': {label: measured[label]
                                                                     for label in pose['contact']}})
                for label in LIMBS:
                    if label in pose['contact'] and active_plants[label] is None:
                        active_plants[label] = frame
                    elif label not in pose['contact'] and active_plants[label] is not None:
                        windows[label].append((active_plants[label], frame-1))
                        active_plants[label] = None
                _key_all(rig, frame)
                if frame in (1, period+1):
                    _, _, vertices = _measure_soles(rig, meshes, samples, capture=True)
                    if frame == 1:
                        start_points = vertices
                    else:
                        last_points = vertices
            for label in LIMBS:
                if active_plants[label] is not None:
                    windows[label].append((active_plants[label], period+1))
            clip['contact_windows'] = windows
            clip['endpoint_surface_distance'] = max((Vector(a)-Vector(b)).length
                                                     for a, b in zip(start_points, last_points))
            for curve in _fcurves(action):
                for point in curve.keyframe_points:
                    point.interpolation = 'LINEAR'
                # Game loops are explicit. Closing keys provide smooth seams;
                # there are no Cycles modifiers even on the editable Idle.
            action['export_name'] = canonical
            action['loop'] = looping
            action['fps'] = FPS
            action['duration_seconds'] = period/FPS
            action['quadruped'] = True
            action['ground_floor'] = floor
            if canonical == 'Spawn':
                action['intentional_ground_occlusion_until_seconds'] = 2.65
                action['ground_occlusion_required'] = True
                action['spawn_forefeet_planted_seconds'] = .96
                action['spawn_hindfeet_planted_seconds'] = 2.38
            if clip['max_supporting_sole_height_error'] > height*.0015:
                clip['warnings'].append('Supporting sole residual needs review')
            if clip['max_floor_penetration_after_emergence'] > height*.0001:
                clip['warnings'].append('A nonoccluded vertex penetrates the floor')
            if canonical == 'Idle' and clip['endpoint_surface_distance'] > height*.0001:
                clip['warnings'].append('Idle closing pose differs from its start')
            report['clips'][canonical] = clip
    finally:
        rig.animation_data.action = old_action
        if old_action and old_slot:
            try:
                rig.animation_data.action_slot = old_slot
            except (AttributeError, TypeError):
                pass
        scene.frame_start, scene.frame_end = old_range
        scene.frame_set(old_frame, subframe=old_subframe)
        for bone in rig.pose.bones:
            bone.rotation_mode = old_rotation_modes[bone.name]
            bone.matrix_basis = old_pose[bone.name]
        _update()
    report['all_previous_actions_still_present'] = all(
        bpy.data.actions.get(name) is not None for name in previous_actions)
    return report

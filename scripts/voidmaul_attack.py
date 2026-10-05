"""Reference-timed forepaw slam on the existing four-foot Voidmaul rig.

Source: gemini_generated_video_59ab7b6f.mp4, 240 frames at 24 fps.
The image-right near paw is CTRL_Fore_R_Foot (model +X), irrespective
of the misleading anatomical names in the generated Tripo armature.
No mesh, bind pose, walk action, or existing IK constraint is changed.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from voidmaul_walk import (LIMBS, _fcurves, _matrix, _measure_soles,
                          _set_pose_matrix, _sole_samples, _update)

FULL_NAME = 'Voidmaul_Attack_Reference_240f'
CORE_NAME = 'Voidmaul_Attack'
FPS = 24
CONTACT_FRAME = 79

# Measured source frame timing, expressed in seconds. Each value is a
# fraction of model height, or a normalized pose weight.
LIFT = [(0, 0), (1.625, 0), (1.75, .035), (2.0, .18),
        (2.166667, .29), (2.333333, .37), (2.5, .415),
        (2.833333, .45), (3.041667, .45), (3.083333, .43),
        (3.166667, .24), (3.208333, .085), (3.25, 0), (10, 0)]
LOAD = [(0, 0), (1.5, 0), (1.75, .15), (2.166667, .65),
        (2.833333, 1), (3.041667, 1), (3.25, 0), (10, 0)]
COMPRESSION = [(0, 0), (3.166667, 0), (3.25, .50),
               (3.416667, 1), (3.666667, .80),
               (4.0, .10), (4.166667, -.06), (4.666667, 0), (10, 0)]
SECONDARY = [(0, 0), (6.958333, 0), (7.166667, .75),
             (7.333333, 1), (7.5, .55), (7.75, 0), (10, 0)]


def sample(keys, time):
    """Monotone cubic interpolation with flat extrema and no overshoot."""
    if time <= keys[0][0]:
        return keys[0][1]
    if time >= keys[-1][0]:
        return keys[-1][1]
    slopes = [(b[1] - a[1]) / (b[0] - a[0]) for a, b in zip(keys, keys[1:])]
    tangents = [slopes[0]]
    for a, b in zip(slopes, slopes[1:]):
        tangents.append(0 if a * b <= 0 else 2 * a * b / (a + b))
    tangents.append(slopes[-1])
    i = next(i for i in range(len(keys) - 1) if keys[i + 1][0] >= time)
    duration = keys[i + 1][0] - keys[i][0]
    u = (time - keys[i][0]) / duration
    return ((2*u**3 - 3*u*u + 1)*keys[i][1]
            + (u**3 - 2*u*u + u)*duration*tangents[i]
            + (-2*u**3 + 3*u*u)*keys[i + 1][1]
            + (u**3 - u*u)*duration*tangents[i + 1])


def key_pose(bone, frame):
    for path in ('location', 'rotation_quaternion'):
        bone.keyframe_insert(data_path=path, frame=frame, group=bone.name)


def contact_windows(full=True):
    if full:
        return {'Hind_L': [(1, 240)], 'Hind_R': [(1, 240)],
                'Fore_L': [(1, 168), (187, 240)],
                'Fore_R': [(1, 40), (79, 240)]}
    return {'Hind_L': [(1, 77)], 'Hind_R': [(1, 77)],
            'Fore_L': [(1, 77)], 'Fore_R': [(1, 4), (43, 77)]}


def build_attack(rig, meshes):
    """Create full reference and trimmed attack actions; leave reference active."""
    if bpy.data.actions.get(FULL_NAME):
        raise ValueError('An attack already exists; preserve it and use a fresh revision')
    if not all('CTRL_' + label + '_Foot' in rig.pose.bones for label in LIMBS):
        raise ValueError('Expected the completed Voidmaul quadruped control rig')
    scene = bpy.context.scene
    old_action = rig.animation_data.action
    if old_action:
        old_action.use_fake_user = True
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
    _update()
    height = max(v.co.z for m in meshes for v in m.data.vertices) - min(
        v.co.z for m in meshes for v in m.data.vertices)
    floor, samples = _sole_samples(rig, meshes, height)
    clearance = height * .00035
    controls = {label: rig.pose.bones['CTRL_' + label + '_Foot'] for label in LIMBS}
    rest = {label: bone.bone.matrix_local.copy() for label, bone in controls.items()}
    poles = {label: rig.pose.bones['CTRL_' + label + '_Pole'] for label in LIMBS}
    pole_rest = {label: bone.bone.matrix_local.copy() for label, bone in poles.items()}
    body = rig.pose.bones['CTRL_Body']
    body_rest = body.bone.matrix_local.copy()
    full = bpy.data.actions.new(FULL_NAME)
    full.use_fake_user = True
    rig.animation_data.action = full
    max_height_residual = 0.0
    max_correction = 0.0
    for frame in range(1, 241):
        scene.frame_set(frame)
        time = (frame - 1) / FPS
        load = sample(LOAD, time)
        compression = sample(COMPRESSION, time)
        secondary = sample(SECONDARY, time)
        fold = sample(LIFT, time) / .45
        lift = .42 * fold
        position = body_rest.translation + height * Vector((
            -.020*load + .004*compression + .003*secondary,
            .012*load - .013*compression,
            .009*load - .040*compression))
        rotation = (Quaternion((0, 0, 1), math.radians(7*load - 1.4*compression))
                    @ Quaternion((0, 1, 0), math.radians(-3.5*load + .6*compression + .5*secondary))
                    @ Quaternion((1, 0, 0), math.radians(-2.0*load + 4.0*compression)))
        _set_pose_matrix(body, _matrix(position, rotation @ body_rest.to_quaternion()))
        _update()
        expected = {}
        for label, control in controls.items():
            position = rest[label].translation.copy()
            rotation = Quaternion()
            if label == 'Fore_R':
                # Fold the forearm in front of its own shoulder. The old
                # inward target and reversed pole plane twisted the upper
                # arm almost 180 degrees and collapsed its blended socket.
                position += height * Vector((.010*fold, -.050*fold, lift))
                expected[label] = floor + clearance + height*lift
            elif label == 'Fore_L':
                position += height * Vector((0, -.012*secondary, .05*secondary))
                rotation = Quaternion((1, 0, 0), math.radians(-3*secondary))
                expected[label] = floor + clearance + height*.05*secondary
            else:
                expected[label] = floor + clearance
            _set_pose_matrix(control, _matrix(position, rotation @ rest[label].to_quaternion()))
        for label, pole in poles.items():
            pose = pole_rest[label].copy()
            # Keep each calibrated bend plane on the same side throughout
            # the curl. Crossing the shoulder/wrist axis flips the armor.
            _set_pose_matrix(pole, pose)
        _update()
        corrections = {label: 0.0 for label in LIMBS}
        for iteration in range(8):
            measured, _, _ = _measure_soles(rig, meshes, samples)
            residual = {label: expected[label] - measured[label] for label in LIMBS}
            if max(abs(error) for error in residual.values()) <= height * .000025:
                break
            for label, error in residual.items():
                pose = controls[label].matrix.copy()
                pose.translation.z += error
                corrections[label] += error
                _set_pose_matrix(controls[label], pose)
            _update()
        measured, _, _ = _measure_soles(rig, meshes, samples)
        max_height_residual = max(max_height_residual,
                                  max(abs(measured[label] - expected[label]) for label in LIMBS))
        max_correction = max(max_correction, max(abs(x) for x in corrections.values()))
        for bone in [body, rig.pose.bones['CTRL_Global'], rig.pose.bones['CTRL_Pelvis'],
                     *controls.values(), *poles.values()]:
            key_pose(bone, frame)
    for curve in _fcurves(full):
        for point in curve.keyframe_points:
            point.interpolation = 'LINEAR'
    full['reference_video'] = 'art_src/voidmaul/gemini_generated_video_59ab7b6f.mp4'
    full['reference_frames'] = 240
    full['reference_fps'] = FPS
    full['attack_foot'] = 'CTRL_Fore_R_Foot (image-right near forepaw, model +X)'
    full['impact_frame'] = CONTACT_FRAME
    full['impact_seconds'] = 3.25
    full['secondary_idle_adjustment_frames'] = '168-187'
    core = full.copy()
    core.name = CORE_NAME
    core.use_fake_user = True
    for curve in _fcurves(core):
        for index in range(len(curve.keyframe_points) - 1, -1, -1):
            point = curve.keyframe_points[index]
            if point.co.x < 37 or point.co.x > 113:
                curve.keyframe_points.remove(point, fast=True)
        for point in curve.keyframe_points:
            point.co.x -= 36
            point.handle_left.x -= 36
            point.handle_right.x -= 36
        curve.update()
    core['source_reference_frame_range'] = '36-112 inclusive, zero based'
    core['frame_range'] = '1-77'
    core['impact_frame'] = 43
    core['impact_seconds'] = 42 / FPS
    core['duration_seconds'] = 76 / FPS
    rig.animation_data.action = full
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, 240
    scene.frame_preview_start, scene.frame_preview_end = 1, 240
    scene.frame_set(1)
    _update()
    return {'full_action': full.name, 'attack_action': core.name,
            'walk_preserved': old_action.name if old_action else None,
            'reference_seconds': 10, 'fps': FPS, 'impact_frame': 79,
            'attack_foot': 'Fore_R', 'floor': floor, 'sole_clearance': clearance,
            'max_keyed_sole_height_residual': max_height_residual,
            'max_sole_control_height_correction': max_correction,
            'full_contact_windows': contact_windows(True),
            'core_contact_windows': contact_windows(False),
            'height': height, 'animation_channels': len(_fcurves(full))}

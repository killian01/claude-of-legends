"""Articulated belly-down quadruped death, authored without a rigid side tip.

The forelegs fail in sequence, then the hindquarters settle. Original actions,
bind matrices, geometry, skin weights and the active source pose are preserved.
Call build_death(rig, the_fourteen_anatomical_meshes) in Blender.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from voidmaul_walk import (LIMBS, _fcurves, _matrix, _measure_soles,
                          _set_pose_matrix, _sole_samples, _update, _world_delta)

FPS = 24
PERIOD = 77
SPINES = tuple('tripo::Spine_' + str(i) for i in range(5))


def smooth(value):
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def track(time, keys):
    if time <= keys[0][0]:
        return keys[0][1]
    for (a, x), (b, y) in zip(keys, keys[1:]):
        if time <= b:
            return x + (y - x) * smooth((time - a) / (b - a))
    return keys[-1][1]


def rotation(x=0.0, y=0.0, z=0.0):
    return (Quaternion((0, 0, 1), math.radians(z))
            @ Quaternion((0, 1, 0), math.radians(y))
            @ Quaternion((1, 0, 0), math.radians(x)))


def _pose(rig, time, height, rests):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
    _update()
    recoil = track(time, [(0, 0), (.12, 1), (.33, .45), (.55, 0)])
    first = track(time, [(0, 0), (.18, 0), (.76, 1)])
    second = track(time, [(0, 0), (.42, 0), (1.05, 1)])
    rear = track(time, [(0, 0), (.87, 0), (1.73, 1)])
    settle = track(time, [(0, 0), (1.54, 0), (1.83, 1),
                          (2.08, -.23), (2.42, 0)])
    head = track(time, [(0, 0), (.31, 0), (1.21, .70), (1.94, 1)])
    front = .52 * first + .48 * second
    chest_drop = .280 * front + .012 * settle
    hip_drop = .194 * rear + .007 * settle
    asymmetry = track(time, [(0, 0), (.30, 0), (.73, 1),
                             (1.19, .38), (1.84, .58), (2.42, .48)])

    body_rotation = rotation(x=-2.0*recoil+4.0*front-1.0*rear,
                             y=7.0*asymmetry, z=-2.3*front+1.0*rear)
    body_rest = rests['CTRL_Body']
    body_offset = height * Vector((.008*asymmetry, -.016*front,
                                   -chest_drop+.006*recoil))
    _set_pose_matrix(rig.pose.bones['CTRL_Body'],
                     _matrix(body_rest.translation+body_offset,
                             body_rotation @ body_rest.to_quaternion()))
    _update()
    pelvis_rest = rests['CTRL_Pelvis']
    pelvis_position = pelvis_rest.translation + height * Vector((
        .006*asymmetry, .003*rear, -hip_drop))
    _set_pose_matrix(rig.pose.bones['CTRL_Pelvis'],
                     _matrix(pelvis_position,
                             rotation(x=-1.0*rear, y=3.0*asymmetry,
                                      z=1.2*rear) @ pelvis_rest.to_quaternion()))
    _update()

    # The generated spine follows the asymmetric crest rather than a normal
    # animal's sagittal back. Use model-axis deltas and modest distributed
    # bends, then lower its root separately from the later-moving pelvis.
    spine_root = rig.pose.bones[SPINES[0]]
    inherited = spine_root.bone.matrix_local.copy()
    inherited = (spine_root.parent.matrix
                 @ spine_root.parent.bone.matrix_local.inverted() @ inherited)
    inherited.translation += height * Vector((.003*asymmetry, -.010*front,
                                              -(chest_drop-hip_drop)))
    _set_pose_matrix(spine_root, _matrix(inherited.translation,
        rotation(x=3.0*front-1.0*recoil, y=3.0*asymmetry,
                 z=-1.5*front) @ inherited.to_quaternion()))
    _update()
    for i, (pitch, fold, twist) in enumerate(((12, -3, 1.5),
                                             (8, -4, 1),
                                             (24, -6, .5),
                                             (12, -4, 0)), start=1):
        _world_delta(rig.pose.bones[SPINES[i]],
                     rotation(x=pitch*head, y=fold*head,
                              z=twist*asymmetry))
        _update()

    for label, data in LIMBS.items():
        sign = 1.0 if label.endswith('_R') else -1.0
        fore = data['front']
        fold = first if label == 'Fore_R' else second if fore else rear
        foot_rest = rests['CTRL_'+label+'_Foot']
        pole_rest = rests['CTRL_'+label+'_Pole']
        position = foot_rest.translation.copy()
        if fore:
            # A grounded skid spreads the forepaws while each elbow buckles.
            position += height * Vector((sign*.090*fold,
                                          -.160*fold, 0))
            slack = track(time, [(0, 0), (.83 if sign > 0 else 1.10, 0),
                                  (1.60 if sign > 0 else 1.94, 1)])
            angle = rotation(x=-9*fold, y=-sign*32*slack,
                             z=sign*(17*fold+11*slack))
            # Rest poles are unusually far behind the creature. Sending a
            # delta there keeps the elbows upright despite a lowered torso.
            # An explicit low lateral plane makes the elbow itself buckle.
            pole_goal = height * Vector((sign*.55,
                                          .150 if sign < 0 else -.035,
                                          .075))
            pole_delta = (pole_goal-pole_rest.translation) * fold
        else:
            # Rear feet spread later, with opposite foot yaw and a separate
            # knee plane. They are not transformed as rigid torso children.
            position += height * Vector((sign*.060*fold,
                                          .055*fold, 0))
            angle = rotation(x=4*fold, z=sign*13*fold)
            pole_delta = height * Vector((sign*.110*fold,
                                           -.055*fold, .090*fold))
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Foot'],
                         _matrix(position, angle @ foot_rest.to_quaternion()))
        pole = pole_rest.copy()
        pole.translation += pole_delta
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Pole'], pole)
    _update()
    return {'front_drop_fraction': chest_drop,
            'hip_drop_fraction': hip_drop, 'fore_buckle_R': first,
            'fore_buckle_L': second, 'hind_collapse': rear,
            'crest_fold': head, 'maximum_body_roll_deg': 7*asymmetry}


def build_death(rig, meshes, action_name='Voidmaul_Death_77f'):
    """Return the new action name and measured per-frame contact QA report."""
    meshes = [m for m in meshes if m.type == 'MESH' and m.get('anatomy_region')]
    if len(meshes) != 14:
        raise ValueError('Pass the 14 anatomical segments, excluding hidden source')
    scene = bpy.context.scene
    rig.animation_data_create()
    old_action = rig.animation_data.action
    old_slot = getattr(rig.animation_data, 'action_slot', None)
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    old_range = scene.frame_start, scene.frame_end
    old_basis = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
    old_modes = {b.name: b.rotation_mode for b in rig.pose.bones}
    previous = [a.name for a in bpy.data.actions]
    rests = {b.name: b.bone.matrix_local.copy() for b in rig.pose.bones}
    inverse = rig.matrix_world.inverted()
    points = [inverse @ m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
    height = max(p.z for p in points)-min(p.z for p in points)
    floor, samples = _sole_samples(rig, meshes, height)
    # During death the hands roll onto their outer edges. Original flat-sole
    # samples are no longer the bottom of the foot, so ground the whole actual
    # foot region rather than forcing a rolled hand back into a standing pose.
    for label in LIMBS:
        kind, side = label.split('_')
        region = kind+'Foot.'+side
        foot_meshes = [m for m in meshes if m.get('anatomy_region') == region]
        samples[label] = [(m, v.index) for m in foot_meshes for v in m.data.vertices]
    clearance = height*.00060
    action = bpy.data.actions.new(action_name)
    action.use_fake_user = True
    report = {'action': action.name, 'duration_seconds': PERIOD/FPS,
              'fps': FPS, 'frame_range': [1, PERIOD+1], 'height': height,
              'floor': floor, 'sole_clearance': clearance,
              'collision_clearance': height*.00045,
              'max_supporting_sole_error': 0.0,
              'max_mesh_floor_penetration': 0.0,
              'max_collision_body_lift': 0.0, 'ground_bounds': [],
              'contact_windows': {'Fore_R': [(1, 5), (40, 78)],
                                  'Fore_L': [(1, 11), (48, 78)],
                                  'Hind_R': [(1, 21), (43, 78)],
                                  'Hind_L': [(1, 21), (43, 78)]},
              'target_stationary_windows': {'Fore_R': [(1, 5), (20, 78)],
                                           'Fore_L': [(1, 11), (27, 78)],
                                           'Hind_R': [(1, 21), (43, 78)],
                                           'Hind_L': [(1, 21), (43, 78)]},
              'actual_foot_grounded_windows': {label: [(1, PERIOD+1)] for label in LIMBS},
              'foot_contact_sampling': 'minimum over every vertex of anatomical Foot segment',
              'relaxed_hand_roll_frames': {'Fore_R': [21, 40], 'Fore_L': [27, 48]},
              'previous_actions': previous, 'warnings': []}
    try:
        rig.animation_data.action = action
        for frame in range(1, PERIOD+2):
            scene.frame_set(frame)
            description = _pose(rig, (frame-1)/FPS, height, rests)
            for iteration in range(12):
                measured, minimum, _ = _measure_soles(rig, meshes, samples)
                errors = {label: floor+clearance-measured[label] for label in LIMBS}
                if max(abs(x) for x in errors.values()) < height*.000015:
                    break
                for label, error in errors.items():
                    control = rig.pose.bones['CTRL_'+label+'_Foot']
                    pose = control.matrix.copy()
                    pose.translation.z += error
                    _set_pose_matrix(control, pose)
                _update()
            measured, minimum, vertices = _measure_soles(rig, meshes, samples, capture=True)
            collision_lift = 0.0
            for collision_iteration in range(12):
                additional = max(0.0, floor+height*.00045-minimum)
                if additional <= height*.000002:
                    break
                # Only small contact adjustments are permitted. A large lift
                # means the collapse itself is wrong and requires revision.
                body = rig.pose.bones['CTRL_Global']
                pose = body.matrix.copy()
                pose.translation.z += additional
                collision_lift += additional
                _set_pose_matrix(body, pose)
                _update()
                for iteration in range(10):
                    measured, minimum, _ = _measure_soles(rig, meshes, samples)
                    errors = {label: floor+clearance-measured[label] for label in LIMBS}
                    if max(abs(x) for x in errors.values()) < height*.000015:
                        break
                    for label, error in errors.items():
                        control = rig.pose.bones['CTRL_'+label+'_Foot']
                        pose = control.matrix.copy()
                        pose.translation.z += error
                        _set_pose_matrix(control, pose)
                    _update()
                measured, minimum, _ = _measure_soles(rig, meshes, samples)
            measured, minimum, vertices = _measure_soles(rig, meshes, samples, capture=True)
            report['max_collision_body_lift'] = max(report['max_collision_body_lift'], collision_lift)
            report['max_supporting_sole_error'] = max(report['max_supporting_sole_error'],
                max(abs(floor+clearance-measured[label]) for label in LIMBS))
            report['max_mesh_floor_penetration'] = max(report['max_mesh_floor_penetration'],
                                                       max(0.0, floor-minimum))
            report['ground_bounds'].append({'frame': frame, 'minimum_z': minimum,
                                           'maximum_z': max(v[2] for v in vertices),
                                           'description': description})
            for bone in rig.pose.bones:
                for path in ('location', 'rotation_quaternion'):
                    bone.keyframe_insert(data_path=path, frame=frame, group=bone.name)
        for curve in _fcurves(action):
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
        action['export_name'] = 'Death'
        action['quadruped'] = True
        action['clamp_last_pose'] = True
        action['duration_seconds'] = PERIOD/FPS
        action['fully_still_after_seconds'] = 2.42
        action['description'] = 'Sequential foreleg buckle, delayed hips, articulated low belly collapse'
        if report['max_collision_body_lift'] > height*.05:
            report['warnings'].append('Collision correction exceeds .05 model height; inspect collapse')
        if report['max_mesh_floor_penetration'] > height*.0001:
            report['warnings'].append('Nonoccluded mesh penetrates floor')
        if report['max_supporting_sole_error'] > height*.0015:
            report['warnings'].append('Sole contact residual exceeds tolerance')
        report['final_height_fraction'] = (report['ground_bounds'][-1]['maximum_z']-floor)/height
        graph = bpy.context.evaluated_depsgraph_get()
        body_mesh = next(m for m in meshes if m.get('anatomy_region') == 'Body')
        evaluated = body_mesh.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        transform = inverse @ evaluated.matrix_world
        body_points = [transform @ v.co for v in geometry.vertices]
        report['final_body_minimum_z'] = min(p.z for p in body_points)
        report['final_body_floor_gap_fraction'] = (report['final_body_minimum_z']-floor)/height
        report['final_body_vertices_within_1mm'] = sum(p.z-floor <= height*.001 for p in body_points)
        evaluated.to_mesh_clear()
        if report['final_body_floor_gap_fraction'] > .002:
            report['warnings'].append('Final corpse lacks actual Body ground contact')
    finally:
        rig.animation_data.action = old_action
        if old_action and old_slot:
            rig.animation_data.action_slot = old_slot
        scene.frame_start, scene.frame_end = old_range
        scene.frame_set(old_frame, subframe=old_subframe)
        for bone in rig.pose.bones:
            bone.rotation_mode = old_modes[bone.name]
            bone.matrix_basis = old_basis[bone.name]
        _update()
    report['all_previous_actions_preserved'] = all(bpy.data.actions.get(n) for n in previous)
    report['passed_numeric'] = not report['warnings']
    return report

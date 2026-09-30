"""Read-only validation of the independently authored, saved Codex animations.

Run: blender -b --factory-startup --python scripts/validate_pyrefang_codex.py
Only the Codex .blend is opened. No Blender file is saved or changed; the sole
output is codex/validation_report.json. Ground tests use evaluated mesh vertices
at every frame and half-frame, with exact clip endpoints and event times added.
"""

import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils.kdtree import KDTree


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from pyrefang_codex_walk import WALK_DURATION
from pyrefang_codex_surface_validation import validate_surface_topology

OUT = ROOT / 'art_src/models_raw/pyrefang/codex'
BLEND = OUT / 'pyrefang_codex.blend'
FPS = 24
CLIPS = {'Idle': 10.0, 'Walk': WALK_DURATION, 'Attack': 1.4,
         'Roar': 1.5, 'Rise': 2.5, 'Emerge': 3.0, 'Death': 3.0}
FRAME_TOL = 1e-4
MATRIX_TOL = 1e-4
POSITION_TOL = 1e-4
GROUND_TOL = 1e-3
REST_SEAM_MATCH_TOL = 2e-6
ANIMATED_SEAM_TOL = 1e-4
# Revision 12 reauthors the action tails. These old Walk silhouette thresholds
# remain visible as historical diagnostics, never as motion-quality gates.
# Connected lengths, finite poses, ground, seams, loops and settling stay gated.
LEGACY_WALK_STYLE_LIMITS = {
    'Walk': {'vertical_range_ratio': [.10, .50], 'maximum_lateral_range_ratio': .25,
             'minimum_longitudinal_span_ratio': .70, 'lag_range_s': [.06, .55]},
}
IDLE_EVENT_TIMES = (2.7, 3.15, 3.85, 4.30, 6.6, 6.95, 7.35, 7.9,
                    8.25, 8.5, 8.95, 9.15)
DEATH_MAX_BANK_DEG = 12.0
DEATH_MAX_FINAL_JOINT_HEIGHT = 0.20
DEATH_MAX_BODY_GAP = 0.020
DEATH_MAX_HEAD_GAP = 0.025
FX_MATERIAL_TOL = 1e-5
DEATH_MAX_FX_REMAINING_RATIO = 0.25


def curves(action):
    """Support both layered Blender actions and legacy actions."""
    if hasattr(action, 'layers') and len(action.layers):
        return [fc for layer in action.layers for strip in layer.strips
                for bag in getattr(strip, 'channelbags', []) for fc in bag.fcurves]
    return list(getattr(action, 'fcurves', []))


def evaluated_fx_sample(scene, objects, time):
    """Read final world geometry and evaluated shader values in the real scene."""
    frame = 1.0 + time * FPS
    scene.frame_set(math.floor(frame), subframe=frame % 1.0)
    graph = bpy.context.evaluated_depsgraph_get()
    points, materials, areas = {}, {}, {}
    for ob in objects:
        evaluated = ob.evaluated_get(graph)
        coordinates = np.empty(len(evaluated.data.vertices) * 3, dtype=np.float32)
        evaluated.data.vertices.foreach_get('co', coordinates)
        transform = np.array(evaluated.matrix_world, dtype=np.float64)
        world = coordinates.reshape(-1, 3) @ transform[:3, :3].T + transform[:3, 3]
        points[ob.name] = world
        # Surface area is independent of object translation or orientation, so
        # Death can be measured while the attached creature collapses.
        area = 0.0
        for polygon in evaluated.data.polygons:
            vertices = world[list(polygon.vertices)]
            if len(vertices) >= 3:
                area += float(np.linalg.norm(np.cross(vertices[1:-1] - vertices[0],
                                                      vertices[2:] - vertices[0]), axis=1).sum()) / 2
        areas[ob.name] = area
        for material in evaluated.data.materials:
            if material is None or material.node_tree is None:
                continue
            for node in material.node_tree.nodes:
                if node.type != 'BSDF_PRINCIPLED':
                    continue
                socket = node.inputs.get('Emission Strength')
                if socket is not None and not socket.is_linked:
                    materials[f'{material.name}/{node.name}/Emission Strength'] = float(socket.default_value)
    finite = all(np.isfinite(world_points).all() for world_points in points.values())
    finite = finite and all(math.isfinite(value) for value in (*materials.values(), *areas.values()))
    return {'points': points, 'emission': materials, 'area': areas, 'finite': finite}


def evaluated_fx_validation(errors):
    """Check saved final results without importing the FX authoring module."""
    report = {'loop_endpoints': {}, 'death_fading': {}}
    previous_scene = bpy.context.window.scene
    try:
        for clip in ('Idle', 'Walk', 'Death'):
            scene = bpy.data.scenes.get('Codex_' + clip)
            if scene is None:
                continue
            bpy.context.window.scene = scene
            previous_frame, previous_subframe = scene.frame_current, scene.frame_subframe
            objects = [ob for ob in scene.objects if ob.type == 'MESH'
                       and ob.name.startswith('Pyrefang_FX_')]
            if not objects:
                continue
            try:
                first = evaluated_fx_sample(scene, objects, 0.0)
                last = evaluated_fx_sample(scene, objects, CLIPS[clip])
                finite = first['finite'] and last['finite']
                if not finite:
                    errors.append(f'Non-finite evaluated FX values in Codex_{clip}')
                    continue
                if clip in ('Idle', 'Walk'):
                    geometry_differences = {
                        name: float(np.linalg.norm(points - last['points'][name], axis=1).max())
                        for name, points in first['points'].items()}
                    same_materials = first['emission'].keys() == last['emission'].keys()
                    material_differences = {
                        name: abs(value - last['emission'][name])
                        for name, value in first['emission'].items() if name in last['emission']}
                    passed = (max(geometry_differences.values(), default=float('inf')) <= POSITION_TOL
                              and same_materials and bool(material_differences)
                              and max(material_differences.values()) <= FX_MATERIAL_TOL)
                    report['loop_endpoints'][clip] = {
                        'evaluated_scene': scene.name,
                        'times_s': [0.0, CLIPS[clip]],
                        'max_vertex_displacement_by_mesh_m': geometry_differences,
                        'emission_strength_difference_by_material': material_differences,
                        'passed': passed,
                    }
                    if not passed:
                        errors.append(f'Final evaluated FX geometry or materials do not loop: {clip}')
                    continue
                samples = [(2.7, evaluated_fx_sample(scene, objects, 2.7)), (CLIPS[clip], last)]
                for time, state in samples:
                    if not state['finite']:
                        report['death_fading'][str(time)] = {'finite': False, 'passed': False}
                        errors.append(f'Non-finite evaluated Death FX at {time} seconds')
                        continue
                    ratios = {name: value / first['emission'][name]
                              for name, value in state['emission'].items()
                              if first['emission'].get(name, 0) > 1e-8}
                    flame_ratios = {name: area / first['area'][name]
                                    for name, area in state['area'].items()
                                    if any(part in name for part in ('Crest', 'Spine', 'Tail'))
                                    and first['area'][name] > 1e-12}
                    ember_areas = {name: area for name, area in state['area'].items() if 'Embers' in name}
                    passed = (state['finite'] and bool(ratios) and bool(flame_ratios) and bool(ember_areas)
                              and min(ratios.values()) >= 0
                              and max(ratios.values()) <= DEATH_MAX_FX_REMAINING_RATIO
                              and max(flame_ratios.values()) <= DEATH_MAX_FX_REMAINING_RATIO
                              and max(ember_areas.values()) <= 1e-10)
                    report['death_fading'][str(time)] = {
                        'emission_ratio_to_start': ratios,
                        'flame_surface_area_ratio_to_start': flame_ratios,
                        'remaining_ember_surface_area_m2': ember_areas,
                        'maximum_remaining_ratio': DEATH_MAX_FX_REMAINING_RATIO,
                        'passed': passed,
                    }
                    if not passed:
                        errors.append(f'Death FX must fade strongly and extinguish embers by {time} seconds')
            finally:
                scene.frame_set(previous_frame, subframe=previous_subframe)
    finally:
        bpy.context.window.scene = previous_scene
    return report


def fx_validation(errors):
    """Inspect saved FX curves and geometry, including scene-local ownership."""
    report = {'actions': {}, 'scenes': {}, 'isolated_mesh_data': True}
    fx_actions = [action for action in bpy.data.actions if action.name.startswith('CodexFX_')]
    if not fx_actions:
        errors.append('No animated Codex FX actions found')
    for action in fx_actions:
        key_count = 0
        invalid_keys = 0
        nonconstant_curves = 0
        for fc in curves(action):
            values = []
            for key in fc.keyframe_points:
                key_count += 1
                if not all(math.isfinite(value) for value in
                           (*key.co, *key.handle_left, *key.handle_right,
                            key.amplitude, key.back, key.period)):
                    invalid_keys += 1
                values.append(float(key.co.y))
            if values and all(math.isfinite(value) for value in values):
                nonconstant_curves += max(values) - min(values) > 1e-7
        passed = key_count > 1 and invalid_keys == 0 and nonconstant_curves > 0
        report['actions'][action.name] = {
            'key_count': key_count, 'nonfinite_key_count': invalid_keys,
            'nonconstant_curve_count': nonconstant_curves, 'passed': passed,
        }
        if not passed:
            errors.append(f'FX action must have finite, changing keys: {action.name}')

    mesh_owners = {}
    for clip in CLIPS:
        scene = bpy.data.scenes.get('Codex_' + clip)
        if scene is None:
            continue
        objects = [ob for ob in scene.objects if ob.type == 'MESH'
                   and ob.name.startswith('Pyrefang_FX_')]
        data = {'mesh_count': len(objects), 'meshes': {}, 'radiance_actions': []}
        report['scenes'][clip] = data
        if not objects:
            errors.append(f'No FX meshes in Codex_{clip}')
        radiance = set()
        for ob in objects:
            pointer = ob.data.as_pointer()
            if pointer in mesh_owners and mesh_owners[pointer] != scene.name:
                report['isolated_mesh_data'] = False
                errors.append(f'FX mesh data shared across scenes: {ob.data.name}')
            mesh_owners[pointer] = scene.name
            for material in ob.data.materials:
                tree = material.node_tree if material else None
                action = tree.animation_data.action if tree and tree.animation_data else None
                if action and action.name.startswith(f'CodexFX_{clip}_'):
                    radiance.add(action.name)
            keys = ob.data.shape_keys
            moving_geometry = any(part in ob.name for part in ('Crest', 'Spine', 'Tail', 'Embers'))
            info = {'mesh_data': ob.data.name, 'animated_geometry_expected': moving_geometry}
            data['meshes'][ob.name] = info
            if not moving_geometry:
                continue
            action = keys.animation_data.action if keys and keys.animation_data else None
            if not keys or not action or not action.name.startswith(f'CodexFX_{clip}_'):
                errors.append(f'Missing scene-local FX shape action: {ob.name}')
                info['passed'] = False
                continue
            basis = None
            maximum_delta = 0.0
            finite = True
            for shape in keys.key_blocks:
                positions = np.empty(len(shape.data) * 3, dtype=np.float32)
                shape.data.foreach_get('co', positions)
                if not np.isfinite(positions).all():
                    finite = False
                    continue
                if basis is None:
                    basis = positions
                else:
                    maximum_delta = max(maximum_delta, float(np.abs(positions - basis).max()))
            passed = finite and maximum_delta > 1e-6
            info.update({'action': action.name, 'shape_count': len(keys.key_blocks),
                         'finite_shape_coordinates': finite,
                         'maximum_shape_coordinate_change_m': maximum_delta,
                         'passed': passed})
            if not passed:
                errors.append(f'FX shape geometry must be finite and visibly change: {ob.name}')
        data['radiance_actions'] = sorted(radiance)
        if not radiance:
            errors.append(f'No scene-local animated FX radiance in Codex_{clip}')
    report['evaluated_results'] = evaluated_fx_validation(errors)
    return report


def sample(scene, rig, action, t, meshes):
    rig.animation_data.action = action
    if len(action.slots):
        rig.animation_data.action_slot = action.slots[0]
    frame = 1 + t * FPS
    scene.frame_set(math.floor(frame), subframe=frame % 1)
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated_rig = rig.evaluated_get(graph)
    matrices = np.array([np.array(bone.matrix) for bone in evaluated_rig.pose.bones])
    points = {}
    for ob in meshes:
        evaluated = ob.evaluated_get(graph)
        coords = np.empty(len(evaluated.data.vertices) * 3, dtype=np.float32)
        evaluated.data.vertices.foreach_get('co', coords)
        transform = np.array(evaluated.matrix_world, dtype=np.float64)
        points[ob.name] = (coords.reshape(-1, 3) @ transform[:3, :3].T
                           + transform[:3, 3])
    return matrices, points


def difference(first, second):
    matrix_error = float(np.abs(first[0] - second[0]).max())
    mesh_error = max(float(np.linalg.norm(first[1][name] - second[1][name], axis=1).max())
                     for name in first[1])
    return {'max_bone_matrix_difference': matrix_error,
            'max_vertex_displacement_m': mesh_error,
            'passed': matrix_error <= MATRIX_TOL and mesh_error <= POSITION_TOL}


def motion_measurements(rig, matrices):
    """Observe posed geometry; do not inspect how the animation was authored."""
    indices = {bone.name: index for index, bone in enumerate(rig.pose.bones)}
    world = np.array(rig.matrix_world, dtype=np.float64)

    def matrix(name):
        return world @ matrices[indices[name]]

    hips = matrix('Hips')
    # Convert the rest-world transverse/up axes to the posed orientation so
    # the result does not depend on the armature's bone-axis convention.
    rest = np.array(rig.data.bones['Hips'].matrix_local, dtype=np.float64)
    orientation = hips[:3, :3] @ np.linalg.inv(rest[:3, :3])
    right, up = orientation[:, 0], orientation[:, 2]
    bank = math.degrees(math.atan2(right[2], math.hypot(right[0], right[1])))
    upright = float(up[2] / np.linalg.norm(up))
    first, last = matrix('Tail01'), matrix('Tail08')
    tip = last @ np.array([0, rig.data.bones['Tail08'].length, 0, 1])
    tail_matrices = [matrix(f'Tail{i:02}') for i in range(1, 9)]
    tail_points = np.array([m[:3, 3] for m in tail_matrices] + [tip[:3]])
    directions = np.diff(tail_points, axis=0)
    segment_lengths = np.linalg.norm(directions, axis=1)
    directions /= segment_lengths[:, None]
    pitches = np.unwrap(np.arctan2(directions[:, 2], directions[:, 1]))
    curvature = np.degrees(np.diff(pitches))
    joint_angles = np.degrees(np.arccos(np.clip((directions[:-1] * directions[1:]).sum(axis=1), -1, 1)))
    joint_gaps = [np.linalg.norm((m @ np.array([0, rig.data.bones[f'Tail{i+1:02}'].length, 0, 1]))[:3]
                                 - tail_matrices[i+1][:3, 3])
                  for i, m in enumerate(tail_matrices[:-1])]
    first_axis, last_axis = first[:3, 1], last[:3, 1]
    dot = float(np.dot(first_axis, last_axis) / (np.linalg.norm(first_axis) * np.linalg.norm(last_axis)))
    bend = math.acos(max(-1.0, min(1.0, dot)))
    return {
        'hips_bank_deg': bank,
        'hips_up_dot_world_up': upright,
        'hips_height_m': float(hips[2, 3]),
        'chest_height_m': float(matrix('Chest')[2, 3]),
        'head_height_m': float(matrix('Head')[2, 3]),
        'bone_world_positions_m': {
            name: matrix(name)[:3, 3].tolist()
            for name in ('Hips', 'Chest', 'Head', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot')},
        'tail_points_relative_to_base_m': (tail_points - tail_points[0]).tolist(),
        'tail_directions': directions.tolist(),
        'tail_segment_lengths_m': segment_lengths.tolist(),
        'tail_pitch_deg': np.degrees(pitches).tolist(),
        'tail_sagittal_curvature_deg': curvature.tolist(),
        'tail_maximum_joint_angle_deg': float(joint_angles.max()),
        'tail_maximum_joint_gap_m': float(max(joint_gaps)),
        'tail_proximal_to_distal_3d_bend_rad': bend,
    }


def tail_motion_validation(rig, action, clip, observations):
    """Measure shape, stability and propagation from the saved poses only."""
    legacy_limits = LEGACY_WALK_STYLE_LIMITS.get(clip, {})
    times = np.array([m['time_s'] for m in observations])
    points = np.array([m['tail_points_relative_to_base_m'] for m in observations])
    directions = np.array([m['tail_directions'] for m in observations])
    pitches = np.array([m['tail_pitch_deg'] for m in observations])
    curvature = np.array([m['tail_sagittal_curvature_deg'] for m in observations])
    lengths = np.array([rig.data.bones[f'Tail{i:02}'].length for i in range(1, 9)])
    total_length = float(lengths.sum())
    tip_ranges = np.ptp(points[:, -1], axis=0)
    proximal_ranges = np.ptp(points[:, 2], axis=0)
    proximal_range = float(np.linalg.norm(proximal_ranges))
    tip_range = float(np.linalg.norm(tip_ranges))
    longitudinal_span = np.ptp(points[:, :, 1], axis=1)
    maximum_length_error = float(np.abs(np.array([m['tail_segment_lengths_m'] for m in observations]) - lengths).max())
    maximum_gap = max(m['tail_maximum_joint_gap_m'] for m in observations)
    maximum_joint_angle = max(m['tail_maximum_joint_angle_deg'] for m in observations)
    # Ignore turns under three degrees when identifying a visible inflection.
    s_shapes = (curvature.min(axis=1) < -3) & (curvature.max(axis=1) > 3)
    j_shapes = ~s_shapes & (np.abs(curvature.sum(axis=1)) > 40)
    # This correlation describes sagittal timing only. It is not a quality
    # gate for multi-axis action-linked motion. Resample to a regular time grid
    # because event times and the exact Walk endpoint lie between half-frames.
    uniform_times = np.arange(0, times[-1] + 1e-8, 1 / (FPS * 2))
    middle = np.interp(uniform_times, times, pitches[:, 3])
    distal = np.interp(uniform_times, times, pitches[:, 7])
    maximum_lag_steps = math.floor(min(1.0, times[-1] * .46) * FPS * 2)
    lag_candidates = []
    for shift in range(-maximum_lag_steps, maximum_lag_steps + 1):
        a, b = ((middle[:-shift], distal[shift:]) if shift > 0 else
                (middle[-shift:], distal[:shift]) if shift < 0 else (middle, distal))
        if len(a) > 10 and np.std(a) > 1e-5 and np.std(b) > 1e-5:
            lag_candidates.append((float(np.corrcoef(a, b)[0, 1]), shift / (FPS * 2)))
    correlation, lag = max(lag_candidates) if lag_candidates else (0.0, 0.0)
    vertical_ratio = float(tip_ranges[2] / total_length)
    lateral_ratio = float(tip_ranges[0] / total_length)
    longitudinal_ratio = float(longitudinal_span.min() / total_length)
    checks = {
        'constant_segment_lengths_and_connected_joints': maximum_length_error <= POSITION_TOL and maximum_gap <= POSITION_TOL,
        # Apply the existing local bend guard to every reauthored tail. This
        # detects concentrated corners, not expressive or reference fidelity.
        'distributed_curvature': maximum_joint_angle < 70,
    }
    legacy_style_diagnostics = {}
    if clip == 'Walk':
        legacy_style_diagnostics = {
            'quiet_proximal_section': proximal_range <= total_length * .08 and proximal_range <= tip_range * .25,
            'bounded_vertical_motion': legacy_limits['vertical_range_ratio'][0] <= vertical_ratio <= legacy_limits['vertical_range_ratio'][1],
            'modest_lateral_motion': lateral_ratio <= legacy_limits['maximum_lateral_range_ratio'],
            'readable_longitudinal_silhouette': longitudinal_ratio >= legacy_limits['minimum_longitudinal_span_ratio'],
            'changing_s_and_j_curves': bool(s_shapes.any() and j_shapes.any()),
            'bend_travels_toward_tip': correlation >= .70 and legacy_limits['lag_range_s'][0] <= lag <= legacy_limits['lag_range_s'][1],
        }

    # Timing diagnostics are deliberately reported without a guessed quality
    # threshold. They locate fast changes for visual review and expose Euler
    # wrapping or an abrupt final return without equating speed with liveliness.
    dt = np.diff(times)
    velocity = np.diff(points[:, -1], axis=0) / dt[:, None]
    speed = np.linalg.norm(velocity, axis=1)
    angular_steps = np.degrees(np.arccos(np.clip((directions[:-1] * directions[1:]).sum(axis=2), -1, 1)))
    angular_speed = angular_steps / dt[:, None]
    interval_centers = (times[1:] + times[:-1]) / 2
    acceleration = np.diff(velocity, axis=0) / np.diff(interval_centers)[:, None]
    acceleration_magnitude = np.linalg.norm(acceleration, axis=1)
    largest_step = None
    wraps = []
    for fc in curves(action):
        if 'pose.bones["Tail' not in fc.data_path or not fc.data_path.endswith('.rotation_euler'):
            continue
        keys = sorted(fc.keyframe_points, key=lambda key: key.co.x)
        for first_key, second_key in zip(keys, keys[1:]):
            degrees = math.degrees(abs(second_key.co.y - first_key.co.y))
            info = {'channel': fc.data_path, 'axis': fc.array_index,
                    'time_s': float((second_key.co.x - 1) / FPS), 'raw_step_deg': degrees}
            if largest_step is None or degrees > largest_step['raw_step_deg']:
                largest_step = info
            if degrees > 180:
                wraps.append(info)
    speed_index = int(speed.argmax())
    angular_index = np.unravel_index(angular_speed.argmax(), angular_speed.shape)
    acceleration_index = int(acceleration_magnitude.argmax())
    final_intervals = interval_centers >= times[-1] - .5
    return {
        'measurement': 'Evaluated saved control centreline; distances relative to Tail01; sagittal plane YZ',
        'tail_length_m': total_length,
        'tip_range_xyz_m': tip_ranges.tolist(),
        'proximal_two_bone_tip_range_xyz_m': proximal_ranges.tolist(),
        'proximal_to_distal_travel_ratio': proximal_range / tip_range if tip_range else 0.0,
        'base_pitch_range_deg': float(np.ptp(pitches[:, 0])),
        'distal_pitch_range_deg': float(np.ptp(pitches[:, -1])),
        'minimum_longitudinal_span_m': float(longitudinal_span.min()),
        'minimum_longitudinal_span_ratio': longitudinal_ratio,
        'vertical_tip_range_ratio': vertical_ratio,
        'lateral_tip_range_ratio': lateral_ratio,
        'maximum_segment_length_error_m': maximum_length_error,
        'maximum_joint_gap_m': maximum_gap,
        'maximum_adjacent_joint_angle_deg': maximum_joint_angle,
        's_shape_samples': int(s_shapes.sum()), 'j_shape_samples': int(j_shapes.sum()),
        'middle_to_tip_lag_s': lag, 'middle_to_tip_lag_correlation': correlation,
        'limits': {'maximum_adjacent_joint_angle_deg': 70},
        'checks': checks,
        'historical_walk_style_diagnostics': {
            'gates_validation': False,
            'interpretation': 'Old choreography descriptors; not a naturalness or reference-match score',
            'limits': legacy_limits, 'observations': legacy_style_diagnostics,
        } if clip == 'Walk' else None,
        'timing_diagnostics': {
            'maximum_tip_speed_m_s': float(speed[speed_index]),
            'maximum_tip_speed_time_s': float(interval_centers[speed_index]),
            'maximum_tip_acceleration_m_s2': float(acceleration_magnitude[acceleration_index]),
            'maximum_tip_acceleration_time_s': float(times[acceleration_index + 1]),
            'maximum_direction_speed_deg_s': float(angular_speed[angular_index]),
            'maximum_direction_speed_time_s': float(interval_centers[angular_index[0]]),
            'maximum_direction_speed_bone': f'Tail{angular_index[1]+1:02}',
            'last_half_second_maximum_tip_speed_m_s': float(speed[final_intervals].max()),
            'loop_tip_velocity_difference_m_s': float(np.linalg.norm(velocity[-1] - velocity[0])),
            'largest_raw_euler_key_step': largest_step, 'raw_euler_steps_over_180_degrees': wraps,
        },
        'passed': all(checks.values()),
    }


def idle_body_measurements(observations):
    """Report the requested gestures without guessing a reference-match score."""
    times = np.array([state['time_s'] for state in observations])

    def at(time):
        index = int(np.abs(times - time).argmin())
        return observations[index]

    def position(state, bone):
        return np.array(state['bone_world_positions_m'][bone])

    def paw_window(bone, start, end):
        states = [state for state in observations if start - 1e-8 <= state['time_s'] <= end + 1e-8]
        positions = np.array([position(state, bone) for state in states])
        heights = np.array([state['paw_lowest_vertex_z_m']['Pyrefang_' + bone] for state in states])
        peak = int(heights.argmax())
        return {
            'window_s': [start, end], 'sample_count': len(states),
            'joint_start_world_xyz_m': positions[0].tolist(),
            'joint_end_world_xyz_m': positions[-1].tolist(),
            'joint_displacement_xyz_m': (positions[-1] - positions[0]).tolist(),
            'joint_range_xyz_m': np.ptp(positions, axis=0).tolist(),
            'maximum_joint_horizontal_distance_from_start_m': float(np.linalg.norm(positions[:, :2] - positions[0, :2], axis=1).max()),
            'lowest_vertex_height_range_m': [float(heights.min()), float(heights.max())],
            'maximum_lowest_vertex_height_time_s': states[peak]['time_s'],
            'maximum_lift_above_window_start_m': float(heights.max() - heights[0]),
        }

    standing, seated, recovered = (at(time) for time in (6.6, 7.9, 9.15))
    body = {
        name: {
            'standing_world_xyz_m': position(standing, name).tolist(),
            'seated_world_xyz_m': position(seated, name).tolist(),
            'displacement_xyz_m': (position(seated, name) - position(standing, name)).tolist(),
            'height_drop_m': float(position(standing, name)[2] - position(seated, name)[2]),
        }
        for name in ('Hips', 'Chest', 'Head')
    }
    hind_placement = {
        name: {
            'standing_world_xyz_m': position(standing, name).tolist(),
            'seated_world_xyz_m': position(seated, name).tolist(),
            'recovered_world_xyz_m': position(recovered, name).tolist(),
            'standing_to_seated_xyz_m': (position(seated, name) - position(standing, name)).tolist(),
            'seated_to_recovered_xyz_m': (position(recovered, name) - position(seated, name)).tolist(),
        }
        for name in ('L_Foot', 'R_Foot')
    }
    return {
        'intent': 'Descriptive measurements of saved poses; no numerical claim of matching reference quality',
        'coordinates': 'World metres; Pyrefang faces negative Y; paw joints and evaluated paw mesh minima',
        'standing_seated_recovered_times_s': [standing['time_s'], seated['time_s'], recovered['time_s']],
        'seated_body_change': body,
        'chest_relative_to_hips_height_increase_m': float(
            (position(seated, 'Chest') - position(seated, 'Hips'))[2]
            - (position(standing, 'Chest') - position(standing, 'Hips'))[2]),
        'forepaws_during_sit': {name: paw_window(name, 6.6, 8.95) for name in ('L_Hand', 'R_Hand')},
        'forepaw_lifts': {
            'R_Hand': paw_window('R_Hand', 2.7, 3.15),
            'L_Hand': paw_window('L_Hand', 3.85, 4.30),
        },
        'near_hind_paw_steps': {
            'forward': paw_window('L_Foot', 6.95, 7.35),
            'backward': paw_window('L_Foot', 8.5, 8.95),
        },
        'hind_paw_placement': hind_placement,
    }


def shared_seam_pairs(meshes):
    """Find coincident cut vertices independently of the skin-repair code.

    Vertex data remains in its saved rest shape. Paired cut copies should
    continue coinciding after deformation, including the head/neck collar.
    The separate jaw is excluded so the mouth remains intentionally free.
    """
    vertices = [(ob.name, vertex.index, tuple(ob.matrix_world @ vertex.co))
                for ob in meshes if not ob.name.endswith('_Jaw')
                for vertex in ob.data.vertices]
    tree = KDTree(len(vertices))
    for index, (_, _, point) in enumerate(vertices):
        tree.insert(point, index)
    tree.balance()
    pairs = {}
    for index, (name, vertex, point) in enumerate(vertices):
        for _, other, _ in tree.find_range(point, REST_SEAM_MATCH_TOL):
            other_name, other_vertex, _ = vertices[other]
            if other > index and other_name != name:
                pairs.setdefault((name, other_name), []).append((vertex, other_vertex))
    return {names: np.array(indices, dtype=np.int32) for names, indices in pairs.items()}


def seam_gap(points, pairs):
    largest = 0.0
    worst = None
    for (first, second), indices in pairs.items():
        distances = np.linalg.norm(points[first][indices[:, 0]] - points[second][indices[:, 1]], axis=1)
        index = int(np.argmax(distances))
        if distances[index] > largest:
            largest = float(distances[index])
            worst = {'meshes': [first, second], 'vertices': indices[index].tolist()}
    return largest, worst


def validate():
    digest = hashlib.sha256(BLEND.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(BLEND), load_ui=False)
    scene = bpy.context.scene
    rig = bpy.data.objects.get('PyrefangRig')
    expected = {'Codex_' + name for name in CLIPS}
    actual = set(bpy.data.actions.keys())
    report = {
        'blend_file': str(BLEND.relative_to(ROOT)),
        'blend_sha256': digest,
        'read_only_blend': True,
        'fps': scene.render.fps / scene.render.fps_base,
        'expected_actions': sorted(expected),
        'actual_actions': sorted(actual),
        'sampling': 'Every frame and half-frame, plus exact endpoints and events',
        'tolerances': {'frame': FRAME_TOL, 'bone_matrix': MATRIX_TOL,
                       'vertex_displacement_m': POSITION_TOL,
                       'ground_penetration_m': GROUND_TOL,
                       'rest_seam_pair_match_m': REST_SEAM_MATCH_TOL,
                       'animated_seam_gap_m': ANIMATED_SEAM_TOL},
        'tail_validation_intent': 'Measure every clip tail; preserve connected, unstretched bones and apply the existing 70-degree local bend guard to all six tails. Historical Walk silhouette and sagittal correlation thresholds are descriptive only for the reauthored action tails. Ground, seams, finite poses, loop endpoints and Death stillness remain gated.',
        'errors': [], 'clips': {}, 'neutral_connections': {},
    }
    errors = report['errors']
    extra = {name for name in actual - expected if not name.startswith('CodexFX_')}
    if not expected <= actual or extra:
        errors.append(f'Action names differ: missing={sorted(expected - actual)}, extra={sorted(extra)}')
    report['fx'] = fx_validation(errors)
    if abs(report['fps'] - FPS) > 1e-8:
        errors.append(f'Expected {FPS} fps, got {report["fps"]}')
    if rig is None or rig.type != 'ARMATURE':
        errors.append('PyrefangRig armature is missing')
        return report
    if rig.animation_data is None:
        errors.append('PyrefangRig has no animation data')
        return report
    report['scenes'] = {}
    for clip, duration in CLIPS.items():
        ready = bpy.data.scenes.get('Codex_' + clip)
        if ready is None:
            errors.append(f'Missing ready-to-play scene: Codex_{clip}')
            continue
        rigs = [ob for ob in ready.objects if ob.type == 'ARMATURE']
        correct = (len(rigs) == 1 and rigs[0].animation_data
                   and rigs[0].animation_data.action
                   and rigs[0].animation_data.action.name == 'Codex_' + clip
                   and ready.frame_start == 1
                   and ready.frame_end == math.ceil(duration * FPS))
        report['scenes'][clip] = {'ready_to_play': bool(correct)}
        if not correct:
            errors.append(f'Wrong rig, action or preview range in Codex_{clip}')
        elif any(mod.object != rigs[0] for ob in ready.objects
                 for mod in ob.modifiers if mod.type == 'ARMATURE'):
            errors.append(f'A mesh is attached to another scene rig in Codex_{clip}')
    meshes = [ob for ob in scene.objects
              if ob.type == 'MESH' and ob.name.startswith('Pyrefang_')
              and not ob.name.startswith('Pyrefang_FX')]
    if not meshes:
        errors.append('No Pyrefang body meshes found')
        return report
    report['mesh_count'] = len(meshes)
    report['bone_count'] = len(rig.pose.bones)
    report['evaluated_vertex_count'] = sum(len(ob.data.vertices) for ob in meshes)
    report['surface_topology'] = validate_surface_topology(meshes)
    if not report['surface_topology']['passed']:
        errors.append('Body skin must be closed and consistently oriented outside the articulated mouth')
    seam_pairs = shared_seam_pairs(meshes)
    report['skin_seams'] = {
        'method': 'Coincident rest-surface pairs across separate body meshes including Head/Neck; articulated Jaw excluded',
        'paired_vertices': sum(len(indices) for indices in seam_pairs.values()),
        'pairs_by_mesh': {' / '.join(names): len(indices) for names, indices in seam_pairs.items()},
    }
    if not seam_pairs:
        errors.append('No cut-surface vertex pairs found for skin continuity validation')
    endpoints = {}
    for clip, duration in CLIPS.items():
        action = bpy.data.actions.get('Codex_' + clip)
        if action is None:
            continue
        clip_errors = []
        fcurves = curves(action)
        key_count = 0
        key_frames = []
        invalid_keys = []
        for fc in fcurves:
            for key in fc.keyframe_points:
                key_count += 1
                values = (*key.co, *key.handle_left, *key.handle_right,
                          key.amplitude, key.back, key.period)
                if not all(math.isfinite(value) for value in values):
                    invalid_keys.append(f'{fc.data_path}[{fc.array_index}]')
                key_frames.append(float(key.co.x))
        if invalid_keys:
            clip_errors.append(f'Non-finite keyframes in {len(invalid_keys)} keys')
        end_frame = 1 + duration * FPS
        if not key_frames:
            clip_errors.append('Action has no keyframes')
        elif abs(min(key_frames) - 1) > FRAME_TOL or abs(max(key_frames) - end_frame) > FRAME_TOL:
            clip_errors.append('Actual keyed frame range does not match duration')
        if (not action.use_frame_range or abs(action.frame_start - 1) > FRAME_TOL
                or abs(action.frame_end - end_frame) > FRAME_TOL):
            clip_errors.append('Declared action frame range does not match duration')
        saved_duration = action.get('duration')
        if (not isinstance(saved_duration, (float, int)) or not math.isfinite(saved_duration)
                or abs(saved_duration - duration) > 1e-6):
            clip_errors.append('Duration metadata is missing or incorrect')
        if bool(action.get('loop', False)) != (clip in ('Idle', 'Walk')):
            clip_errors.append('Loop metadata is incorrect')
        if clip == 'Attack':
            release = action.get('release')
            if (not isinstance(release, (float, int)) or not math.isfinite(release)
                    or abs(release - .55) > 1e-8):
                clip_errors.append('Attack release must be exactly 0.55 seconds')
            if not any(abs(frame - (1 + .55 * FPS)) <= FRAME_TOL for frame in key_frames):
                clip_errors.append('Attack has no key at the exact release time')
        times = {i / (FPS * 2) for i in range(math.floor(duration * FPS * 2) + 1)}
        times.add(duration)
        if clip == 'Idle':
            times.update(IDLE_EVENT_TIMES)
        if clip == 'Attack':
            times.add(.55)
        if clip == 'Death':
            times.add(2.7)
        min_ground = float('inf')
        max_ground = float('-inf')
        worst_ground = None
        penetrations = []
        nonfinite_samples = []
        foot_ranges = {ob.name: [float('inf'), float('-inf')] for ob in meshes
                       if ob.name.endswith(('_Hand', '_Foot'))}
        still_base = None
        still_matrix_error = 0.0
        still_mesh_error = 0.0
        still_samples = 0
        observed_motion = []
        final_ground = {}
        maximum_seam_gap = 0.0
        worst_seam_sample = None
        for t in sorted(times):
            state = sample(scene, rig, action, t, meshes)
            if not np.isfinite(state[0]).all() or any(not np.isfinite(p).all() for p in state[1].values()):
                nonfinite_samples.append(t)
                continue
            minima = {name: float(points[:, 2].min()) for name, points in state[1].items()}
            observed_motion.append(motion_measurements(rig, state[0]))
            observed_motion[-1]['time_s'] = t
            observed_motion[-1]['paw_lowest_vertex_z_m'] = {
                name: height for name, height in minima.items()
                if name.endswith(('_Hand', '_Foot'))}
            if t == duration:
                final_ground = minima
            gap, worst = seam_gap(state[1], seam_pairs)
            if gap > maximum_seam_gap:
                maximum_seam_gap = gap
                worst_seam_sample = {'time_s': t, 'gap_m': gap, **worst}
            bottom_mesh = min(minima, key=minima.get)
            bottom = minima[bottom_mesh]
            if bottom < min_ground:
                min_ground = bottom
                worst_ground = {'time_s': t, 'mesh': bottom_mesh, 'minimum_z_m': bottom}
            max_ground = max(max_ground, bottom)
            if bottom < -GROUND_TOL:
                penetrations.append({'time_s': t, 'mesh': bottom_mesh, 'minimum_z_m': bottom})
            for name in foot_ranges:
                foot_ranges[name][0] = min(foot_ranges[name][0], minima[name])
                foot_ranges[name][1] = max(foot_ranges[name][1], minima[name])
            if t == 0 or t == duration:
                endpoints[(clip, t == duration)] = state
            if clip == 'Death' and t >= 2.7:
                if still_base is None:
                    still_base = state
                delta = difference(still_base, state)
                still_matrix_error = max(still_matrix_error, delta['max_bone_matrix_difference'])
                still_mesh_error = max(still_mesh_error, delta['max_vertex_displacement_m'])
                still_samples += 1
        if nonfinite_samples:
            clip_errors.append(f'Non-finite bone matrices or mesh vertices at {len(nonfinite_samples)} samples')
        if penetrations:
            clip_errors.append(f'Ground penetration exceeds tolerance at {len(penetrations)} samples')
        if maximum_seam_gap > ANIMATED_SEAM_TOL:
            clip_errors.append('Cut body surface separates across a skin seam')
        result = {
            'duration_s': duration, 'expected_frame_range': [1, end_frame],
            'declared_frame_range': [action.frame_start, action.frame_end],
            'keyed_frame_range': [min(key_frames), max(key_frames)] if key_frames else None,
            'fcurve_count': len(fcurves), 'key_count': key_count,
            'nonfinite_key_count': len(invalid_keys),
            'evaluated_samples': len(times), 'nonfinite_sample_times_s': nonfinite_samples,
            'minimum_ground_z_m': min_ground if math.isfinite(min_ground) else None,
            'maximum_ground_z_m': max_ground if math.isfinite(max_ground) else None,
            'worst_ground_sample': worst_ground,
            'ground_penetrations': penetrations,
            'skin_seam_continuity': {
                'maximum_gap_m': maximum_seam_gap,
                'worst_sample': worst_seam_sample,
                'passed': bool(seam_pairs) and maximum_seam_gap <= ANIMATED_SEAM_TOL,
            },
            'foot_lowest_vertex_ranges_m': {
                name: [value if math.isfinite(value) else None for value in bounds]
                for name, bounds in foot_ranges.items()},
            'errors': clip_errors,
        }
        if clip == 'Attack':
            result['release_s'] = action.get('release')
        if clip == 'Idle' and observed_motion:
            result['body_gestures'] = idle_body_measurements(observed_motion)
        if clip in ('Idle', 'Walk') and (clip, False) in endpoints and (clip, True) in endpoints:
            result['loop_endpoint'] = difference(endpoints[(clip, False)], endpoints[(clip, True)])
            if not result['loop_endpoint']['passed']:
                clip_errors.append('Loop endpoints do not match')
        if observed_motion:
            result['tail_motion'] = tail_motion_validation(rig, action, clip, observed_motion)
            if not result['tail_motion']['passed']:
                failed = [name for name, passed in result['tail_motion']['checks'].items() if not passed]
                clip_errors.append('Tail centreline regression: ' + ', '.join(failed))
        if clip == 'Death':
            result['stillness_2_7_to_3_s'] = {
                'samples': still_samples,
                'max_bone_matrix_difference': still_matrix_error,
                'max_vertex_displacement_m': still_mesh_error,
                'passed': still_samples >= 2 and still_matrix_error <= MATRIX_TOL and still_mesh_error <= POSITION_TOL,
            }
            if not result['stillness_2_7_to_3_s']['passed']:
                clip_errors.append('Death continues moving after 2.7 seconds')
            max_bank = max(abs(m['hips_bank_deg']) for m in observed_motion)
            min_upright = min(m['hips_up_dot_world_up'] for m in observed_motion)
            final = observed_motion[-1]
            body_gap = final_ground.get('Pyrefang_Body', float('inf'))
            head_gap = min(final_ground.get(name, float('inf'))
                           for name in ('Pyrefang_Head', 'Pyrefang_Jaw'))
            result['belly_down_collapse'] = {
                'maximum_hips_lateral_bank_deg': max_bank,
                'maximum_allowed_bank_deg': DEATH_MAX_BANK_DEG,
                'minimum_hips_up_dot_world_up': min_upright,
                'final_hips_height_m': final['hips_height_m'],
                'final_head_height_m': final['head_height_m'],
                'final_body_floor_gap_m': body_gap if math.isfinite(body_gap) else None,
                'final_head_floor_gap_m': head_gap if math.isfinite(head_gap) else None,
                'passed': (max_bank <= DEATH_MAX_BANK_DEG and min_upright >= .90
                           and final['hips_height_m'] <= DEATH_MAX_FINAL_JOINT_HEIGHT
                           and final['head_height_m'] <= DEATH_MAX_FINAL_JOINT_HEIGHT
                           and body_gap <= DEATH_MAX_BODY_GAP
                           and head_gap <= DEATH_MAX_HEAD_GAP),
            }
            if not result['belly_down_collapse']['passed']:
                clip_errors.append('Death must remain upright laterally and settle belly/head near the floor')
        result['passed'] = not clip_errors
        report['clips'][clip] = result
        errors.extend(f'{clip}: {error}' for error in clip_errors)
        print('CODEX_VALIDATED', clip, 'PASS' if result['passed'] else 'FAIL',
              'samples', len(times), 'minimum_z', result['minimum_ground_z_m'], flush=True)
    idle = endpoints.get(('Idle', False))
    if idle is not None:
        for clip, end in [('Attack', False), ('Attack', True), ('Roar', False),
                          ('Roar', True), ('Rise', True), ('Emerge', True), ('Death', False)]:
            state = endpoints.get((clip, end))
            if state is None:
                continue
            name = clip + ('_end' if end else '_start')
            delta = difference(idle, state)
            report['neutral_connections'][name] = delta
            if not delta['passed']:
                errors.append(name + ': pose does not match Idle start')
    if hashlib.sha256(BLEND.read_bytes()).hexdigest() != digest:
        report['read_only_blend'] = False
        errors.append('Codex .blend changed during validation')
    return report


if __name__ == '__main__':
    result = validate()
    result['passed'] = not result['errors']
    destination = OUT / 'validation_report.json'
    destination.write_text(json.dumps(result, indent=2, allow_nan=False), encoding='utf-8')
    print('CODEX_VALIDATION_REPORT', destination, flush=True)
    print('CODEX_VALIDATION', 'PASS' if result['passed'] else 'FAIL', flush=True)
    for error in result['errors']:
        print('CODEX_VALIDATION_ERROR', error, flush=True)
    if not result['passed']:
        raise RuntimeError('Pyrefang Codex validation failed; see validation_report.json')

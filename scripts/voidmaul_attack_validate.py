"""Read-only geometry, contact, IK and endpoint QA for a Voidmaul attack.

Pass the 14 segmented meshes, the rig, a sequence of frames (floating point
frames are supported), and planted contact windows keyed by ``LIMBS`` label.
For example ``{'Fore_R': [(1, 45), (85, 240)], ...}``. Contact windows describe
separate plants, so each window receives its own horizontal drift anchor.
The function restores both the original frame and subframe. It neither keys,
saves nor changes actions, constraints, skin weights or topology.
"""

import math
from collections import Counter

import bpy
from mathutils import Vector

from voidmaul_walk import ACTION_NAME as WALK_ACTION_NAME
from voidmaul_walk import LIMBS, _fcurves, _sole_samples


def _at_frame(scene, frame):
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame - integer)
    bpy.context.view_layer.update()


def _contact_index(windows, frame):
    for index, (start, end) in enumerate(windows):
        if start - 1e-8 <= frame <= end + 1e-8:
            return index
    return None


def validate_attack(rig, meshes, frames, contact_windows, endpoint_frames,
                    floor=None, sole_clearance=None,
                    contact_tolerance_fraction=0.0015,
                    seam_tolerance_fraction=0.00005,
                    endpoint_tolerance_fraction=0.0001,
                    ik_tolerance_fraction=0.0005,
                    penetration_tolerance_fraction=0.0001,
                    drift_tolerance_fraction=0.005,
                    require_endpoint_match=True,
                    floor_occlusion_until_frame=None,
                    contact_sampling='rest_soles'):
    """Measure actual evaluated geometry at every supplied attack frame.

    Distances use armature/model coordinates, except seam and endpoint surface
    distances, which use world coordinates. As with the original Voidmaul
    audits, the rig's object transform is expected to have unit scale. The
    report includes that scale so the units are explicit.
    """
    if rig.type != 'ARMATURE':
        raise TypeError('rig must be an armature')
    meshes = [mesh for mesh in meshes if mesh.type == 'MESH']
    if not meshes:
        raise ValueError('No segmented meshes supplied')
    endpoint_frames = tuple(float(frame) for frame in endpoint_frames)
    if len(endpoint_frames) != 2:
        raise ValueError('endpoint_frames must contain the first and last pose')
    frames = sorted(set(float(frame) for frame in frames) | set(endpoint_frames))
    if not frames or not all(math.isfinite(frame) for frame in frames):
        raise ValueError('frames must contain finite frame values')
    unknown = set(contact_windows) - set(LIMBS)
    if unknown:
        raise ValueError('Unknown contact limbs: ' + ', '.join(sorted(unknown)))
    for label, windows in contact_windows.items():
        if any(len(window) != 2 or window[0] > window[1] for window in windows):
            raise ValueError('Invalid contact window for ' + label)
    source_ids = {}
    edges, winding = Counter(), Counter()
    source_set = set()
    inverse = rig.matrix_world.inverted()
    rest_points = []
    for mesh in meshes:
        attribute = mesh.data.attributes.get('SourceVertex')
        if attribute is None or attribute.domain != 'POINT':
            raise ValueError('Missing POINT SourceVertex attribute on ' + mesh.name)
        ids = [datum.value for datum in attribute.data]
        if len(ids) != len(mesh.data.vertices):
            raise ValueError('SourceVertex count mismatch on ' + mesh.name)
        source_ids[mesh] = ids
        source_set.update(ids)
        transform = inverse @ mesh.matrix_world
        rest_points.extend(transform @ vertex.co for vertex in mesh.data.vertices)
        for face in mesh.data.polygons:
            face_ids = [ids[index] for index in face.vertices]
            for a, b in zip(face_ids, face_ids[1:] + face_ids[:1]):
                edge = tuple(sorted((a, b)))
                edges[edge] += 1
                winding[edge] += 1 if a < b else -1
    height = max(point.z for point in rest_points) - min(point.z for point in rest_points)
    if height <= 0:
        raise ValueError('Degenerate model height')
    rest_floor, sole_samples = _sole_samples(rig, meshes, height)
    if contact_sampling == 'foot_segments':
        # A relaxed corpse can rest on the outer fingers after a paw rolls.
        # Its original standing sole patch no longer defines actual contact.
        for label in LIMBS:
            region = ('ForeFoot.' if LIMBS[label]['front'] else 'HindFoot.') + label[-1]
            foot_parts = [mesh for mesh in meshes if mesh.get('anatomy_region') == region]
            if not foot_parts:
                raise ValueError('Missing foot segment for ' + label)
            sole_samples[label] = [(mesh, vertex.index) for mesh in foot_parts
                                   for vertex in mesh.data.vertices]
    elif contact_sampling != 'rest_soles':
        raise ValueError('Unknown contact sampling: ' + contact_sampling)
    floor = rest_floor if floor is None else float(floor)
    sole_clearance = height * 0.00035 if sole_clearance is None else float(sole_clearance)
    wanted = {mesh: {} for mesh in meshes}
    for label, refs in sole_samples.items():
        for mesh, index in refs:
            wanted[mesh].setdefault(index, []).append(label)
    scene = bpy.context.scene
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    anchors, endpoints = {}, {}
    contact_count = {label: 0 for label in LIMBS}
    max_contact = {label: 0.0 for label in LIMBS}
    worst_contact = {label: None for label in LIMBS}
    max_skin_drift = {label: 0.0 for label in LIMBS}
    max_target_drift = {label: 0.0 for label in LIMBS}
    max_ik_gap = {label: 0.0 for label in LIMBS}
    max_terminal_gap = {label: 0.0 for label in LIMBS}
    max_reach_ratio = {label: 0.0 for label in LIMBS}
    max_chain_length = {label: 0.0 for label in LIMBS}
    seam_error, worst_seam, max_penetration, worst_floor = 0.0, None, 0.0, None
    bounds = []
    try:
        for frame in frames:
            _at_frame(scene, frame)
            graph = bpy.context.evaluated_depsgraph_get()
            seen = {}
            sole_z = {label: math.inf for label in LIMBS}
            patches = {label: [] for label in LIMBS}
            z_min = math.inf
            for part in meshes:
                ids = source_ids[part]
                evaluated = part.evaluated_get(graph)
                geometry = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
                try:
                    if len(geometry.vertices) != len(ids):
                        raise ValueError('A modifier changed vertex count: ' + part.name)
                    attr = geometry.attributes.get('SourceVertex')
                    if attr is None or [datum.value for datum in attr.data] != ids:
                        raise ValueError('Evaluated SourceVertex order mismatch: ' + part.name)
                    transform = inverse @ evaluated.matrix_world
                    for vertex, source_id in zip(geometry.vertices, ids):
                        world = evaluated.matrix_world @ vertex.co
                        model = transform @ vertex.co
                        z_min = min(z_min, model.z)
                        for label in wanted[part].get(vertex.index, ()):
                            sole_z[label] = min(sole_z[label], model.z)
                            patches[label].append(model)
                        if source_id in seen:
                            gap = (world - seen[source_id]).length
                            if gap > seam_error:
                                seam_error, worst_seam = gap, frame
                        seen[source_id] = world.copy()
                finally:
                    evaluated.to_mesh_clear()
            if set(seen) != source_set:
                raise ValueError('Evaluated assembled SourceVertex set changed')
            if any(not math.isfinite(value) for value in sole_z.values()):
                raise ValueError('Evaluated mesh has missing sole samples')
            penetration = max(0.0, floor - z_min)
            occluded = (floor_occlusion_until_frame is not None
                        and frame < floor_occlusion_until_frame)
            if not occluded and penetration > max_penetration:
                max_penetration, worst_floor = penetration, frame
            bounds.append({'frame': frame, 'lowest_vertex_z': z_min,
                           'sole_z': sole_z.copy()})
            for label, data in LIMBS.items():
                upper, lower, terminal = [rig.pose.bones[name] for name in data['chain']]
                target = rig.pose.bones['CTRL_' + label + '_Foot'].matrix.translation.copy()
                max_ik_gap[label] = max(max_ik_gap[label], (lower.tail - target).length)
                max_terminal_gap[label] = max(max_terminal_gap[label],
                                              (terminal.head - target).length)
                chain_length = (upper.tail - upper.head).length + (lower.tail - lower.head).length
                max_chain_length[label] = max(max_chain_length[label], chain_length)
                if chain_length > 0:
                    max_reach_ratio[label] = max(max_reach_ratio[label],
                                                (target - upper.head).length / chain_length)
                window = _contact_index(contact_windows.get(label, ()), frame)
                if window is None:
                    continue
                contact_count[label] += 1
                error = abs(sole_z[label] - floor - sole_clearance)
                if error > max_contact[label]:
                    max_contact[label], worst_contact[label] = error, frame
                centroid = sum(patches[label], Vector()) / len(patches[label])
                key = (label, window)
                if key not in anchors:
                    anchors[key] = (centroid.copy(), target.copy())
                first_centroid, first_target = anchors[key]
                skin_delta, target_delta = centroid - first_centroid, target - first_target
                max_skin_drift[label] = max(max_skin_drift[label],
                                           math.hypot(skin_delta.x, skin_delta.y))
                max_target_drift[label] = max(max_target_drift[label],
                                             math.hypot(target_delta.x, target_delta.y))
            if frame in endpoint_frames:
                endpoints[frame] = (seen, {bone.name: bone.matrix.copy()
                                          for bone in rig.pose.bones})
    finally:
        scene.frame_set(old_frame, subframe=old_subframe)
        bpy.context.view_layer.update()
    first_surface, first_bones = endpoints[endpoint_frames[0]]
    last_surface, last_bones = endpoints[endpoint_frames[1]]
    endpoint_surface = max((point - last_surface[index]).length
                           for index, point in first_surface.items())
    endpoint_bones = max(abs(matrix[row][column] - last_bones[name][row][column])
                         for name, matrix in first_bones.items()
                         for row in range(4) for column in range(4))
    action = rig.animation_data.action if rig.animation_data else None
    curves = _fcurves(action) if action else []
    attack_cycles = sum(mod.type == 'CYCLES' for curve in curves for mod in curve.modifiers)
    walk = bpy.data.actions.get(WALK_ACTION_NAME)
    warnings = []
    if any(value == 1 for value in edges.values()):
        warnings.append('The assembled segmented surface has boundary edges')
    if any(value > 2 for value in edges.values()) or any(winding.values()):
        warnings.append('The assembled surface has nonmanifold or inconsistent edges')
    if seam_error > height * seam_tolerance_fraction:
        warnings.append('A posed segment seam exceeds tolerance')
    if max_penetration > height * penetration_tolerance_fraction:
        warnings.append('Mesh floor penetration exceeds tolerance')
    for label in LIMBS:
        if max_contact[label] > height * contact_tolerance_fraction:
            warnings.append(label + ' supporting sole height error exceeds tolerance')
        if max_skin_drift[label] > height * drift_tolerance_fraction:
            warnings.append(label + ' supporting skin patch drift exceeds tolerance')
        if max_ik_gap[label] > height * ik_tolerance_fraction:
            warnings.append(label + ' IK endpoint misses its target')
        if max_reach_ratio[label] > 1.0001:
            warnings.append(label + ' target exceeds the available IK chain reach')
    if require_endpoint_match and (endpoint_surface > height * endpoint_tolerance_fraction
                                   or endpoint_bones > endpoint_tolerance_fraction):
        warnings.append('First and last attack poses do not match')
    if attack_cycles:
        warnings.append('The one-shot attack action has Cycles modifiers')
    if walk is None or not walk.use_fake_user:
        warnings.append('The existing walk action is missing or lacks its fake user')
    return {
        'passed': not warnings, 'warnings': warnings,
        'action': action.name if action else None,
        'sample_count': len(frames), 'frame_bounds': [min(frames), max(frames)],
        'endpoint_frames': list(endpoint_frames), 'height': height, 'floor': floor,
        'require_endpoint_match': require_endpoint_match,
        'floor_occlusion_until_frame': floor_occlusion_until_frame,
        'sole_clearance': sole_clearance, 'rig_object_scale': list(rig.scale),
        'assembled_source_vertices': len(source_set),
        'segment_vertex_counts': {mesh.name: len(ids) for mesh, ids in source_ids.items()},
        'assembled_boundary_edges': sum(value == 1 for value in edges.values()),
        'assembled_multiple_face_edges': sum(value > 2 for value in edges.values()),
        'assembled_inconsistent_winding_edges': sum(value != 0 for value in winding.values()),
        'maximum_posed_seam_gap_m': seam_error, 'worst_seam_frame': worst_seam,
        'endpoint_surface_max_distance': endpoint_surface,
        'endpoint_bone_max_matrix_error': endpoint_bones,
        'max_mesh_floor_penetration': max_penetration, 'worst_floor_frame': worst_floor,
        'contact_sample_counts': contact_count, 'max_supporting_sole_height_error': max_contact,
        'worst_supporting_contact_frame': worst_contact,
        'max_supporting_skinned_sole_horizontal_drift': max_skin_drift,
        'max_supporting_target_horizontal_drift': max_target_drift,
        'max_ik_lower_tail_target_gap': max_ik_gap,
        'max_terminal_head_target_gap': max_terminal_gap,
        'max_chain_length': max_chain_length, 'max_target_reach_ratio': max_reach_ratio,
        'attack_cycles_modifiers': attack_cycles,
        'walk_action': {'name': walk.name, 'fake_user': walk.use_fake_user,
                        'animation_channels': len(_fcurves(walk))} if walk else None,
        'pose_ground_bounds': bounds,
    }

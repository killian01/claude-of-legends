"""Read-only skin quality diagnostics for Voidmaul's right shoulder.

The v1 attack's IK pole drove bone_10 through nearly 180 degrees of axial
twist. Broad shoulder weights blend that bone with the torso, so linear blend
skinning collapsed the shoulder even though seams and ground contact passed.
This check measures both the weighted skin transformation and actual deformed
surface edge lengths, independently of the animation's authoring formulas.

Rotation budgets below are review thresholds calibrated to that observed
failure and its accepted neutral correction. They are not anatomical joint
limits, and a flagged angle alone does not establish an incorrect pose.
No NumPy or external dependencies are required beyond Blender/mathutils.
"""

import math

import bpy
from mathutils import Matrix, Vector


DEFAULT_BUDGETS = {
    'minimum_volume_ratio': .10,
    'median_volume_ratio': .55,
    'p05_volume_ratio': .35,
    'maximum_volume_below_half_fraction': .15,
    'p05_edge_length_ratio': .65,
    'maximum_edges_below_half_fraction': .10,
    'maximum_axial_twist_degrees': 100.0,
    'maximum_swing_degrees': 110.0,
}


def _stats(values):
    values = sorted(float(value) for value in values)
    if not values:
        raise ValueError('Cannot summarize an empty shoulder sample')
    if not all(math.isfinite(value) for value in values):
        raise ValueError('The shoulder deformation contains nonfinite values')

    def quantile(fraction):
        position = (len(values)-1)*fraction
        index = int(math.floor(position))
        weight = position-index
        return values[index]*(1-weight)+values[min(index+1, len(values)-1)]*weight

    return {'minimum': values[0], 'p05': quantile(.05), 'median': quantile(.5),
            'p95': quantile(.95), 'maximum': values[-1]}


def _rotation(bone):
    inherited = bone.bone.matrix_local.copy()
    if bone.parent:
        inherited = bone.parent.matrix @ bone.parent.bone.matrix_local.inverted() @ inherited
    delta = bone.matrix.to_quaternion() @ inherited.to_quaternion().inverted()
    delta.normalize()
    rest_axis = inherited.col[1].xyz.normalized()
    pose_axis = bone.matrix.col[1].xyz.normalized()
    projection = Vector((delta.x, delta.y, delta.z)).dot(rest_axis)
    return {
        'total_rotation_degrees': math.degrees(2*math.acos(min(1.0, abs(delta.w)))),
        'swing_degrees': math.degrees(math.acos(max(-1.0, min(1.0, rest_axis.dot(pose_axis))))),
        'axial_twist_degrees': math.degrees(2*math.atan2(abs(projection), abs(delta.w))),
    }


def _weight_subset(weights, top4):
    selected = sorted(weights.items(), key=lambda item: (-item[1], item[0]))[:4] if top4 else weights.items()
    selected = list(selected)
    total = sum(weight for _, weight in selected)
    if total <= 1e-8:
        raise ValueError('A sampled shoulder vertex has no usable deform weights')
    # The glTF skin normalizes its selected four weights. Native groups already
    # sum to one, but normalizing also handles harmless imported float error.
    return [(name, weight/total) for name, weight in selected]


def _volume_ratios(indices, groups, transformations):
    ratios = []
    for identifier in indices:
        linear = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
        for name, weight in groups[identifier]:
            linear += transformations[name].to_3x3()*weight
        ratios.append(linear.determinant())
    return ratios


def _evaluated_positions(rig, meshes, mesh_ids):
    inverse = rig.matrix_world.inverted()
    graph = bpy.context.evaluated_depsgraph_get()
    positions = {}
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        geometry = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=graph)
        try:
            ids = mesh_ids[obj]
            attribute = geometry.attributes.get('SourceVertex')
            if len(geometry.vertices) != len(ids) or attribute is None:
                raise ValueError('Evaluated source indexing changed: '+obj.name)
            if [datum.value for datum in attribute.data] != ids:
                raise ValueError('Evaluated SourceVertex order changed: '+obj.name)
            transform = inverse @ evaluated.matrix_world
            for vertex, identifier in zip(geometry.vertices, ids):
                positions[identifier] = transform @ vertex.co
        finally:
            evaluated.to_mesh_clear()
    return positions


def _record(frame, indices, edges, groups, transformations, positions, shoulder_bone):
    ratios = _volume_ratios(indices, groups, transformations)
    edge_ratios = [(positions[a]-positions[b]).length/rest_length
                   for a, b, rest_length in edges]
    return {
        'frame': frame,
        'volume_ratio': _stats(ratios),
        'vertices_volume_below_half': sum(value < .5 for value in ratios),
        'vertex_volume_below_half_fraction': sum(value < .5 for value in ratios)/len(ratios),
        'edge_length_ratio': _stats(edge_ratios),
        'edges_length_below_half': sum(value < .5 for value in edge_ratios),
        'edge_length_below_half_fraction': sum(value < .5 for value in edge_ratios)/len(edge_ratios),
        'rotation': _rotation(shoulder_bone),
    }


def _summarize(records):
    minimum_fields = ('minimum', 'p05', 'median')
    volume = {field: min(records, key=lambda row: row['volume_ratio'][field]) for field in minimum_fields}
    edge = {field: min(records, key=lambda row: row['edge_length_ratio'][field]) for field in minimum_fields}
    rotation = {field: max(records, key=lambda row: row['rotation'][field]) for field in
                ('total_rotation_degrees', 'swing_degrees', 'axial_twist_degrees')}
    worst_count = max(records, key=lambda row: row['vertices_volume_below_half'])
    worst_edges = max(records, key=lambda row: row['edges_length_below_half'])
    return {
        'worst_volume_ratio': {field: {'value': row['volume_ratio'][field], 'frame': row['frame']}
                               for field, row in volume.items()},
        'maximum_vertices_volume_below_half': {'count': worst_count['vertices_volume_below_half'],
            'fraction': worst_count['vertex_volume_below_half_fraction'], 'frame': worst_count['frame']},
        'worst_edge_length_ratio': {field: {'value': row['edge_length_ratio'][field], 'frame': row['frame']}
                                    for field, row in edge.items()},
        'maximum_edges_length_below_half': {'count': worst_edges['edges_length_below_half'],
            'fraction': worst_edges['edge_length_below_half_fraction'], 'frame': worst_edges['frame']},
        'maximum_rotation': {field: {'value': row['rotation'][field], 'frame': row['frame']}
                             for field, row in rotation.items()},
    }


def _warnings(summary, budgets, prefix):
    warnings = []
    checks = (
        (summary['worst_volume_ratio']['minimum']['value'] < budgets['minimum_volume_ratio'],
         'a shoulder skin transformation is below the minimum volume budget'),
        (summary['worst_volume_ratio']['median']['value'] < budgets['median_volume_ratio'],
         'median shoulder volume retention is below the review budget'),
        (summary['worst_volume_ratio']['p05']['value'] < budgets['p05_volume_ratio'],
         'the lower shoulder volume percentile is below the review budget'),
        (summary['maximum_vertices_volume_below_half']['fraction'] > budgets['maximum_volume_below_half_fraction'],
         'too many shoulder vertices lose over half local volume'),
        (summary['worst_edge_length_ratio']['p05']['value'] < budgets['p05_edge_length_ratio'],
         'actual shoulder surface compression exceeds the review budget'),
        (summary['maximum_edges_length_below_half']['fraction'] > budgets['maximum_edges_below_half_fraction'],
         'too many shoulder surface edges shrink below half their rest length'),
    )
    for failed, message in checks:
        if failed:
            warnings.append(prefix+message)
    return warnings


def validate_shoulder_deformation(rig, meshes, frames, bone_name='bone_10',
                                  radius=.16, region='ForeUpper.R', budgets=None,
                                  expected_source_vertices=11551,
                                  mirror_runtime_top4=False, include_frames=False):
    """Return compact worst-frame diagnostics without changing the action.

    ``frames`` accepts integer or fractional frame samples. SourceVertex IDs
    merge seam copies before measuring the patch. The patch is restricted to
    the anatomical upper-right segment and to ``radius`` from the native
    shoulder joint. ``mirror_runtime_top4`` additionally models the glTF
    exporter's four largest normalized weights using linear skinning.

    The weighted Jacobian holds each vertex's weights fixed; it is a volume
    collapse indicator, not a full spatial derivative. Actual evaluated edge
    compression is measured separately. A volume-preserving modifier can make
    the native indicator conservative; its status is included in the report.
    """
    if rig.type != 'ARMATURE' or bone_name not in rig.pose.bones:
        raise ValueError('Expected the native Voidmaul shoulder bone')
    if radius <= 0:
        raise ValueError('radius must be positive')
    meshes = [obj for obj in meshes if obj.type == 'MESH']
    frames = sorted(set(float(frame) for frame in frames))
    if not frames or not all(math.isfinite(frame) for frame in frames):
        raise ValueError('frames must contain finite samples')
    limits = dict(DEFAULT_BUDGETS)
    if budgets:
        limits.update(budgets)
    inverse = rig.matrix_world.inverted()
    mesh_ids, rest, weights, region_ids, assembled_edges = {}, {}, {}, set(), set()
    preserve_volume = []
    for obj in meshes:
        attribute = obj.data.attributes.get('SourceVertex')
        if attribute is None or attribute.domain != 'POINT':
            raise ValueError('Missing SourceVertex attribute: '+obj.name)
        ids = [datum.value for datum in attribute.data]
        if len(ids) != len(obj.data.vertices):
            raise ValueError('SourceVertex count differs from mesh vertices: '+obj.name)
        mesh_ids[obj] = ids
        group_names = {group.index: group.name for group in obj.vertex_groups}
        transform = inverse @ obj.matrix_world
        for vertex, identifier in zip(obj.data.vertices, ids):
            vertex_weights = {group_names[group.group]: group.weight for group in vertex.groups
                              if group.weight > 1e-7 and group_names[group.group] in rig.data.bones
                              and rig.data.bones[group_names[group.group]].use_deform}
            point = transform @ vertex.co
            if identifier in rest:
                if (rest[identifier]-point).length > 1e-6:
                    raise ValueError('A seam copy has a different rest position')
                previous = weights[identifier]
                if any(abs(previous.get(name, 0)-vertex_weights.get(name, 0)) > 1e-6
                       for name in previous.keys() | vertex_weights.keys()):
                    raise ValueError('A seam copy has different skin weights')
            rest[identifier], weights[identifier] = point, vertex_weights
        if obj.get('anatomy_region') == region:
            region_ids.update(ids)
        for edge in obj.data.edges:
            assembled_edges.add(tuple(sorted(ids[index] for index in edge.vertices)))
        preserve_volume.extend(obj.name for mod in obj.modifiers
                               if mod.type == 'ARMATURE' and mod.object == rig
                               and mod.use_deform_preserve_volume)
    if expected_source_vertices is not None and len(rest) != expected_source_vertices:
        raise ValueError('Assembled SourceVertex count changed: '+str(len(rest)))
    shoulder = rig.data.bones[bone_name].head_local
    patch = sorted(identifier for identifier in region_ids if (rest[identifier]-shoulder).length < radius)
    if not patch:
        raise ValueError('The proximal shoulder patch is empty')
    selected = set(patch)
    edges = [(a, b, (rest[a]-rest[b]).length) for a, b in assembled_edges
             if a in selected and b in selected and (rest[a]-rest[b]).length > 1e-7]
    if not edges:
        raise ValueError('No valid proximal shoulder surface edges')
    groups = {identifier: _weight_subset(weights[identifier], False) for identifier in patch}
    runtime_groups = {identifier: _weight_subset(weights[identifier], True) for identifier in patch}
    scene = bpy.context.scene
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    action = rig.animation_data.action if rig.animation_data else None
    records, runtime_records = [], []
    try:
        for frame in frames:
            integer = math.floor(frame)
            scene.frame_set(integer, subframe=frame-integer)
            bpy.context.view_layer.update()
            positions = _evaluated_positions(rig, meshes, mesh_ids)
            transformations = {bone.name: bone.matrix @ bone.bone.matrix_local.inverted()
                               for bone in rig.pose.bones if bone.bone.use_deform}
            records.append(_record(frame, patch, edges, groups, transformations,
                                   positions, rig.pose.bones[bone_name]))
            if mirror_runtime_top4:
                runtime_positions = {
                    identifier: sum((transformations[name] @ rest[identifier]*weight
                                     for name, weight in runtime_groups[identifier]), Vector())
                    for identifier in patch}
                runtime_records.append(_record(frame, patch, edges, runtime_groups, transformations,
                                               runtime_positions, rig.pose.bones[bone_name]))
    finally:
        scene.frame_set(old_frame, subframe=old_subframe)
        bpy.context.view_layer.update()
    summary = _summarize(records)
    warnings = _warnings(summary, limits, 'Native: ')
    angle_review = []
    if summary['maximum_rotation']['axial_twist_degrees']['value'] > limits['maximum_axial_twist_degrees']:
        angle_review.append('Shoulder axial twist exceeds the diagnostic budget; review its pole plane')
    if summary['maximum_rotation']['swing_degrees']['value'] > limits['maximum_swing_degrees']:
        angle_review.append('Shoulder swing exceeds the diagnostic budget; review the target trajectory')
    report = {
        'passed': not warnings, 'warnings': warnings, 'rotation_review': angle_review,
        'action': action.name if action else None, 'sample_count': len(frames),
        'frame_bounds': [min(frames), max(frames)], 'bone': bone_name,
        'source_vertex_count': len(rest), 'patch_radius_m': radius,
        'patch_region': region, 'patch_vertices': len(patch), 'patch_edges': len(edges),
        'shoulder_joint_rest': list(shoulder), 'budgets': limits,
        'budget_basis': 'correction_review/shoulder_correction_findings.json: v1 median '
                        'volume 0.0371/twist 179.5 degrees, accepted neutral median 0.8457/twist 38.7 degrees',
        'native': summary, 'native_preserve_volume_meshes': preserve_volume,
        'runtime_top4': None,
        'caveat': 'Angle budgets are review heuristics, not anatomical limits. Weighted volume '
                  'holds skin weights fixed; actual surface compression is measured independently.',
    }
    if runtime_records:
        runtime_summary = _summarize(runtime_records)
        report['runtime_top4'] = runtime_summary
        report['runtime_top4_weight_rule'] = 'largest four weights, ties by name, normalized; no quantization'
        report['warnings'].extend(_warnings(runtime_summary, limits, 'Runtime top4: '))
        report['passed'] = not report['warnings']
    if include_frames:
        report['frame_metrics'] = records
        if runtime_records:
            report['runtime_frame_metrics'] = runtime_records
    return report

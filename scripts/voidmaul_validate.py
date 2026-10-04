"""Structural and posed seam checks for the segmented Voidmaul asset."""
import bpy
import bmesh
import math
from collections import Counter


def validate_parts(parts, frames=(1, 5, 9, 13, 17, 21, 25, 29, 33), source_mesh=None):
    edges = Counter()
    winding = Counter()
    uv_bad = 0
    uv_zero = 0
    unweighted = 0
    sum_error = 0.0
    vertices = set()
    source_faces = {tuple(sorted(face.vertices)): face for face in source_mesh.data.polygons} if source_mesh else {}
    uv_preservation_error = 0.0
    rest_position_error = 0.0
    weight_preservation_error = 0.0
    verified_corners = 0
    for part in parts:
        mesh = part.data
        source = [d.value for d in mesh.attributes['SourceVertex'].data]
        for face in mesh.polygons:
            ids = [source[v] for v in face.vertices]
            vertices.update(ids)
            for a, b in zip(ids, ids[1:] + ids[:1]):
                edges[tuple(sorted((a, b)))] += 1
                winding[tuple(sorted((a, b)))] += 1 if a < b else -1
            if source_mesh:
                original = source_faces[tuple(sorted(ids))]
                source_uv = source_mesh.data.uv_layers['UVMap']
                original_uv = {source_mesh.data.loops[i].vertex_index: source_uv.data[i].uv
                               for i in original.loop_indices}
                for index in face.loop_indices:
                    identifier = source[mesh.loops[index].vertex_index]
                    uv_preservation_error = max(uv_preservation_error,
                        (mesh.uv_layers['UVMap'].data[index].uv - original_uv[identifier]).length)
                    verified_corners += 1
        mesh.calc_loop_triangles()
        uv = mesh.uv_layers['UVMap']
        for triangle in mesh.loop_triangles:
            a, b, c = [uv.data[index].uv for index in triangle.loops]
            area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
            uv_zero += abs(area) < 1e-12
            uv_bad += not all(math.isfinite(value) for p in (a, b, c) for value in p)
        for vertex in mesh.vertices:
            total = sum(g.weight for g in vertex.groups
                        if part.vertex_groups[g.group].name in part.parent.data.bones
                        and part.parent.data.bones[part.vertex_groups[g.group].name].use_deform)
            unweighted += total < 1e-6
            sum_error = max(sum_error, abs(total - 1.0))
            if source_mesh:
                original = source_mesh.data.vertices[source[vertex.index]]
                rest_position_error = max(rest_position_error, (vertex.co - original.co).length)
                original_weights = {g.group: g.weight for g in original.groups}
                part_weights = {g.group: g.weight for g in vertex.groups}
                for group in original_weights.keys() | part_weights.keys():
                    weight_preservation_error = max(weight_preservation_error,
                        abs(original_weights.get(group, 0.0) - part_weights.get(group, 0.0)))
    scene = bpy.context.scene
    saved_frame = scene.frame_current
    seam_error = 0.0
    pose_bounds = []
    coordinates = {}
    for frame in frames:
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        seen = {}
        z_min = math.inf
        for part in parts:
            source = [d.value for d in part.data.attributes['SourceVertex'].data]
            evaluated = part.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            if len(mesh.vertices) != len(source):
                evaluated.to_mesh_clear()
                raise ValueError('A modifier changed the segment vertex count: ' + part.name)
            attribute = mesh.attributes.get('SourceVertex')
            if attribute and [d.value for d in attribute.data] != source:
                evaluated.to_mesh_clear()
                raise ValueError('A modifier reordered the segment vertices: ' + part.name)
            for vertex, source_id in zip(mesh.vertices, source):
                co = evaluated.matrix_world @ vertex.co
                z_min = min(z_min, co.z)
                if source_id in seen:
                    seam_error = max(seam_error, (co - seen[source_id]).length)
                seen[source_id] = co.copy()
            evaluated.to_mesh_clear()
        pose_bounds.append({'frame': frame, 'lowest_vertex_z': z_min})
        coordinates[frame] = seen
    seam_loop = max((co - coordinates[33][index]).length
                    for index, co in coordinates[1].items()) if 1 in coordinates and 33 in coordinates else None
    scene.frame_set(saved_frame)
    return {
        'parts': len(parts), 'assembled_vertices': len(vertices),
        'assembled_faces': sum(len(part.data.polygons) for part in parts),
        'assembled_boundary_edges': sum(n == 1 for n in edges.values()),
        'assembled_multiple_face_edges': sum(n > 2 for n in edges.values()),
        'assembled_inconsistent_winding_edges': sum(n != 0 for n in winding.values()),
        'uv_nonfinite_triangles': uv_bad, 'uv_zero_area_triangles': uv_zero,
        'verified_source_uv_corners': verified_corners,
        'maximum_uv_preservation_error': uv_preservation_error if source_mesh else None,
        'maximum_rest_position_preservation_error': rest_position_error if source_mesh else None,
        'maximum_weight_preservation_error': weight_preservation_error if source_mesh else None,
        'unweighted_vertices': unweighted, 'maximum_weight_sum_error': sum_error,
        'maximum_posed_seam_gap_m': seam_error,
        'loop_surface_error_m': seam_loop, 'pose_ground_bounds': pose_bounds,
    }


def export_uv_svg(parts, path):
    colors = ['#637789', '#b990e4', '#e9686f', '#e99b53', '#f3cc6a',
              '#cf4564', '#db7844', '#dac044', '#51a9d6', '#65c5bd', '#99d873',
              '#6580cb', '#56aaa8', '#80bd68']
    with open(path, 'w', encoding='utf8') as out:
        out.write('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1060" viewBox="0 0 1000 1060">')
        out.write('<rect width="1000" height="1060" fill="#171c27"/>')
        out.write('<text x="20" y="29" fill="white" font-family="sans-serif" font-size="20">Voidmaul | preserved 4K atlas and anatomy regions</text>')
        for part, color in zip(parts, colors):
            uv = part.data.uv_layers['UVMap']
            out.write('<g fill="' + color + '" fill-opacity=".18" stroke="' + color + '" stroke-width=".35">')
            for face in part.data.polygons:
                points = ' '.join(f'{20+uv.data[i].uv.x*960:.2f},{1030-uv.data[i].uv.y*960:.2f}' for i in face.loop_indices)
                out.write('<polygon points="' + points + '"/>')
            out.write('</g>')
        out.write('</svg>')

"""Independent, read-only topology validation of the segmented Codex skin.

The head belongs to the continuous skin; the articulated jaw is only a mouth
boundary reference. Inspect rest mesh coordinates rather than evaluated poses.
This does not import or reproduce the skin repair implementation.
"""

from collections import defaultdict
import math

from mathutils.kdtree import KDTree


REST_WELD_TOLERANCE_M = 2e-6
MOUTH_REFERENCE_TOLERANCE_M = 50e-6
MINIMUM_FACE_AREA_M2 = 1e-16
MAXIMUM_REPORTED_EXAMPLES = 20


def _world_vertices(mesh):
    return [tuple(mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices]


def _weld_vertices(points):
    """Merge coincident rest points; keep the original geometry untouched."""
    cells = defaultdict(list)
    canonical, indices = [], []
    tolerance = REST_WELD_TOLERANCE_M
    for point in points:
        cell = tuple(math.floor(value / tolerance) for value in point)
        found = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for index in cells.get((cell[0]+dx, cell[1]+dy, cell[2]+dz), ()):
                        if math.dist(point, canonical[index]) <= tolerance:
                            found = index
                            break
                    if found is not None:
                        break
                if found is not None:
                    break
            if found is not None:
                break
        if found is None:
            found = len(canonical)
            canonical.append(point)
            cells[cell].append(found)
        indices.append(found)
    return canonical, indices


def _polygon_area(points):
    if len(points) < 3:
        return 0.0
    origin = points[0]
    area = 0.0
    for first, second in zip(points[1:-1], points[2:]):
        a = [first[i]-origin[i] for i in range(3)]
        b = [second[i]-origin[i] for i in range(3)]
        cross = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
        area += math.sqrt(sum(value*value for value in cross)) / 2
    return area


def validate_surface_topology(meshes):
    """Return a JSON-ready report; only mouth boundaries may remain open.

    Both endpoints of an allowed boundary edge must be within 50 micrometres
    of a rest Jaw vertex. This tolerance accounts for quantized copies at the
    lip cut, and does not apply to other skin boundaries. Shared edges must
    have at most two faces with opposite winding. No mesh or pose is changed.
    """
    meshes = sorted((mesh for mesh in meshes if mesh.type == 'MESH'
                     and mesh.name.startswith('Pyrefang_')
                     and not mesh.name.startswith('Pyrefang_FX_')), key=lambda mesh: mesh.name)
    jaws = [mesh for mesh in meshes if mesh.name.startswith('Pyrefang_Jaw')]
    skin = [mesh for mesh in meshes if not mesh.name.startswith('Pyrefang_Jaw')]
    jaw_points = [point for mesh in jaws for point in _world_vertices(mesh)]

    points, polygons = [], []
    for mesh in skin:
        offset = len(points)
        points.extend(_world_vertices(mesh))
        polygons.extend((mesh.name, polygon.index, [offset+index for index in polygon.vertices])
                        for polygon in mesh.data.polygons)
    finite = all(math.isfinite(value) for point in points+jaw_points for value in point)
    report = {
        'method': 'Rest surface combined analytically at 2um; Head included, Jaw excluded. Only edges whose two endpoints match the rest Jaw within 50um are allowed mouth boundaries.',
        'tolerances': {'rest_weld_m': REST_WELD_TOLERANCE_M,
                       'mouth_reference_m': MOUTH_REFERENCE_TOLERANCE_M,
                       'minimum_face_area_m2': MINIMUM_FACE_AREA_M2},
        'skin_meshes': [mesh.name for mesh in skin],
        'jaw_reference_meshes': [mesh.name for mesh in jaws],
        'jaw_reference_vertex_count': len(jaw_points),
        'rest_coordinates_finite': finite,
        'vertex_count_before_weld': len(points),
        'polygon_count': len(polygons),
        'passed': False,
    }
    if not finite or not points or not polygons:
        report['error'] = 'Missing skin polygons or non-finite rest coordinates'
        return report

    jaw_tree = KDTree(len(jaw_points)) if jaw_points else None
    if jaw_tree is not None:
        for index, point in enumerate(jaw_points):
            jaw_tree.insert(point, index)
        jaw_tree.balance()

    canonical, indices = _weld_vertices(points)
    edges = defaultdict(list)
    degenerate = []
    for mesh_name, polygon_index, original in polygons:
        face = [indices[index] for index in original]
        area = _polygon_area([canonical[index] for index in face])
        if len(set(face)) < 3 or len(set(face)) != len(face) or area <= MINIMUM_FACE_AREA_M2:
            degenerate.append({'mesh': mesh_name, 'polygon_index': polygon_index,
                               'welded_vertex_indices': face, 'area_m2': area})
        for a, b in zip(face, face[1:]+face[:1]):
            if a == b:
                continue
            edge = tuple(sorted((a, b)))
            edges[edge].append((mesh_name, polygon_index, 1 if a < b else -1))

    def describe_edge(edge, faces):
        distances = [float(jaw_tree.find(canonical[index])[2]) if jaw_tree is not None else None
                     for index in edge]
        return {'endpoints_xyz_m': [list(canonical[index]) for index in edge],
                'endpoint_distance_to_jaw_m': distances,
                'faces': [{'mesh': name, 'polygon_index': index, 'direction': direction}
                          for name, index, direction in faces]}

    unexpected, non_manifold, bad_winding = [], [], []
    boundary_count = 0
    mouth_boundary_count = 0
    for edge, faces in edges.items():
        if len(faces) == 1:
            boundary_count += 1
            detail = describe_edge(edge, faces)
            if all(distance is not None and distance <= MOUTH_REFERENCE_TOLERANCE_M
                   for distance in detail['endpoint_distance_to_jaw_m']):
                mouth_boundary_count += 1
            else:
                unexpected.append(detail)
        elif len(faces) > 2:
            non_manifold.append(describe_edge(edge, faces))
        elif faces[0][2] == faces[1][2]:
            bad_winding.append(describe_edge(edge, faces))
    unexpected.sort(key=lambda item: max((distance if distance is not None else 1e9)
                                         for distance in item['endpoint_distance_to_jaw_m']), reverse=True)
    report.update({
        'vertex_count_after_weld': len(canonical), 'edge_count': len(edges),
        'boundary_edge_count': boundary_count,
        'allowed_mouth_boundary_edge_count': mouth_boundary_count,
        'unexpected_boundary_edge_count': len(unexpected),
        'non_manifold_edge_count': len(non_manifold),
        'inconsistent_winding_edge_count': len(bad_winding),
        'degenerate_face_count': len(degenerate),
        'worst_unexpected_boundary_edges': unexpected[:MAXIMUM_REPORTED_EXAMPLES],
        'non_manifold_examples': non_manifold[:MAXIMUM_REPORTED_EXAMPLES],
        'inconsistent_winding_examples': bad_winding[:MAXIMUM_REPORTED_EXAMPLES],
        'degenerate_face_examples': degenerate[:MAXIMUM_REPORTED_EXAMPLES],
        'passed': not (unexpected or non_manifold or bad_winding or degenerate),
    })
    return report

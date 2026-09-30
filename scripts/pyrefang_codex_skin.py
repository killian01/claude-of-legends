"""Keep the independently animated segmented Pyrefang skin continuous.

The source was cut into material/limb objects after skinning, but cut copies of
the same surface vertex have different bone weights. They nearly coincide at
rest and separate in motion. This module treats those copies as a single skin
vertex while retaining separate objects and per-corner UVs.
Quantized copies are snapped to a common position before their weights are
shared. UV loops, materials, polygons and the separate objects are retained.
"""

from collections import defaultdict
import heapq

import numpy as np
from mathutils.kdtree import KDTree
from mathutils import Vector


SEAM_TOLERANCE = 5e-5


def _surface(rig, body_objects, tolerance=SEAM_TOLERANCE):
    # The jaw intentionally separates from the head. Include the head/neck
    # collar, but never share seam weights across the separate jaw mesh.
    objects = [ob for ob in body_objects if ob.type == 'MESH'
               and not ob.name.split('.')[0].endswith('_Jaw')]
    names = [bone.name for bone in rig.data.bones if bone.use_deform]
    bone_index = {name: i for i, name in enumerate(names)}
    vertices = [(ob, vertex) for ob in objects for vertex in ob.data.vertices]
    positions = np.array([tuple(ob.matrix_world @ vertex.co) for ob, vertex in vertices])
    tree = KDTree(len(vertices))
    for index, point in enumerate(positions):
        tree.insert(point, index)
    tree.balance()
    roots = list(range(len(vertices)))

    def root(index):
        while roots[index] != index:
            roots[index] = roots[roots[index]]
            index = roots[index]
        return index

    for index, point in enumerate(positions):
        for _, other, _ in tree.find_range(point, tolerance):
            if other > index:
                a, b = root(index), root(other)
                roots[max(a, b)] = min(a, b)
    clusters = defaultdict(list)
    for index in range(len(vertices)):
        clusters[root(index)].append(index)
    clusters = list(clusters.values())
    node_of = np.empty(len(vertices), dtype=np.int32)
    weights = np.zeros((len(clusters), len(names)), dtype=np.float64)
    positions_merged = np.empty((len(clusters), 3), dtype=np.float64)
    inconsistent = set()
    for node, members in enumerate(clusters):
        node_of[members] = node
        positions_merged[node] = positions[members].mean(axis=0)
        per_object = defaultdict(list)
        member_weights = []
        for index in members:
            ob, vertex = vertices[index]
            row = np.zeros(len(names), dtype=np.float64)
            for group in vertex.groups:
                bone = bone_index.get(ob.vertex_groups[group.group].name)
                if bone is not None:
                    row[bone] = group.weight
            if row.sum() > 1e-12:
                row /= row.sum()
            member_weights.append(row)
            per_object[ob.name].append(row)
        # UV splits must not give one mesh more votes than its neighbour.
        weights[node] = np.mean([np.mean(rows, axis=0) for rows in per_object.values()], axis=0)
        if any(np.max(np.abs(row - weights[node])) > 1e-5 for row in member_weights):
            inconsistent.add(node)
    lookup = {(ob.name, vertex.index): int(node_of[i]) for i, (ob, vertex) in enumerate(vertices)}
    adjacency = [set() for _ in clusters]
    for ob in objects:
        for edge in ob.data.edges:
            a, b = (lookup[(ob.name, index)] for index in edge.vertices)
            if a != b:
                adjacency[a].add(b)
                adjacency[b].add(a)
    return objects, names, vertices, clusters, weights, positions_merged, adjacency, inconsistent


def repair_body(rig, body_objects):
    """Repair cut skin weights in place and return JSON-serializable evidence.

    Call after appending and resetting the rest rig, before authoring the Codex
    actions. The source contains seam copies quantized up to about 31 microns
    apart; matching only exact positions misses their different bone weights.
    Canonical positions and shared weights close those seams under deformation.
    Existing polygons, UVs, materials and the source file remain untouched.
    """
    objects, names, vertices, clusters, weights, positions, adjacency, bad = _surface(rig, body_objects)
    inverse_world = {ob.name: ob.matrix_world.inverted() for ob in objects}
    snapped_vertices = 0
    maximum_snap = 0.0
    for node, members in enumerate(clusters):
        if len(members) < 2:
            continue
        common = Vector(positions[node])
        for index in members:
            ob, vertex = vertices[index]
            distance = (ob.matrix_world @ vertex.co - common).length
            if distance > SEAM_TOLERANCE:
                raise ValueError('Ambiguous seam cluster exceeds the position tolerance')
            maximum_snap = max(maximum_snap, distance)
            snapped_vertices += distance > 1e-9
            vertex.co = inverse_world[ob.name] @ common
    before = weights.copy()
    width = .018
    distance = np.full(len(clusters), np.inf)
    queue = []
    for node in bad:
        distance[node] = 0
        heapq.heappush(queue, (0., node))
    while queue:
        walked, node = heapq.heappop(queue)
        if walked > distance[node]:
            continue
        for other in adjacency[node]:
            candidate = walked + float(np.linalg.norm(positions[node] - positions[other]))
            if candidate < min(width, distance[other]):
                distance[other] = candidate
                heapq.heappush(queue, (candidate, other))
    band = np.flatnonzero(distance < width)
    # Three gentle diffusion passes remove an abrupt crease at each repaired
    # cut, using only surface-connected neighbours; nearby opposite skin is
    # never averaged in merely because it is spatially close.
    for _ in range(3):
        result = weights.copy()
        for node in band:
            neighbours = list(adjacency[node])
            if not neighbours:
                continue
            falloff = 1 - distance[node] / width
            strength = .42 * falloff * falloff
            result[node] = (1 - strength) * weights[node] + strength * weights[neighbours].mean(axis=0)
        weights = result
    weights[weights < 1e-8] = 0
    totals = weights.sum(axis=1)
    valid = totals > 1e-12
    weights[valid] /= totals[valid, None]
    changed_nodes = set(bad) | set(np.flatnonzero(np.max(np.abs(before - weights), axis=1) > 1e-7))
    changed_vertices = 0
    by_object = defaultdict(int)
    for node in sorted(changed_nodes):
        active = [(names[i], float(value)) for i, value in enumerate(weights[node]) if value > 0]
        for index in clusters[node]:
            ob, vertex = vertices[index]
            old_names = [ob.vertex_groups[group.group].name for group in vertex.groups]
            for name in old_names:
                if name in names:
                    ob.vertex_groups[name].remove([vertex.index])
            for name, value in active:
                group = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
                group.add([vertex.index], value, 'REPLACE')
            changed_vertices += 1
            by_object[ob.name] += 1
    report = {
        'method': 'Canonical seam copies within 50 microns, shared weights and 18 mm surface-local smoothing',
        'seam_match_tolerance_m': SEAM_TOLERANCE,
        'snapped_vertices': int(snapped_vertices),
        'maximum_vertex_snap_m': maximum_snap,
        'shared_surface_points': sum(len({vertices[i][0].name for i in members}) > 1 for members in clusters),
        'inconsistent_surface_points_repaired': len(bad),
        'changed_vertices': changed_vertices,
        'changed_vertices_by_mesh': dict(by_object),
        'polygons_uvs_and_materials_preserved': True,
        'intentional_mouth_opening_preserved': True,
    }
    for ob in objects:
        ob.data.update()
    rig['codex_skin_repair'] = 'Canonical seam positions and weights; preserved polygons, UVs and materials'
    return report

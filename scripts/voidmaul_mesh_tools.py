"""Conservative Tripo surface repair helpers, called from Blender.

Run only on a working mesh copy. Existing polygon UV coordinates remain
unchanged: UV seams are per-corner data and survive a geometry-only weld.
New hole caps borrow nearby atlas coordinates; no atlas unwrap is performed.
This module does not open files, save scenes, or change the active object.
"""

from collections import Counter, defaultdict

import bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon


def _edge_direction(face, edge):
    for loop in face.loops:
        if loop.edge == edge:
            return 1 if loop.vert == edge.verts[0] else -1
    return 0


def _boundary_components(bm):
    remaining = {edge for edge in bm.edges if edge.is_boundary}
    components = []
    while remaining:
        seed = remaining.pop()
        edges, vertices, stack = {seed}, set(seed.verts), list(seed.verts)
        while stack:
            vert = stack.pop()
            for edge in vert.link_edges:
                if edge in remaining:
                    remaining.remove(edge)
                    edges.add(edge)
                    for other in edge.verts:
                        if other not in vertices:
                            vertices.add(other)
                            stack.append(other)
        degree = Counter(vert for edge in edges for vert in edge.verts)
        coords = [vert.co for vert in vertices]
        lo = [min(co[i] for co in coords) for i in range(3)]
        hi = [max(co[i] for co in coords) for i in range(3)]
        components.append({
            "edges": edges,
            "vertices": vertices,
            "closed": all(value == 2 for value in degree.values()),
            "degree": dict(Counter(degree.values())),
            "center": [sum(co[i] for co in coords) / len(coords) for i in range(3)],
            "span": [hi[i] - lo[i] for i in range(3)],
        })
    return sorted(components, key=lambda component: len(component["edges"]), reverse=True)


def _summary(bm):
    return {
        "vertices": len(bm.verts),
        "edges": len(bm.edges),
        "faces": len(bm.faces),
        "boundary_edges": sum(edge.is_boundary for edge in bm.edges),
        "multiple_face_edges": sum(len(edge.link_faces) > 2 for edge in bm.edges),
        "wire_edges": sum(edge.is_wire for edge in bm.edges),
        "nonmanifold_vertices": sum(not vert.is_manifold for vert in bm.verts),
        "degenerate_faces": sum(face.calc_area() < 1e-14 for face in bm.faces),
        "boundary_components": [
            {"edges": len(component["edges"]), "vertices": len(component["vertices"]),
             "closed": component["closed"], "degree": component["degree"],
             "center": component["center"], "span": component["span"]}
            for component in _boundary_components(bm)
        ],
    }


def diagnose_mesh(mesh):
    """Return topology and three-face edge detail without touching mesh data."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.index_update()
    bm.normal_update()
    report = _summary(bm)
    report["multiple_face_detail"] = []
    for edge in bm.edges:
        if len(edge.link_faces) > 2:
            report["multiple_face_detail"].append({
                "endpoints": [list(vert.co) for vert in edge.verts],
                "faces": [{"index": face.index, "area": face.calc_area(),
                           "boundary_edges": sum(item.is_boundary for item in face.edges),
                           "normal": list(face.normal), "direction": _edge_direction(face, edge)}
                          for face in edge.link_faces],
            })
    bm.free()
    return report


def _weld_average_weights(bm, distance):
    deform = bm.verts.layers.deform.active
    targetmap = bmesh.ops.find_doubles(bm, verts=list(bm.verts), dist=distance)["targetmap"]
    roots = {}

    def root(vert):
        while vert in targetmap:
            vert = targetmap[vert]
        return vert

    for vert in bm.verts:
        roots[vert] = root(vert)
    clusters = defaultdict(list)
    for vert, target in roots.items():
        clusters[target].append(vert)
    changed_weights = 0
    if deform is not None:
        for members in clusters.values():
            if len(members) < 2:
                continue
            weights = defaultdict(float)
            for vert in members:
                for group, weight in vert[deform].items():
                    weights[group] += weight / len(members)
            total = sum(weights.values())
            if total > 0:
                weights = {group: weight / total for group, weight in weights.items() if weight > 1e-10}
            for vert in members:
                old = dict(vert[deform])
                if any(abs(old.get(group, 0.0) - weight) > 1e-6 for group, weight in weights.items()):
                    changed_weights += 1
                for group in list(vert[deform].keys()):
                    del vert[deform][group]
                for group, weight in weights.items():
                    vert[deform][group] = weight
    bmesh.ops.weld_verts(bm, targetmap=targetmap)
    return {"merged_vertices": len(targetmap), "averaged_weight_vertices": changed_weights,
            "coincident_clusters": sum(len(members) > 1 for members in clusters.values())}


def _remove_leaf_faces(bm, original_id):
    """Remove boundary-attached surplus faces only; never guess internal sheets.

    At each three-face edge retain an oppositely wound pair. Prefer a removed
    face with two loose sides, then one loose side, and prefer smooth retained
    normals. All choices are recorded so a caller can inspect exact changes.
    """
    removed = []
    for iteration in range(100):
        bm.normal_update()
        choices = []
        for edge in bm.edges:
            faces = list(edge.link_faces)
            if len(faces) != 3:
                continue
            for face in faces:
                boundary = sum(item.is_boundary for item in face.edges)
                if not boundary:
                    continue
                keep = [other for other in faces if other != face]
                if _edge_direction(keep[0], edge) == _edge_direction(keep[1], edge):
                    continue
                agreement = keep[0].normal.dot(keep[1].normal)
                score = 100 * boundary + agreement
                choices.append((score, -face.calc_area(), face, edge, boundary, agreement))
        if not choices:
            break
        choice = max(choices, key=lambda item: (item[0], item[1]))
        _, _, face, edge, boundary, agreement = choice
        removed.append({"source_face": face[original_id] - 1,
                        "area": face.calc_area(), "boundary_sides": boundary,
                        "kept_normal_dot": agreement,
                        "vertices": [list(vert.co) for vert in face.verts]})
        bmesh.ops.delete(bm, geom=[face], context="FACES_ONLY")
    wire = [edge for edge in bm.edges if not edge.link_faces]
    if wire:
        bmesh.ops.delete(bm, geom=wire, context="EDGES")
    loose = [vert for vert in bm.verts if not vert.link_edges]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    return removed


def _copy_cap_uv(face, references, uv_layers):
    center = face.calc_center_median()
    # Keep a whole cap face inside one nearby existing atlas triangle/chart.
    anchor = min(references, key=lambda ref: (ref.calc_center_median() - center).length_squared)
    for uv_layer in uv_layers:
        uv_center = sum((loop[uv_layer].uv for loop in anchor.loops), Vector((0.0, 0.0))) / len(anchor.loops)
        for loop in face.loops:
            adjacent = [other[uv_layer].uv.copy() for other in loop.vert.link_loops
                        if other.face in references]
            if adjacent:
                loop[uv_layer].uv = min(adjacent, key=lambda uv: (uv - uv_center).length_squared)
            else:
                loop[uv_layer].uv = uv_center
    material = Counter(ref.material_index for ref in references)
    face.material_index = material.most_common(1)[0][0]
    face.smooth = anchor.smooth


def _ordered_boundary_vertices(edges):
    """Walk one simple boundary loop in reverse of its adjacent face."""
    seed = next(iter(edges))
    start = seed.verts[1] if _edge_direction(seed.link_faces[0], seed) == 1 else seed.verts[0]
    vertices, used, current, edge = [start], set(), start, seed
    while True:
        used.add(edge)
        current = edge.other_vert(current)
        if current == start:
            break
        vertices.append(current)
        candidates = [item for item in current.link_edges if item in edges and item not in used]
        if len(candidates) != 1:
            raise ValueError("Boundary walk is not a simple loop")
        edge = candidates[0]
    if len(used) != len(edges):
        raise ValueError("Boundary walk left unused edges")
    return vertices


def _interpolate_weights(vert, source, coefficients, deform):
    if deform is None:
        return
    weights = defaultdict(float)
    for origin, factor in zip(source, coefficients):
        for group, weight in origin[deform].items():
            weights[group] += factor * weight
    total = sum(weights.values())
    for group, weight in weights.items():
        vert[deform][group] = weight / total if total else 0.0


def _fill_isolated_cap(bm, component, uv_layers, original_id):
    """Cap concave loops without reusing occupied interior mesh diagonals.

    Tessellation defines the shape. Interior diagonals receive fresh split
    vertices, and each tessellated triangle receives a fresh interior vertex.
    Their interpolated positions remain on the same patch surface. Irrational
    fractions keep new points away from the source's quantized vertex lattice.
    """
    vertices = _ordered_boundary_vertices(component["edges"])
    references = {face for edge in component["edges"] for face in edge.link_faces}
    boundary_pairs = {frozenset(edge.verts) for edge in component["edges"]}
    triangles = tessellate_polygon([[vert.co.copy() for vert in vertices]])
    if len(triangles) != len(vertices) - 2:
        raise ValueError("Boundary tessellation did not produce n-2 triangles")
    splits, new_faces = {}, []
    deform = bm.verts.layers.deform.active
    materials = Counter(face.material_index for face in references)
    for points in triangles:
        if all(isinstance(point, int) for point in points):
            # Blender 5.2 returns flattened input indices rather than Vectors.
            corners = [vertices[index] for index in points]
        else:
            corners = [min(vertices, key=lambda vert: (vert.co - point).length_squared) for point in points]
            if any((vert.co - point).length > 1e-7 for vert, point in zip(corners, points)):
                raise ValueError("Tessellation introduced unexpected corner coordinates")
        centroid = sum((vert.co for vert in corners), Vector((0, 0, 0))) / 3.0
        anchor = min(references, key=lambda face: (face.calc_center_median() - centroid).length_squared)
        corner_uv = []
        for vert in corners:
            values = []
            for layer in uv_layers:
                anchor_uv = sum((loop[layer].uv for loop in anchor.loops), Vector((0, 0))) / len(anchor.loops)
                candidates = [loop[layer].uv.copy() for loop in vert.link_loops if loop.face in references]
                values.append(min(candidates, key=lambda uv: (uv - anchor_uv).length_squared))
            corner_uv.append(values)
        factors = (0.2718281828459045, 0.3141592653589793, 0.4140125517951162)
        center = bm.verts.new(sum((vert.co * factor for vert, factor in zip(corners, factors)), Vector((0, 0, 0))))
        _interpolate_weights(center, corners, factors, deform)
        center_uv = [sum((corner_uv[i][layer_index] * factors[i] for i in range(3)), Vector((0, 0)))
                     for layer_index in range(len(uv_layers))]
        ring = []
        for index, vert in enumerate(corners):
            following = (index + 1) % 3
            other = corners[following]
            ring.append((vert, corner_uv[index]))
            pair = frozenset((vert, other))
            if pair not in boundary_pairs:
                if pair not in splits:
                    endpoints = sorted(pair, key=lambda item: tuple(item.co))
                    fraction = 0.3819660112501051
                    middle = bm.verts.new(endpoints[0].co * (1 - fraction) + endpoints[1].co * fraction)
                    _interpolate_weights(middle, endpoints, (1 - fraction, fraction), deform)
                    splits[pair] = (middle, endpoints[0], fraction)
                middle, first, fraction = splits[pair]
                # The two cap triangles may traverse this diagonal oppositely.
                following_factor = fraction if vert == first else 1 - fraction
                middle_uv = [corner_uv[index][layer_index] * (1 - following_factor)
                             + corner_uv[following][layer_index] * following_factor
                             for layer_index in range(len(uv_layers))]
                ring.append((middle, middle_uv))
        for index, (vert, values) in enumerate(ring):
            other, other_values = ring[(index + 1) % len(ring)]
            face = bm.faces.new((center, vert, other))
            face[original_id] = 0
            face.material_index = materials.most_common(1)[0][0]
            face.smooth = anchor.smooth
            for loop, loop_values in zip(face.loops, (center_uv, values, other_values)):
                for layer, value in zip(uv_layers, loop_values):
                    loop[layer].uv = value
            new_faces.append(face)
    return {"boundary_edges": len(component["edges"]), "tessellation_triangles": len(triangles),
            "new_triangles": len(new_faces), "new_diagonal_split_vertices": len(splits),
            "new_interior_vertices": len(triangles), "center": component["center"], "span": component["span"]}


def _separate_closed_vertex_fans(bm, uv_layers, original_id):
    """Separate closed shells touching only at a vertex, preserving position.

    Copies have identical skin weights, so the contact remains exact in poses.
    This is a topological separation, not a positional weld or surface offset.
    """
    report = []
    deform = bm.verts.layers.deform.active
    for vert in list(bm.verts):
        if vert.is_manifold or not vert.link_faces:
            continue
        if any(len(edge.link_faces) != 2 for edge in vert.link_edges):
            raise ValueError("Fan separation requires already closed two-face edges")
        remaining = set(vert.link_faces)
        fans = []
        while remaining:
            seed = remaining.pop()
            fan, stack = {seed}, [seed]
            while stack:
                face = stack.pop()
                for edge in face.edges:
                    if vert not in edge.verts:
                        continue
                    for other in edge.link_faces:
                        if other in remaining:
                            remaining.remove(other)
                            fan.add(other)
                            stack.append(other)
            fans.append(fan)
        if len(fans) <= 1:
            raise ValueError("Nonmanifold vertex has a single unresolved face fan")
        fans.sort(key=len, reverse=True)
        report.append({"coordinate": list(vert.co), "face_fan_sizes": [len(fan) for fan in fans],
                       "new_coincident_vertices": len(fans) - 1})
        for fan in fans[1:]:
            duplicate = bm.verts.new(vert.co.copy())
            if deform is not None:
                for group, weight in vert[deform].items():
                    duplicate[deform][group] = weight
            for face in list(fan):
                corners = list(face.verts)
                uvs = [[loop[layer].uv.copy() for layer in uv_layers] for loop in face.loops]
                corners = [duplicate if corner == vert else corner for corner in corners]
                rebuilt = bm.faces.new(corners)
                rebuilt.material_index = face.material_index
                rebuilt.smooth = face.smooth
                rebuilt[original_id] = face[original_id]
                for loop, values in zip(rebuilt.loops, uvs):
                    for layer, value in zip(uv_layers, values):
                        loop[layer].uv = value
                bmesh.ops.delete(bm, geom=[face], context="FACES_ONLY")
        wire = [edge for edge in vert.link_edges if not edge.link_faces]
        if wire:
            bmesh.ops.delete(bm, geom=wire, context="EDGES")
    return report


def repair_mesh_data(mesh, weld_distance=1e-6, max_hole_span=0.30, max_hole_edges=256):
    """Repair one working Mesh datablock and return a JSON-ready audit.

    Open/branching boundary chains and internal nonmanifold sheets are reported
    and retained for manual review. A report with passed=False needs follow-up.
    Welding does not snap near points to their average: each surviving position
    is an original coordinate, and all copies inherit averaged skin weights.
    """
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.index_update()
        original_id = bm.faces.layers.int.new("voidmaul_source_face")
        uv_layers = list(bm.loops.layers.uv.values())
        source_uv = {}
        for face in bm.faces:
            face[original_id] = face.index + 1
            source_uv[face.index + 1] = [[tuple(loop[layer].uv) for loop in face.loops] for layer in uv_layers]
        report = {"before": _summary(bm), "weld_distance": weld_distance}
        report["weld"] = _weld_average_weights(bm, weld_distance)
        report["after_weld"] = _summary(bm)
        report["removed_leaf_faces"] = _remove_leaf_faces(bm, original_id)
        report["after_leaf_repair"] = _summary(bm)
        report["filled_holes"] = []
        for component in _boundary_components(bm):
            if not component["closed"] or len(component["edges"]) > max_hole_edges:
                continue
            if max(component["span"]) > max_hole_span:
                continue
            references = {face for edge in component["edges"] for face in edge.link_faces}
            result = bmesh.ops.holes_fill(bm, edges=list(component["edges"]), sides=max_hole_edges)
            faces = [face for face in result.get("faces", []) if face.is_valid]
            # Explicitly triangulate the patch so no large concave ngon is left.
            if faces:
                tri = bmesh.ops.triangulate(bm, faces=faces, quad_method="BEAUTY", ngon_method="BEAUTY")
                faces = list(tri.get("faces", []))
                for face in faces:
                    face[original_id] = 0
                    _copy_cap_uv(face, references, uv_layers)
                report["filled_holes"].append({"boundary_edges": len(component["edges"]),
                                               "new_triangles": len(faces),
                                               "center": component["center"], "span": component["span"]})
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        report["after"] = _summary(bm)
        changed_uv = 0
        for face in bm.faces:
            source = face[original_id]
            if source:
                current = [[tuple(loop[layer].uv) for loop in face.loops] for layer in uv_layers]
                # Recalc normals may reverse corner order, but must retain UVs.
                for old_layer, current_layer in zip(source_uv[source], current):
                    if sorted(old_layer) != sorted(current_layer):
                        changed_uv += 1
        report["original_face_uv_mismatches"] = changed_uv
        deform = bm.verts.layers.deform.active
        sums = [sum(vert[deform].values()) for vert in bm.verts] if deform is not None else []
        report["weight_sum_range"] = [min(sums), max(sums)] if sums else None
        report["passed"] = (report["after"]["boundary_edges"] == 0
                            and report["after"]["multiple_face_edges"] == 0
                            and report["after"]["wire_edges"] == 0
                            and report["after"]["nonmanifold_vertices"] == 0
                            and report["after"]["degenerate_faces"] == 0
                            and changed_uv == 0)
        bm.faces.layers.int.remove(original_id)
        bm.to_mesh(mesh)
        mesh.update()
        return report
    finally:
        bm.free()


def finish_branch_repair(mesh):
    """Resolve the three exact audited Tripo defects after repair_mesh_data.

    Faces are located by corner coordinates, not mutable polygon indices.
    Two surplus inner bridge triangles terminate at the remaining radial
    three-face edges. The third triangle is the isolated one-face fan at the
    right shoulder pinch: removing it restores simple boundary loops.
    This function rejects any geometry that differs from that reviewed audit.
    """
    specifications = [
        ("inner_bridge_a", [
            (-0.1467284858226776, 0.12475579231977463, 0.4912112057209015),
            (-0.08715817332267761, 0.15698237717151642, 0.5478517413139343),
            (-0.11547844856977463, 0.13061517477035522, 0.5859376192092896),
        ], 0, 1),
        ("inner_bridge_b", [
            (-0.0881347507238388, 0.15014640986919403, 0.4375001788139343),
            (-0.040771473199129105, 0.15991204977035522, 0.4663088321685791),
            (-0.06323239952325821, 0.16284173727035522, 0.5468752384185791),
        ], 0, 1),
        ("isolated_shoulder_triangle", [
            (0.2790527045726776, 0.037842005491256714, 0.4882814884185791),
            (0.2697753310203552, 0.04907251521945, 0.4858401119709015),
            (0.2307128757238388, 0.0241701602935791, 0.5361331105232239),
        ], 2, 0),
    ]
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.index_update()
        original_id = bm.faces.layers.int.new("voidmaul_source_face")
        uv_layers = list(bm.loops.layers.uv.values())
        source_uv = {}
        for face in bm.faces:
            face[original_id] = face.index + 1
            source_uv[face.index + 1] = [[tuple(loop[layer].uv) for loop in face.loops] for layer in uv_layers]
        report = {"before": _summary(bm), "removed_reviewed_faces": [], "filled_holes": []}
        targets = []
        # Validate all removals before changing anything.
        for label, coordinates, boundary_sides, radial_sides in specifications:
            points = [Vector(co) for co in coordinates]
            matches = [face for face in bm.faces if len(face.verts) == 3
                       and all(any((vert.co - point).length < 1e-7 for vert in face.verts) for point in points)]
            if len(matches) != 1:
                raise ValueError("Audited face %s no longer matches uniquely: %d" % (label, len(matches)))
            face = matches[0]
            if (sum(edge.is_boundary for edge in face.edges) != boundary_sides
                    or sum(len(edge.link_faces) > 2 for edge in face.edges) != radial_sides):
                raise ValueError("Audited local topology changed for %s" % label)
            targets.append(face)
            report["removed_reviewed_faces"].append({
                "reason": label, "current_face_index": face.index,
                "area": face.calc_area(), "vertices": [list(vert.co) for vert in face.verts],
            })
        bmesh.ops.delete(bm, geom=targets, context="FACES_ONLY")
        wire = [edge for edge in bm.edges if not edge.link_faces]
        if wire:
            bmesh.ops.delete(bm, geom=wire, context="EDGES")
        loose = [vert for vert in bm.verts if not vert.link_edges]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        report["after_reviewed_removals"] = _summary(bm)
        components = _boundary_components(bm)
        if any(not component["closed"] for component in components):
            raise ValueError("Reviewed removals did not restore simple closed boundary loops")
        for component in components:
            report["filled_holes"].append(_fill_isolated_cap(bm, component, uv_layers, original_id))
        report["after_caps_before_fan_separation"] = _summary(bm)
        report["separated_point_contacts"] = _separate_closed_vertex_fans(bm, uv_layers, original_id)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        report["after"] = _summary(bm)
        changed_uv = 0
        for face in bm.faces:
            source = face[original_id]
            if source:
                current = [[tuple(loop[layer].uv) for loop in face.loops] for layer in uv_layers]
                changed_uv += sum(sorted(old) != sorted(now) for old, now in zip(source_uv[source], current))
        report["original_face_uv_mismatches"] = changed_uv
        report["passed"] = all(report["after"][key] == 0 for key in (
            "boundary_edges", "multiple_face_edges", "wire_edges", "nonmanifold_vertices", "degenerate_faces")) and changed_uv == 0
        if not report["passed"]:
            raise ValueError("Reviewed repair did not pass manifold and UV validation: %r" % report["after"])
        bm.faces.layers.int.remove(original_id)
        bm.to_mesh(mesh)
        mesh.update()
        return report
    finally:
        bm.free()

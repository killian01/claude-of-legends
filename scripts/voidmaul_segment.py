"""Anatomical face segmentation preserving shared skin weights and atlas UVs."""
import bpy
import bmesh
from collections import Counter

REGIONS = {
    'Body': ['tripo::Root', 'tripo::Spine_0', 'tripo::Spine_1', 'tripo::Spine_2'],
    'Crest': ['tripo::Spine_3', 'tripo::Spine_4'],
    'ForeUpper.L': ['tripo::0_Left_Limb_0', 'bone_9'],
    'ForeLower.L': ['tripo::0_Left_Limb_1'],
    'ForeFoot.L': ['tripo::0_Left_Limb_2'],
    'ForeUpper.R': ['bone_10'],
    'ForeLower.R': ['tripo::1_Left_Limb_0'],
    'ForeFoot.R': ['tripo::1_Left_Limb_1'],
    'HindUpper.L': ['tripo::0_Right_Limb_0'],
    'HindLower.L': ['tripo::0_Right_Limb_1'],
    'HindFoot.L': ['tripo::0_Right_Limb_2', 'tripo::0_Right_Limb_3'],
    'HindUpper.R': ['tripo::1_Right_Limb_0'],
    'HindLower.R': ['tripo::1_Right_Limb_1'],
    'HindFoot.R': ['tripo::1_Right_Limb_2', 'tripo::1_Right_Limb_3'],
}


def segment(source, collection):
    """Copy subsets of faces, preserving every loop layer and vertex group."""
    names = list(REGIONS)
    region_of = {bone: i for i, region in enumerate(names) for bone in REGIONS[region]}
    weights = []
    for vertex in source.data.vertices:
        scores = [0.0] * len(names)
        for group in vertex.groups:
            name = source.vertex_groups[group.group].name
            if name in region_of:
                scores[region_of[name]] += group.weight
        weights.append(scores)
    labels = []
    for face in source.data.polygons:
        scores = [sum(weights[v][i] for v in face.vertices) for i in range(len(names))]
        labels.append(max(range(len(names)), key=lambda i: scores[i]))
    # Suppress isolated single triangles without moving a geometric boundary.
    edge_faces = {}
    for face in source.data.polygons:
        for edge in face.edge_keys:
            edge_faces.setdefault(tuple(sorted(edge)), []).append(face.index)
    neighbors = [set() for _ in labels]
    for faces in edge_faces.values():
        for index in faces:
            neighbors[index].update(j for j in faces if j != index)
    for _ in range(3):
        updated = labels[:]
        for index, adjacent in enumerate(neighbors):
            counts = Counter(labels[j] for j in adjacent)
            if counts and counts[labels[index]] == 0:
                winner, count = counts.most_common(1)[0]
                if count >= 2:
                    updated[index] = winner
        labels = updated
    face_layer = source.data.attributes.get('AnatomyRegion')
    if face_layer is None:
        face_layer = source.data.attributes.new('AnatomyRegion', 'INT', 'FACE')
    for datum, label in zip(face_layer.data, labels):
        datum.value = label
    ids = source.data.attributes.get('SourceVertex')
    if ids is None:
        ids = source.data.attributes.new('SourceVertex', 'INT', 'POINT')
    for i, datum in enumerate(ids.data):
        datum.value = i
    result = []
    for region_index, name in enumerate(names):
        part = source.copy()
        part.data = source.data.copy()
        part.name = 'Voidmaul_' + name
        part.data.name = part.name + '_Mesh'
        collection.objects.link(part)
        bm = bmesh.new()
        bm.from_mesh(part.data)
        layer = bm.faces.layers.int.get('AnatomyRegion')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != region_index], context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(part.data)
        bm.free()
        part.data.update()
        part['anatomy_region'] = name
        part['shared_atlas'] = 'UVMap'
        part['source_mesh'] = source.name
        result.append(part)
    return result

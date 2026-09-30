"""Smooth the editable Codex tail with Blender B-Bone deformation.

This changes deformation only: the eight Tail01..Tail08 controls, their rest
transforms, animation channels, vertex weights and repaired seams are retained.
B-Bones are supported by the delivered Blender project and its video renders;
a game/glTF export would need the deformation baked to an export skeleton.
"""


def soften_tail(rig, body_objects):
    """Configure six deformation segments per existing tail control.

    Call on the rest rig, after repair_body, before authoring Codex actions.
    All armature-deformed tail surfaces, including flame meshes, automatically
    use the same deformation, so the skin and its attached details stay paired.
    """
    names = [f'Tail{i:02}' for i in range(1, 9)]
    missing = [name for name in names if name not in rig.data.bones]
    if missing:
        raise ValueError(f'Missing tail bones: {missing}')
    for name in names:
        bone = rig.data.bones[name]
        bone.bbone_segments = 6
        bone.bbone_mapping_mode = 'CURVED'
        bone.bbone_handle_type_start = 'AUTO'
        bone.bbone_handle_type_end = 'AUTO'
        bone.bbone_easein = 1.0
        bone.bbone_easeout = 1.0
    rig['codex_tail_deformation'] = 'Eight original controls; six B-Bone segments per control; curved rest mapping'
    return {
        'method': 'Six B-Bone segments per original tail bone, automatic handles and curved rest mapping',
        'bones': names,
        'deformation_segments_per_bone': 6,
        'additional_animation_controls': 0,
        'vertex_weights_unchanged': True,
        'repaired_seams_unchanged': True,
        'geometry_and_uvs_preserved': True,
        'delivery': 'Native Blender deformation and rendered videos; bake required for glTF export',
    }

"""Position the eight Codex tail controls from a continuous 3D centreline.

The existing tail weights and B-Bone surface deformation are retained. This
controller changes the control frames, not mesh topology or the bind pose.
Directions and returned points are in armature space (also world space for the
identity-transformed Pyrefang rig). No source animation is read or evaluated.
"""

import math

import bpy
from mathutils import Matrix, Vector


TAIL_NAMES = tuple(f'Tail{i:02}' for i in range(1, 9))


def _perpendicular(reference, tangent):
    """Project a frame axis, with a deterministic fallback at a singularity."""
    side = reference - tangent * reference.dot(tangent)
    if side.length_squared < 1e-12:
        reference = min((Vector((1, 0, 0)), Vector((0, 1, 0)),
                         Vector((0, 0, 1))), key=lambda axis: abs(axis.dot(tangent)))
        side = reference - tangent * reference.dot(tangent)
    return side.normalized()


def apply_tail_curve(rig, tangents):
    """Apply eight desired directions while preserving each bone's length.

    ``tangents`` contains eight nonzero 3D directions in armature space. They
    need not be normalized. The first head follows its existing attachment to
    Hips; subsequent heads meet the preceding tips exactly. The lateral frame
    starts from the bind-pose lateral axis transformed by Hips and is parallel
    transported along the chain, avoiding the twist and Euler accumulation
    errors caused by independently adding pitch and yaw.

    Bone basis transforms are solved against the *new* parent frames, using
    Blender's native rest/pose conversion. Consequently only one dependency
    graph update is needed, before reading the animated pelvis. The caller can
    evaluate the resulting pose once after its other controls have been set.
    XYZ Euler controls remain compatible with the existing animation bake.

    Returns the nine solved head/tip points as mathutils Vectors.
    """
    directions = [Vector(direction) for direction in tangents]
    if len(directions) != len(TAIL_NAMES):
        raise ValueError('The tail curve requires exactly eight directions')
    for direction in directions:
        if len(direction) != 3 or not all(math.isfinite(v) for v in direction):
            raise ValueError('Tail directions must contain three finite values')
        if direction.length_squared < 1e-12:
            raise ValueError('Tail directions must be nonzero')
        direction.normalize()

    bones = [rig.data.bones[name] for name in TAIL_NAMES]
    controls = [rig.pose.bones[name] for name in TAIL_NAMES]
    parent = controls[0].parent
    if parent is None:
        raise ValueError('Tail01 must retain its pelvis attachment')
    bpy.context.view_layer.update()
    parent_matrix = parent.matrix.copy()
    parent_rest = parent.bone.matrix_local.copy()
    pelvis_deform = parent_matrix @ parent_rest.inverted()
    head = pelvis_deform @ bones[0].head_local
    points = [head.copy()]

    # A deterministic frame anchored to the pelvis closes periodic motion
    # without accumulating a temporal roll over repeated playback loops.
    rest_side = bones[0].matrix_local.to_3x3().col[0]
    side = _perpendicular(pelvis_deform.to_3x3() @ rest_side, directions[0])
    previous_direction = directions[0]
    for bone, control, direction in zip(bones, controls, directions):
        if previous_direction.dot(direction) < -.999999:
            # A 180-degree bend has no unique transport axis. Preserve the
            # existing lateral axis, which remains perpendicular to both.
            side = _perpendicular(side, direction)
        else:
            side = previous_direction.rotation_difference(direction) @ side
            side = _perpendicular(side, direction)
        normal = side.cross(direction).normalized()
        desired = Matrix((side, direction, normal)).transposed().to_4x4()
        desired.translation = head
        basis = bone.convert_local_to_pose(
            desired, bone.matrix_local,
            parent_matrix=parent_matrix, parent_matrix_local=parent_rest,
            invert=True,
        )
        location, rotation, scale = basis.decompose()
        control.rotation_mode = 'XYZ'
        control.location = location
        control.rotation_euler = rotation.to_euler('XYZ', control.rotation_euler)
        control.scale = scale
        head = head + direction * bone.length
        points.append(head.copy())
        parent_matrix, parent_rest = desired, bone.matrix_local
        previous_direction = direction
    return points

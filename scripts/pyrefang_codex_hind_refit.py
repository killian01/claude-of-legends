"""Refit the right hind leg bones onto the right hind leg mesh.

The source rig copied the left hind chain onto the right side, but the Tripo
mesh stands with its right hind leg about 8 cm further forward. The right
hock bone therefore pivoted behind the paw and the knee sat inside the thigh.
The joints below are measured on the rest mesh: the hock is the centroid of
the R_Shin/R_Foot seam, the knee is the stifle bump seen from the side. The
leg weights are then rebuilt as one continuous function of position, so the
parts still share weights on their seams.
Run on the rest pose, before the seam repair and before capturing REST.
"""

import bpy
import numpy as np
from mathutils import Vector

KNEE = Vector((-.066, -.010, .205))
HOCK = Vector((-.079, .072, .068))
TOE = Vector((-.090, .002, .012))
CHAIN = ('R_Thigh', 'R_Shin', 'R_Foot')
BAND = .022


def _roll_x(edit_bone):
    """Keep local X on world X, as on every other bone of this rig."""
    y = (edit_bone.tail-edit_bone.head).normalized()
    edit_bone.align_roll(Vector((1, 0, 0)).cross(y))


def _blend(points, joint, normal):
    s = (points-np.array(joint)) @ np.array(normal)/BAND
    s = np.clip(.5+.5*s, 0.0, 1.0)
    return s*s*(3-2*s)


def refit_right_hind(rig, body_objects):
    before = {name: (rig.data.bones[name].head_local.copy(), rig.data.bones[name].tail_local.copy())
              for name in CHAIN}
    view_layer = bpy.context.view_layer
    for ob in view_layer.objects:
        ob.select_set(False)
    view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones = rig.data.edit_bones
    bones['R_Thigh'].tail = KNEE
    bones['R_Shin'].head, bones['R_Shin'].tail = KNEE, HOCK
    bones['R_Foot'].head, bones['R_Foot'].tail = HOCK, TOE
    for name in CHAIN:
        _roll_x(bones[name])
    bpy.ops.object.mode_set(mode='OBJECT')
    view_layer.update()

    hip = rig.data.bones['R_Thigh'].head_local
    thigh = (KNEE-hip).normalized()
    shin = (HOCK-KNEE).normalized()
    foot = (TOE-HOCK).normalized()
    knee_normal = (thigh+shin).normalized()
    hock_normal = (shin+foot).normalized()
    changed = 0
    for ob in body_objects:
        groups = [ob.vertex_groups.get(name) for name in CHAIN]
        if not any(groups):
            continue
        groups = [g or ob.vertex_groups.new(name=name) for g, name in zip(groups, CHAIN)]
        index = {g.index: k for k, g in enumerate(groups)}
        rows = []
        for vertex in ob.data.vertices:
            total = sum(g.weight for g in vertex.groups if g.group in index)
            if total > 0:
                rows.append((vertex.index, total, tuple(ob.matrix_world @ vertex.co)))
        if not rows:
            continue
        ids = [r[0] for r in rows]
        totals = np.array([r[1] for r in rows])
        points = np.array([r[2] for r in rows])
        below_knee = _blend(points, KNEE, knee_normal)
        below_hock = _blend(points, HOCK, hock_normal)
        weights = (totals*(1-below_knee), totals*below_knee*(1-below_hock),
                   totals*below_knee*below_hock)
        for group, values in zip(groups, weights):
            group.remove(ids)
            for vertex_index, value in zip(ids, values):
                if value > 1e-4:
                    group.add([vertex_index], float(value), 'REPLACE')
        changed += len(ids)
    return {'bones_before': {n: [list(h), list(t)] for n, (h, t) in before.items()},
            'knee': list(KNEE), 'hock': list(HOCK), 'toe': list(TOE),
            'band_m': BAND, 'reweighted_vertices': changed}

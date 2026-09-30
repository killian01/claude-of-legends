"""Articulated limb poses driven by the pad, with independent paw rotation.

The foot's rest mesh supplies the pad lever. Rotating a lifted paw therefore
retracts the wrist/hock while the pad follows its authored flight trajectory.
This avoids translating a permanently level paw and nearly straight limb.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector


class LegSolver:
    def __init__(self, rig, meshes):
        self.rig = rig
        self.rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
        self.pad_offsets = {}
        self.toe_offsets = {}
        for side in ('L', 'R'):
            for suffix in ('Hand', 'Foot'):
                name = side + '_' + suffix
                mesh = next(ob for ob in meshes if ob.name == 'Pyrefang_' + name)
                points = np.array([tuple(mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices])
                sole = points[points[:, 2] <= points[:, 2].min() + .009]
                pad = Vector((float(np.median(sole[:, 0])), float(np.median(sole[:, 1])),
                              float(points[:, 2].min())))
                self.pad_offsets[name] = pad - rig.data.bones[name].head_local
                # The claw tips: the pivot of a paw peeling off the ground.
                toe = sole[sole[:, 1].argmin()]
                self.toe_offsets[name] = Vector((float(np.median(sole[:, 0])), float(toe[1]),
                                                 float(points[:, 2].min()))) - rig.data.bones[name].head_local

    def _orient(self, name, head, tip):
        bone = self.rig.data.bones[name]
        rotation = (bone.tail_local-bone.head_local).rotation_difference(tip-head)
        matrix = (rotation.to_matrix() @ self.rest[name].to_3x3()).to_4x4()
        matrix.translation = head
        self.rig.pose.bones[name].matrix = matrix
        bpy.context.view_layer.update()

    @staticmethod
    def _names(side, front):
        return [side+'_'+suffix for suffix in
                (('UpperArm', 'Forearm', 'Hand') if front else ('Thigh', 'Shin', 'Foot'))]

    def pose(self, side, front, delta=(0, 0, 0), paw_pitch=0, shoulder_offset=(0, 0, 0)):
        foot = self._names(side, front)[2]
        rotation = Matrix.Rotation(math.radians(paw_pitch), 3, 'X')
        lever = self.pad_offsets[foot]
        c = self.rig.data.bones[foot].head_local + Vector(delta) + lever - rotation @ lever
        self._solve(side, front, c, rotation, shoulder_offset)

    def pose_toe(self, side, front, toe, paw_pitch=0, shoulder_offset=(0, 0, 0), paw_yaw=0,
                 pole=None):
        """Place the claw tips at `toe` (armature space), paw pitched about them
        and optionally turned about the vertical to follow a turned body."""
        foot = self._names(side, front)[2]
        rotation = (Matrix.Rotation(math.radians(paw_yaw), 3, 'Z')
                    @ Matrix.Rotation(math.radians(paw_pitch), 3, 'X'))
        c = Vector(toe) - rotation @ self.toe_offsets[foot]
        return self._solve(side, front, c, rotation, shoulder_offset, pole)

    def rest_toe(self, side, front):
        foot = self._names(side, front)[2]
        return self.rig.data.bones[foot].head_local + self.toe_offsets[foot]

    def _solve(self, side, front, c, rotation, shoulder_offset, pole=None):
        upper, lower, foot = self._names(side, front)
        bpy.context.view_layer.update()
        a = self.rig.pose.bones[upper].head.copy()
        if front:
            a += Vector(shoulder_offset)
        l1, l2 = self.rig.data.bones[upper].length, self.rig.data.bones[lower].length
        reach = (c-a).length/(l1+l2)
        axis = c-a
        distance = max(abs(l1-l2)+.0001, min(axis.length, (l1+l2)*.998))
        axis.normalize()
        if pole is None:
            pole = Vector((.12 if side == 'L' else -.12, 1 if front else -1, 0))
        bend = (pole-axis*pole.dot(axis)).normalized()
        along = (l1*l1-l2*l2+distance*distance)/(2*distance)
        height = math.sqrt(max(0, l1*l1-along*along))
        b = a+along*axis+height*bend
        c = a+distance*axis
        self._orient(upper, a, b)
        self._orient(lower, b, c)
        matrix = (rotation @ self.rest[foot].to_3x3()).to_4x4()
        matrix.translation = c
        self.rig.pose.bones[foot].matrix = matrix
        bpy.context.view_layer.update()
        return reach

    def report(self):
        return {'method': 'Two-segment limb solve; paw pitch rotates about the measured sole pad, '
                          'or about the claw tips for the walk',
                'pad_offsets_m': {name: list(point) for name, point in self.pad_offsets.items()},
                'toe_offsets_m': {name: list(point) for name, point in self.toe_offsets.items()}}

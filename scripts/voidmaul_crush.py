"""Two-handed, rear-supported Voidmaul crush using the unchanged IK rig.

The thorax rises separately from the hips, both forepaws curl upward together,
then strike on frame43 (1.75s). Only a new action is authored. All prior clips,
constraints, bind matrices, UVs, skin and mesh topology remain untouched.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from voidmaul_walk import (LIMBS, _fcurves, _matrix, _measure_soles,
                          _set_pose_matrix, _sole_samples, _update, _world_delta)
from voidmaul_spawn import _stable_fore_pole

ACTION_NAME = 'Voidmaul_AttackCrush_77f'
FPS = 24
LAST_FRAME = 77
CONTACT_FRAME = 43
SPINES = tuple('tripo::Spine_'+str(i) for i in range(5))


def track(time, keys):
    if time <= keys[0][0]:
        return keys[0][1]
    for (a, x), (b, y) in zip(keys, keys[1:]):
        if time <= b:
            u = (time-a)/(b-a)
            return x+(y-x)*u*u*(3-2*u)
    return keys[-1][1]


def rotation(x=0, y=0, z=0):
    return (Quaternion((0, 0, 1), math.radians(z))
            @ Quaternion((0, 1, 0), math.radians(y))
            @ Quaternion((1, 0, 0), math.radians(x)))


def contact_windows():
    return {'Hind_L': [(1, LAST_FRAME)], 'Hind_R': [(1, LAST_FRAME)],
            'Fore_L': [(1, 5), (CONTACT_FRAME, LAST_FRAME)],
            'Fore_R': [(1, 5), (CONTACT_FRAME, LAST_FRAME)]}


def pose_crush(rig, time, height, rests, floor, clearance):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
    _update()
    rear = track(time, [(0,0),(.12,0),(.68,.65),(1.16,1),(1.46,1),
                        (1.67,.43),(1.75,0),(3.166667,0)])
    lift = track(time, [(0,0),(.166667,0),(.70,.34),(1.15,.60),
                        (1.46,.60),(1.625,.43),(1.708333,.16),
                        (1.75,0),(3.166667,0)])
    impact = track(time, [(0,0),(1.708333,0),(1.75,.48),(1.875,1),
                          (2.041667,.43),(2.25,0),(3.166667,0)])
    recoil = track(time, [(0,0),(1.916667,0),(2.125,1),
                          (2.375,.30),(2.70,0),(3.166667,0)])
    brace = track(time, [(0,0),(.166667,1),(1.50,1),(1.75,0),(3.166667,0)])
    # Body drives the heavy hip root. A separately lifted spine root raises the
    # chest without dragging the short planted rear legs beyond their reach.
    hip = rests['CTRL_Body']
    _set_pose_matrix(rig.pose.bones['CTRL_Body'],
        _matrix(hip.translation+height*Vector((0,.016*rear,
                                              .008*rear-.027*impact+.006*recoil)),
                rotation(x=-2*rear+2.4*impact-.6*recoil) @ hip.to_quaternion()))
    _update()
    chest = rig.pose.bones[SPINES[0]]
    inherited = chest.parent.matrix @ chest.parent.bone.matrix_local.inverted() @ chest.bone.matrix_local
    inherited.translation += height*Vector((0,.040*rear-.010*impact,
                                            .160*rear-.035*impact+.010*recoil))
    _set_pose_matrix(chest, _matrix(inherited.translation,
        rotation(x=-7*rear+4*impact-1.5*recoil) @ inherited.to_quaternion()))
    _update()
    for index, amplitude in enumerate((3,2,4,2), start=1):
        _world_delta(rig.pose.bones[SPINES[index]],
                     rotation(x=-amplitude*rear+amplitude*.45*impact))
        _update()
    expected = {}
    for label, data in LIMBS.items():
        foot = rests['CTRL_'+label+'_Foot']
        position = foot.translation.copy()
        if data['front']:
            # Flat, calibrated hand orientation avoids axial twisting of the
            # shoulder caps. The fold stays in front of its own shoulder.
            sign = 1 if label.endswith('_R') else -1
            position += height*Vector((sign*.008*rear,-.035*rear,lift))
            expected[label] = floor+clearance+height*lift
        else:
            expected[label] = floor+clearance
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Foot'],
                         _matrix(position,foot.to_quaternion()))
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Pole'],
                         rests['CTRL_'+label+'_Pole'])
    _update()
    turns = {}
    if rear > .0001 or impact > .0001 or recoil > .0001:
        for label in ('Fore_R', 'Fore_L'):
            turns[label] = _stable_fore_pole(rig,label)
    return expected, {'thorax_rise_fraction':.160*rear,
                      'forepaw_lift_fraction':lift,'rear_weight':rear,
                      'impact_compression':impact,'recoil':recoil,
                      'fore_pole_turn_degrees':turns}


def build_crush(rig, meshes, action_name=ACTION_NAME):
    """Author a separate action, measure soles, restore the active source pose."""
    if bpy.data.actions.get(action_name):
        raise ValueError('Preserve existing crush; use a fresh candidate source')
    if len(meshes) != 14 or len(rig.data.bones) != 32:
        raise ValueError('Expected original 14 segments and 32-bone control rig')
    scene = bpy.context.scene
    rig.animation_data_create()
    previous = rig.animation_data.action
    previous_slot = getattr(rig.animation_data,'action_slot',None)
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    previous_basis = {b.name:b.matrix_basis.copy() for b in rig.pose.bones}
    previous_modes = {b.name:b.rotation_mode for b in rig.pose.bones}
    rests = {b.name:b.bone.matrix_local.copy() for b in rig.pose.bones}
    inverse = rig.matrix_world.inverted()
    points = [inverse@m.matrix_world@v.co for m in meshes for v in m.data.vertices]
    height = max(p.z for p in points)-min(p.z for p in points)
    floor, samples = _sole_samples(rig,meshes,height)
    clearance = height*.00035
    action = bpy.data.actions.new(action_name)
    action.use_fake_user = True
    report = {'action':action.name,'fps':FPS,'frames':[1,LAST_FRAME],
              'impact_frame':CONTACT_FRAME,'impact_seconds':(CONTACT_FRAME-1)/FPS,
              'duration_seconds':(LAST_FRAME-1)/FPS,'height':height,'floor':floor,
              'sole_clearance':clearance,'contact_windows':contact_windows(),
              'max_keyed_sole_height_residual':0.0,'max_mesh_floor_penetration':0.0,
              'ground_bounds':[]}
    try:
        rig.animation_data.action = action
        for frame in range(1,LAST_FRAME+1):
            scene.frame_set(frame)
            expected, description = pose_crush(rig,(frame-1)/FPS,height,rests,floor,clearance)
            for iteration in range(12):
                measured, minimum, _ = _measure_soles(rig,meshes,samples)
                errors = {label:expected[label]-measured[label] for label in LIMBS}
                if max(abs(value) for value in errors.values()) < height*.000015:
                    break
                for label,error in errors.items():
                    bone = rig.pose.bones['CTRL_'+label+'_Foot']
                    pose = bone.matrix.copy();pose.translation.z += error
                    _set_pose_matrix(bone,pose)
                _update()
            measured, minimum, _ = _measure_soles(rig,meshes,samples)
            residual = max(abs(measured[label]-expected[label]) for label in LIMBS)
            report['max_keyed_sole_height_residual'] = max(report['max_keyed_sole_height_residual'],residual)
            report['max_mesh_floor_penetration'] = max(report['max_mesh_floor_penetration'],floor-minimum)
            report['ground_bounds'].append({'frame':frame,'sole_minimum_z':measured,
                                            'minimum_z':minimum,**description})
            for bone in rig.pose.bones:
                if bone.name.startswith('CTRL_') or bone.name in SPINES:
                    for path in ('location','rotation_quaternion'):
                        bone.keyframe_insert(data_path=path,frame=frame,group=bone.name)
            if frame in (1,25,43,77):
                print('[crush] keyed',frame,'residual',residual,'floor',minimum,flush=True)
        for curve in _fcurves(action):
            for key in curve.keyframe_points:
                key.interpolation='LINEAR'
        action['impact_frame']=CONTACT_FRAME
        action['impact_seconds']=(CONTACT_FRAME-1)/FPS
        action['duration_seconds']=(LAST_FRAME-1)/FPS
        action['attack_feet']='Fore_L + Fore_R simultaneously'
        action['one_shot']=True
        report['animation_channels']=len(_fcurves(action))
        return report
    finally:
        rig.animation_data.action=previous
        if previous_slot: rig.animation_data.action_slot=previous_slot
        scene.frame_set(old_frame,subframe=old_subframe)
        for bone in rig.pose.bones:
            bone.matrix_basis=previous_basis[bone.name]
            bone.rotation_mode=previous_modes[bone.name]
        _update()

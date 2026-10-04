"""Forceful quadruped emergence on the existing segmented Voidmaul rig.

The paws grip independently, the crest/chest unfurl before the rear landing,
and a planted three-foot brace supports one heavy forepaw stomp and bellow.
Only a new action is created. Bind matrices, skin, IK and existing clips stay
unchanged. The ground intentionally occludes the early subterranean poses.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector

from voidmaul_walk import (LIMBS, _fcurves, _matrix, _measure_soles,
                          _set_pose_matrix, _sole_samples, _update, _world_delta)

FPS = 24
PERIOD = 96
SPINES = tuple('tripo::Spine_'+str(i) for i in range(5))
TIMING = {'rupture': .45, 'fore_R_contact': .60, 'fore_L_contact': .72,
          'hind_R_contact': 1.82, 'hind_L_contact': 2.02,
          'full_emergence': 2.02, 'stomp': 2.30, 'end': 4.0}


def smooth(value):
    value = min(1.0, max(0.0, value))
    return value*value*(3-2*value)


def track(time, keys):
    if time <= keys[0][0]:
        return keys[0][1]
    for (a, x), (b, y) in zip(keys, keys[1:]):
        if time <= b:
            return x+(y-x)*smooth((time-a)/(b-a))
    return keys[-1][1]


def rotation(x=0, y=0, z=0):
    return (Quaternion((0,0,1), math.radians(z))
            @ Quaternion((0,1,0), math.radians(y))
            @ Quaternion((1,0,0), math.radians(x)))


def _stable_fore_pole(rig, label):
    """Choose the bend plane with the least upper-arm rotation from its parent.

    A standing pole cannot be translated straight down through an emergence:
    the wrist starts above its buried shoulder and the target axis reverses.
    Search around that actual axis while retaining the original pole angle.
    This changes only the keyed pole target, never the calibrated IK setup.
    """
    upper = rig.pose.bones[LIMBS[label]['chain'][0]]
    control = rig.pose.bones['CTRL_'+label+'_Foot']
    pole = rig.pose.bones['CTRL_'+label+'_Pole']
    shoulder = upper.head.copy()
    axis = (control.matrix.translation-shoulder).normalized()
    offset = pole.matrix.translation-shoulder
    along = axis*offset.dot(axis)
    radial = offset-along
    tangent = axis.cross(radial)
    inherited = upper.parent.matrix @ upper.parent.bone.matrix_local.inverted() @ upper.bone.matrix_local
    reference = inherited.to_quaternion()
    pole_matrix = pole.matrix.copy()
    best_angle,best_score = 0,math.inf

    def evaluate(angle):
        candidate = pole_matrix.copy()
        candidate.translation = shoulder+along+math.cos(angle)*radial+math.sin(angle)*tangent
        _set_pose_matrix(pole,candidate)
        _update()
        delta = upper.matrix.to_quaternion() @ reference.inverted()
        return 1-abs(delta.w)+abs(angle)*.00002

    for index in range(-12,13):
        angle = index*math.tau/24
        score = evaluate(angle)
        if score<best_score:
            best_angle,best_score = angle,score
    step = math.tau/24
    for _ in range(3):
        center = best_angle
        for index in range(-4,5):
            angle = center+index*step/4
            score = evaluate(angle)
            if score<best_score:
                best_angle,best_score = angle,score
        step /= 4
    evaluate(best_angle)
    return math.degrees(best_angle)


def _pose(rig, time, height, rests, floor, clearance):
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
        bone.rotation_mode = 'QUATERNION'
    _update()
    rise = track(time, [(0,-1.10),(.14,-1.10),(.25,-.90),(.40,-.65),
                       (.55,-.23),(.65,-.19),(.93,-.09),(1.15,-.05),
                       (1.50,-.015),(1.82,0),(4,0)])
    pull = track(time, [(0,0),(.25,0),(.50,1),(.92,.70),(1.50,0),(4,0)])
    rear_drop = track(time, [(0,0),(1.08,.150),(1.48,.130),(1.82,.025),
                            (2.02,.036),(2.17,.055),(2.36,.027),(3.2,.02),(4,0)])
    compression = track(time, [(0,0),(1.78,0),(2.06,.60),(2.16,.28),
                              (2.23,.15),(2.30,1),(2.43,.15),(2.62,-.05),
                              (3.0,0),(4,0)])
    bellow = track(time, [(0,0),(2.18,0),(2.48,1),(2.78,1),
                         (3.02,.56),(3.35,.20),(3.72,0),(4,0)])
    toss = track(time, [(0,0),(2.62,0),(2.79,1),(2.91,-.28),(3.22,0),(4,0)])
    brace = track(time, [(0,0),(.42,0),(.72,1),(3.12,1),(3.76,0),(4,0)])
    chest_drop = .032*brace+.034*pull+.070*compression-.008*bellow
    sway = track(time, [(0,0),(.60,-1),(.90,.7),(1.35,0),
                       (1.82,.5),(2.02,-.6),(2.20,0),(2.30,-.6),
                       (2.48,.35),(3.20,0),(4,0)])
    displacement = height*Vector((.012*sway, -.018*pull-.012*bellow, rise))
    global_pose = rests['CTRL_Global'].copy()
    global_pose.translation.z += height*rise
    _set_pose_matrix(rig.pose.bones['CTRL_Global'], global_pose)
    _update()
    body_rest = rests['CTRL_Body']
    _set_pose_matrix(rig.pose.bones['CTRL_Body'],
        _matrix(body_rest.translation+displacement-height*Vector((0,0,chest_drop)),
                rotation(x=4*pull+3*compression,y=2*sway,z=2*sway)
                @ body_rest.to_quaternion()))
    _update()
    pelvis = rests['CTRL_Pelvis']
    pelvis_position = pelvis.translation+height*Vector((.006*sway,.008*pull,rise-rear_drop))
    _set_pose_matrix(rig.pose.bones['CTRL_Pelvis'],
        _matrix(pelvis_position, rotation(x=-3*pull+2*compression,y=1.7*sway,z=-1.5*sway)
                @ pelvis.to_quaternion()))
    _update()
    # The Tripo spine runs diagonally through the crest. A separate chest root
    # and distributed model-axis bends keep this from becoming one rigid tip.
    spine = rig.pose.bones[SPINES[0]]
    inherited = spine.parent.matrix @ spine.parent.bone.matrix_local.inverted() @ spine.bone.matrix_local
    inherited.translation += height*Vector((.006*sway,-.024*pull-.010*bellow,
                                            rear_drop-chest_drop))
    _set_pose_matrix(spine, _matrix(inherited.translation,
        rotation(x=7*pull+4*compression-3*bellow,y=2*sway,z=2*sway)
        @ inherited.to_quaternion()))
    _update()
    for index, (fold, arch, recoil) in enumerate(((3,2,2),(5,4,4),(8,9,8),(6,7,6)), start=1):
        _world_delta(rig.pose.bones[SPINES[index]],
                     rotation(x=fold*pull-arch*bellow+recoil*toss,
                              y=(.8 if index<3 else 1.3)*sway,
                              z=-.6*sway))
        _update()
    expected, planted = {}, set()
    for label, limb in LIMBS.items():
        sign = 1 if label.endswith('_R') else -1
        foot = rests['CTRL_'+label+'_Foot']
        pole = rests['CTRL_'+label+'_Pole']
        position = foot.translation.copy()
        if limb['front']:
            contact = TIMING['fore_'+label[-1]+'_contact']
            grip = smooth((time-.18)/(contact-.18))
            expected[label] = floor+clearance+height*rise*(1-grip)
            stance = smooth((time-.22)/(contact-.22))
            recover_start, recover_end = ((3.15,3.58) if sign>0 else (3.40,3.82))
            recover = smooth((time-recover_start)/(recover_end-recover_start))
            position += height*Vector((sign*.025*stance*(1-recover),
                                       -.035*stance*(1-recover),rise*(1-grip)))
            preparation = track(time, [(0,0),(.30,1),(contact,0),(4,0)])
            stomp = (track(time, [(0,0),(2.02,0),(2.14,.16),(2.20,.16),
                                  (2.30,0),(4,0)]) if sign>0 else 0)
            reset_lift = .035*math.sin(math.pi*recover) if 0<recover<1 else 0
            expected[label] += height*(stomp+reset_lift)
            position.z += height*(stomp+reset_lift)
            foot_rotation = rotation(x=12*preparation+9*stomp/.16)
            if time>=contact and not (sign>0 and 2.02<time<2.30) and not (0<recover<1):
                planted.add(label)
        else:
            contact = TIMING['hind_'+label[-1]+'_contact']
            # The short rear legs travel with the delayed hips, then extend
            # in sequence. Their sole does not pop up before the body is out.
            grip = smooth((time-(contact-.34))/.34)
            depth = rise-rear_drop
            expected[label] = floor+clearance+height*depth*(1-grip)
            position.z += height*depth*(1-grip)
            tuck = track(time, [(0,0),(.55,0),(1.20,1),(contact,0),(4,0)])
            position += height*Vector((sign*.010*tuck,-.035*tuck,0))
            foot_rotation = rotation(x=8*tuck)
            if time>=contact:
                planted.add(label)
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Foot'],
                         _matrix(position,foot_rotation @ foot.to_quaternion()))
        # Preserve the calibrated plane relative to its shoulder/hip. Once
        # the chest is above ground the foreleg poles stay at their rest plane.
        pole_pose = pole.copy()
        pole_pose.translation.z += height*(rise if limb['front'] else rise-rear_drop)
        _set_pose_matrix(rig.pose.bones['CTRL_'+label+'_Pole'],pole_pose)
    _update()
    return expected, planted, {'rise':rise,'pull':pull,'compression':compression,
                               'bellow':bellow,'crest_toss':toss,'chest_drop':chest_drop}


def build_spawn(rig, meshes, action_name='Voidmaul_Spawn_96f'):
    """Create only Spawn and restore the source action, pose and frame."""
    meshes = [m for m in meshes if m.type=='MESH' and m.get('anatomy_region')]
    if len(meshes)!=14:
        raise ValueError('Pass exactly the 14 anatomical mesh segments')
    scene = bpy.context.scene
    rig.animation_data_create()
    previous = rig.animation_data.action
    previous_slot = getattr(rig.animation_data,'action_slot',None)
    previous_pose = {b.name:b.matrix_basis.copy() for b in rig.pose.bones}
    previous_modes = {b.name:b.rotation_mode for b in rig.pose.bones}
    frame, subframe = scene.frame_current,scene.frame_subframe
    frame_range = scene.frame_start,scene.frame_end
    original_actions = set(bpy.data.actions.keys())
    required = ['CTRL_Global','CTRL_Body','CTRL_Pelvis']
    required += ['CTRL_'+label+'_'+suffix for label in LIMBS for suffix in ('Foot','Pole')]
    rests = {name:rig.data.bones[name].matrix_local.copy() for name in required}
    inverse = rig.matrix_world.inverted()
    points = [inverse@m.matrix_world@v.co for m in meshes for v in m.data.vertices]
    height = max(p.z for p in points)-min(p.z for p in points)
    floor, samples = _sole_samples(rig,meshes,height)
    for label, limb in LIMBS.items():
        region = ('ForeFoot.' if limb['front'] else 'HindFoot.')+label[-1]
        samples[label] = [(m,v.index) for m in meshes if m.get('anatomy_region')==region
                          for v in m.data.vertices]
    clearance, collision = height*.00060,height*.00045
    report = {'fps':FPS,'duration_seconds':PERIOD/FPS,'frame_range':[1,PERIOD+1],
              'frames':[1,PERIOD+1],'loop':False,
              'height':height,'floor':floor,'sole_clearance':clearance,
              'collision_clearance':collision,'timing_seconds':TIMING.copy(),
              'max_supporting_sole_error':0,'max_mesh_floor_penetration':0,
              'max_global_floor_lift':0,'ground_bounds':[],'warnings':[]}
    if previous:
        previous.use_fake_user = True
    try:
        rig.animation_data.action = None
        action = bpy.data.actions.new(action_name)
        action.use_fake_user = True
        rig.animation_data.action = action
        report['action'] = action.name
        active_plants, windows = {label:None for label in LIMBS},{label:[] for label in LIMBS}
        for key in range(1,PERIOD+2):
            scene.frame_set(key)
            time = (key-1)/FPS
            expected, planted, pose = _pose(rig,time,height,rests,floor,clearance)
            global_lift = 0
            pole_turns = {}
            for iteration in range(12):
                for _ in range(10):
                    measured, minimum, _ = _measure_soles(rig,meshes,samples)
                    residual = {label:target-measured[label] for label,target in expected.items()}
                    if max(abs(error) for error in residual.values())<=height*.000020:
                        break
                    for label,error in residual.items():
                        control = rig.pose.bones['CTRL_'+label+'_Foot']
                        matrix = control.matrix.copy()
                        matrix.translation.z += error
                        _set_pose_matrix(control,matrix)
                    _update()
                if iteration==0:
                    pole_turns = {label:_stable_fore_pole(rig,label) for label in ('Fore_R','Fore_L')}
                    # Reground after changing the bend plane, which can move
                    # the few blended vertices at the proximal foot boundary.
                    continue
                measured,minimum,_ = _measure_soles(rig,meshes,samples)
                if time<TIMING['full_emergence'] or minimum>=floor+collision-height*.000025:
                    break
                correction = floor+collision-minimum
                control = rig.pose.bones['CTRL_Global']
                matrix = control.matrix.copy()
                matrix.translation.z += correction
                global_lift += correction
                _set_pose_matrix(control,matrix)
                _update()
            report['max_global_floor_lift'] = max(report['max_global_floor_lift'],global_lift)
            report['max_supporting_sole_error'] = max(
                [report['max_supporting_sole_error']]+[abs(measured[l]-expected[l]) for l in planted])
            if time>=TIMING['full_emergence']:
                report['max_mesh_floor_penetration'] = max(report['max_mesh_floor_penetration'],floor-minimum)
            report['ground_bounds'].append({'frame':key,'seconds':time,'minimum_z':minimum,
                                            'sole_minima':measured,'pose':pose,
                                            'fore_pole_turn_degrees':pole_turns})
            for label in LIMBS:
                if label in planted and active_plants[label] is None:
                    active_plants[label] = key
                elif label not in planted and active_plants[label] is not None:
                    windows[label].append([active_plants[label],key-1])
                    active_plants[label] = None
            for bone in rig.pose.bones:
                for path in ('location','rotation_quaternion'):
                    bone.keyframe_insert(data_path=path,frame=key,group=bone.name)
        for label in LIMBS:
            if active_plants[label] is not None:
                windows[label].append([active_plants[label],PERIOD+1])
        report['contact_windows'] = windows
        for curve in _fcurves(action):
            for point in curve.keyframe_points:
                point.interpolation = 'LINEAR'
        action['export_name'] = 'Spawn'
        action['loop'] = False
        action['fps'] = FPS
        action['quadruped'] = True
        action['duration_seconds'] = PERIOD/FPS
        action['ground_occlusion_required'] = True
        action['intentional_ground_occlusion_until_seconds'] = TIMING['full_emergence']
        action['spawn_forefeet_planted_seconds'] = TIMING['fore_L_contact']
        action['spawn_hindfeet_planted_seconds'] = TIMING['hind_L_contact']
        action['rupture_seconds'] = TIMING['rupture']
        action['landing_seconds'] = TIMING['full_emergence']
        action['stomp_seconds'] = TIMING['stomp']
        action['description'] = 'Staggered grips, forceful articulated pull, rear landing, forepaw stomp and crest bellow'
        if report['max_supporting_sole_error']>height*.0015:
            report['warnings'].append('A supporting paw needs contact review')
        if report['max_mesh_floor_penetration']>height*.0001:
            report['warnings'].append('An emerged vertex crosses the floor')
        if report['max_global_floor_lift']>height*.025:
            report['warnings'].append('Global collision correction is too large')
    finally:
        rig.animation_data.action = previous
        if previous and previous_slot:
            rig.animation_data.action_slot = previous_slot
        scene.frame_start,scene.frame_end = frame_range
        scene.frame_set(frame,subframe=subframe)
        for bone in rig.pose.bones:
            bone.rotation_mode = previous_modes[bone.name]
            bone.matrix_basis = previous_pose[bone.name]
        _update()
    report['all_previous_actions_preserved'] = original_actions.issubset(bpy.data.actions.keys())
    report['max_supporting_sole_height_error'] = report['max_supporting_sole_error']
    report['max_floor_penetration_after_emergence'] = report['max_mesh_floor_penetration']
    report['passed_numeric'] = not report['warnings']
    return report

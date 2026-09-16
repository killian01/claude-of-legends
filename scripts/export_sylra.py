# Exports Sylra's rigged model, her staff and her eight clips from the Blender
# source to the GLB the game ships (public/models/champions/sylra.glb).
#
# The source file (art_src/models_raw/forest_witch_cleanup/
# forest_witch_animations_completes.blend, gitignored) is the witch as she was
# built: a Tripo generation regrouped into eight meshes, fitted with a Rigify
# rig (75 deform bones), her staff parented to the right hand, and one action
# per clip authored on the control bones. Every spell lives in its own scene
# there, on its own copy of the rig, beside preview lights, cameras and the
# effect geometry of the reference renders. None of that ships: this script
# assembles one export scene around the original rig, gives every name the
# game will read an English spelling, bakes the staff into every clip as a
# free node (so the death can drop it), pushes the clips onto NLA tracks and
# lets the glTF exporter sample the deform bones.
#
# The clips the GLB carries, as src/render/champions/manifest.ts names them:
#   Idle, Walk (in place), Attack, Cast_Q, Cast_W, Cast_E, Cast_R, Death.
#
# Usage (Blender 5.x, headless; the report lands beside the GLB):
#   blender --background <source.blend> --python scripts/export_sylra.py -- \
#     public/models/champions/sylra.glb
# Then `node scripts/shrink_models.mjs public/models/champions/sylra.glb`
# is a no-op safety net: the textures are already downscaled here.

import json
import os
import statistics
import sys

import bpy
from mathutils import Matrix, Vector

FPS = 24

# One row per shipped clip: the glTF animation name, the source action, the
# scene whose rig copy carries it (the transfer check samples it there), the
# frame range exported, and whether the clip loops.
CLIPS = [
    ('Idle', 'Sylra_Idle_Loop_96f', 'Idle - Breathing', 'IDLE_Sylra_RIG', (1, 97), True),
    ('Walk', 'Sylra_Walk_Staff_32f', 'Walk - Staff', 'WALK_Sylra_RIG', (1, 33), True),
    ('Attack', 'Sylra_Basic_Attack_37f', 'AA - Basic Attack', 'AA_Sylra_RIG', (1, 38), False),
    ('Cast_Q', 'Sylra_Q_Thorn_Bolt_48f', 'Q - Thorn Bolt', 'Q_Sylra_RIG', (1, 49), False),
    ('Cast_W', 'Sylra_W_Bramble_Field_48f', 'W - Bramble Field', 'Sylra_RIG', (1, 49), False),
    ('Cast_E', 'Sylra_E_Verdant_Shell_48f', 'E - Verdant Shell', 'E_Sylra_RIG', (1, 49), False),
    ('Cast_R', 'Sylra_R_Overgrowth_80f', 'R - Overgrowth', 'R_Sylra_RIG', (1, 81), False),
    ('Death', 'Sylra_Death_Soft_72f', 'Death - Collapse', 'DEATH_Sylra_RIG', (1, 73), False),
]

# The death scene animates its own copy of the staff, released from the hand
# on frame 18 and falling beside her; that object is the staff's source for
# the Death clip. Every other clip keeps the staff in the right hand.
DEATH_STAFF = 'DEATH_Staff_Sylra'

# Editable Blender source names to the stable names the GLB ships.
OBJECTS = {
    'Sylra_RIG': 'SylraRig',
    '01_Hat': 'Sylra_Hat',
    '02_Head_and_Hair': 'Sylra_Head',
    '03_Torso_and_Belt': 'Sylra_Torso',
    '04_Skirt_and_Panels': 'Sylra_Skirt',
    '05_Arm_Left': 'Sylra_ArmLeft',
    '06_Arm_Right': 'Sylra_ArmRight',
    '07_Leg_Left': 'Sylra_LegLeft',
    '08_Leg_Right': 'Sylra_LegRight',
}
STAFF_SOURCE = 'Staff_Sylra'
STAFF = 'Sylra_Staff'
MATERIALS = {'Material.001': 'Sylra_Body'}
IMAGES = {'forest_witch_3d_model_basecolor': 'sylra_body'}
# The robe bones fan out from the hips by compass direction; the hair locks
# hang either side of the face. Their control names stay French inside the
# source; only the deform bones reach the file.
BONE_WORDS = {
    'robe_avant_G': 'robe_front_L',
    'robe_avant_D': 'robe_front_R',
    'robe_arriere_G': 'robe_back_L',
    'robe_arriere_D': 'robe_back_R',
    'robe_cote_G': 'robe_side_L',
    'robe_cote_D': 'robe_side_R',
    'robe_avant': 'robe_front',
    'robe_arriere': 'robe_back',
    'meche': 'lock',
}
TEXTURE_MAX = 1024
# The walk was authored as a cane walk, 32 frames a cycle at 24 fps, with
# short steps (0.19 source units, on a 0.45 leg). In the match she stands
# 4.35 world units and moves 3.6 a second, and at her authored stride that
# is a mincing scramble, so the export lengthens the stride: the foot
# controls' forward travel is scaled 1.75x, their lift 1.25x, and the torso
# drops 3 cm so the straightened legs (Rigify IK, no stretch) still reach
# the ground at the extremes. The cycle then ships at 1.6x the authored
# pace: feet plant at her move speed, one cycle every 0.83 s.
WALK_STRIDE_SCALE = 1.75
WALK_LIFT_SCALE = 1.25
WALK_TORSO_DROP = 0.03
WALK_TIME_SCALE = 0.625
STAFF_TIP_LOCAL = Vector((0, 0, 0.96))


def log(*parts):
    print('[export_sylra]', *parts, flush=True)


def fcurves_of(action):
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def near_identity(m, tol=1e-5):
    return all(abs(m[i][j] - (1.0 if i == j else 0.0)) < tol for i in range(4) for j in range(4))


def head_world(rig, bone):
    return rig.matrix_world @ rig.pose.bones[bone].head


# Animation only writes back to the objects a script reads through the
# window's active scene; a frame set on any other scene evaluates into a
# copy the reads never see. Headless Blender still has that window.
def activate(scene):
    bpy.data.window_managers[0].windows[0].scene = scene
    assert bpy.context.scene == scene


# Frame plus subframe: Blender takes the fraction separately.
def set_time(scene, t):
    whole = int(t)
    scene.frame_set(whole, subframe=t - whole)


# Sampled joints for the transfer check: the source scene's rig copy plays
# the action directly; the export rig plays it through its NLA track. Both
# must agree, or a clip was pushed wrong.
CHECK_BONES = ['DEF-hand.R', 'DEF-hand.L', 'DEF-foot.L', 'DEF-foot.R', 'DEF-spine.006']


# What a clip's source rig carries outside its action: the rotation modes,
# the Rigify switches (IK_FK, pole_vector, head_follow...) and the pose of
# every control bone the action never keys. The export rig takes the same
# state before it plays the clip, and the action gains a key for each of
# them on its first frame so the exporter samples the clip the way its
# scene played it, whatever track ran before.
def capture_controls(source):
    return {pb.name: {
        'rotation_mode': pb.rotation_mode,
        'basis': pb.matrix_basis.copy(),
        'properties': {k: pb[k] for k in pb.keys()
                       if isinstance(pb[k], (int, float, bool)) and not k.startswith('_')},
    } for pb in source.pose.bones}


def scale_keys(fc, factor, about=0.0):
    for kp in fc.keyframe_points:
        for point in (kp.co, kp.handle_left, kp.handle_right):
            point[1] = about + (point[1] - about) * factor


def shift_keys(fc, delta):
    for kp in fc.keyframe_points:
        for point in (kp.co, kp.handle_left, kp.handle_right):
            point[1] += delta


def amplify_walk(action):
    """Longer steps on the walk's IK feet (forward Y about the rest, the lift
    about its floor), the torso lowered to keep the legs in reach."""
    for fc in fcurves_of(action):
        if fc.data_path in ('pose.bones["foot_ik.L"].location', 'pose.bones["foot_ik.R"].location'):
            if fc.array_index == 1:
                scale_keys(fc, WALK_STRIDE_SCALE)
            elif fc.array_index == 2:
                floor = min(kp.co[1] for kp in fc.keyframe_points)
                scale_keys(fc, WALK_LIFT_SCALE, about=floor)
        elif fc.data_path == 'pose.bones["torso"].location' and fc.array_index == 2:
            shift_keys(fc, -WALK_TORSO_DROP)


def conform(rig, source, action, start):
    keyed = {fc.data_path.split('"')[1] for fc in fcurves_of(action)
             if fc.data_path.startswith('pose.bones')}
    was = rig.animation_data.action
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
        src = source.get(pb.name)
        if src is None:
            continue
        pb.rotation_mode = src['rotation_mode']
        for key, value in src['properties'].items():
            pb[key] = value
            pb.keyframe_insert(data_path=f'["{key}"]', frame=start, group=pb.name)
        if pb.name not in keyed and not pb.bone.use_deform:
            pb.matrix_basis = src['basis'].copy()
            rotation = 'rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler'
            for path in ('location', rotation, 'scale'):
                pb.keyframe_insert(data_path=path, frame=start, group=pb.name)
    rig.animation_data.action = was


def sample_source(scene_name, rig_name, frames):
    scene = bpy.data.scenes[scene_name]
    rig = bpy.data.objects[rig_name]
    activate(scene)
    out = {}
    for f in frames:
        scene.frame_set(f)
        out[f] = {b: head_world(rig, b).copy() for b in CHECK_BONES}
    return out


def main(out_path):
    src = bpy.data.objects
    rig = src['Sylra_RIG']
    staff_ref = src[STAFF_SOURCE]
    parent = rig.parent
    assert parent is not None and near_identity(parent.matrix_world), 'the rig parent moved'
    assert near_identity(rig.matrix_world), 'the rig is not at the origin'
    assert staff_ref.parent == rig and staff_ref.parent_bone == 'DEF-hand.R'
    death_staff = src[DEATH_STAFF]
    assert death_staff.parent is None and death_staff.animation_data.action is not None

    # 1. Sample the source scenes before anything is rewired. The walk's
    # stride is lengthened first, on the action both rigs play, so the
    # transfer check compares the walk that ships.
    check_frames = {}
    sources = {}
    for clip, action_name, scene_name, rig_name, (start, end), _loop in CLIPS:
        frames = list(range(start, end + 1))
        rig_src = src[rig_name]
        if clip == 'Walk':
            amplify_walk(bpy.data.actions[action_name])
        assert near_identity(rig_src.matrix_world), f'{rig_name} moved'
        active = rig_src.animation_data.action
        assert active is not None and active.name == action_name, (
            f'{rig_name} plays {active.name if active else None}, expected {action_name}')
        check_frames[clip] = (frames, sample_source(scene_name, rig_name, frames))
        sources[clip] = capture_controls(rig_src)

    # 2. The export scene: the original rig, its eight meshes, the staff.
    scene = bpy.data.scenes.new('Sylra export')
    scene.render.fps = FPS
    scene.render.fps_base = 1
    activate(scene)
    body = [src[name] for name in OBJECTS if name != 'Sylra_RIG']
    for ob in [rig, *body, staff_ref, death_staff]:
        scene.collection.objects.link(ob)
    rig.animation_data.action = None
    for ob in body:
        assert ob.parent == rig and [m.type for m in ob.modifiers] == ['ARMATURE'], ob.name
        # The Tripo segment ids survive as a face attribute nobody reads.
        attr = ob.data.attributes.get('segment_origine')
        if attr is not None:
            ob.data.attributes.remove(attr)
    world = rig.matrix_world.copy()
    rig.parent = None
    rig.matrix_world = world

    # 3. English names on everything the file will carry.
    for old, new in OBJECTS.items():
        ob = src[old]
        ob.name = new
        if ob.data is not None:
            ob.data.name = new
    for old, new in MATERIALS.items():
        bpy.data.materials[old].name = new
    staff_ref.data.name = STAFF
    staff_mat = staff_ref.data.materials[0]
    staff_mat.name = 'Sylra_Staff'
    for old, new in IMAGES.items():
        bpy.data.images[old].name = new
    staff_image = next(
        n.image for n in staff_mat.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
    staff_image.name = 'sylra_staff'
    for image in (bpy.data.images['sylra_body'], staff_image):
        w, h = image.size
        if max(w, h) > TEXTURE_MAX:
            k = TEXTURE_MAX / max(w, h)
            image.scale(round(w * k), round(h * k))
    renamed_bones = 0
    for bone in rig.data.bones:
        if not bone.use_deform:
            continue
        name = bone.name
        for fr, en in BONE_WORDS.items():
            if fr in name:
                name = name.replace(fr, en)
                break
        if name != bone.name:
            bone.name = name
            renamed_bones += 1
    deform = [b.name for b in rig.data.bones if b.use_deform]
    assert not any(any(fr in b for fr in BONE_WORDS) for b in deform), deform
    for ob in body:
        groups = {g.name for g in ob.vertex_groups}
        assert groups <= set(deform), f'{ob.name} weights a bone the rig lost: {groups - set(deform)}'

    # 4. The rig's clips as NLA tracks, one strip each, nothing active.
    rig_tracks = {}
    for clip, action_name, _s, _r, (start, _end), _loop in CLIPS:
        action = bpy.data.actions[action_name]
        action.name = clip
        conform(rig, sources[clip], action, start)
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, start, action)
        strip.action_slot = action.slots[0]
        strip.frame_start = start
        if clip == 'Walk':
            strip.scale = WALK_TIME_SCALE
        rig_tracks[clip] = track
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)

    # 5. The staff as a free child of the rig, baked per clip from the
    # bone-parented reference (in hand) or the death scene's fall.
    staff = bpy.data.objects.new(STAFF, staff_ref.data)
    scene.collection.objects.link(staff)
    staff.parent = rig
    staff.matrix_parent_inverse = Matrix.Identity(4)
    staff.rotation_mode = 'QUATERNION'
    staff.animation_data_create()
    staff_tracks = {}
    measures = {}
    for clip, _a, _s, _r, (start, end), _loop in CLIPS:
        for other in rig_tracks.values():
            other.is_solo = False
        rig_tracks[clip].is_solo = True
        action = bpy.data.actions.new(f'{clip}_staff')
        slot = action.slots.new(id_type='OBJECT', name=STAFF)
        staff.animation_data.action = action
        staff.animation_data.action_slot = slot
        source = death_staff if clip == 'Death' else staff_ref
        feet = {'L': [], 'R': []}
        hand_gap = 0.0
        time_scale = WALK_TIME_SCALE if clip == 'Walk' else 1.0
        for f in range(start, end + 1):
            # The rig track is soloed: the scene frame is already the
            # strip's (scaled) frame, so the staff keys land on it.
            set_time(scene, start + (f - start) * time_scale)
            world = source.matrix_world.copy()
            staff.matrix_basis = rig.matrix_world.inverted() @ world
            for path in ('location', 'rotation_quaternion', 'scale'):
                staff.keyframe_insert(data_path=path, frame=start + (f - start) * time_scale)
            if clip != 'Death':
                hand_gap = max(hand_gap, (staff_ref.matrix_world.translation - world.translation).length)
            if clip == 'Walk':
                for side in feet:
                    feet[side].append(head_world(rig, f'DEF-foot.{side}').copy())
            if clip == 'Cast_Q' and f == 12:
                tip = world @ STAFF_TIP_LOCAL
                measures['q_release_staff_tip'] = {'forward': -tip.y, 'height': tip.z}
        for fc in fcurves_of(action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        staff.animation_data.action = None
        track = staff.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, start, action)
        strip.action_slot = slot
        strip.frame_start = start
        staff_tracks[clip] = track
        if clip == 'Walk':
            measures['walk_planted_speed'] = planted_speed(feet) / time_scale
            measures['walk_cycle_seconds'] = (end - start) * time_scale / FPS
    for track in rig_tracks.values():
        track.is_solo = False

    # 6. The transfer check: the NLA playback of the original rig must land
    # where the source scene's rig copy did.
    worst = 0.0
    gaps = {}
    for clip, (frames, expected) in check_frames.items():
        rig_tracks[clip].is_solo = True
        gap = 0.0
        start = rig_tracks[clip].strips[0].action_frame_start
        time_scale = rig_tracks[clip].strips[0].scale
        for f in frames:
            set_time(scene, start + (f - start) * time_scale)
            for bone, want in expected[f].items():
                got = head_world(rig, bone)
                gap = max(gap, (got - want).length)
        rig_tracks[clip].is_solo = False
        gaps[clip] = gap
        worst = max(worst, gap)
    log('transfer check, worst joint gap per clip', json.dumps(gaps))
    assert worst < 1e-3, gaps

    # 7. Silhouette numbers for the manifest, on the idle's first frame.
    rig_tracks['Idle'].is_solo = True
    scene.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    top = 0.0
    for ob in body:
        ev = ob.evaluated_get(dg)
        mesh = ev.to_mesh()
        top = max(top, max((ev.matrix_world @ v.co).z for v in mesh.vertices))
        ev.to_mesh_clear()
    staff_top = max((staff_ref.matrix_world @ v.co).z for v in staff_ref.data.vertices)
    # The staff's rest transform in the file is its idle grip, not wherever
    # the last baked frame left it: bounds are measured on the rest pose.
    staff.matrix_basis = rig.matrix_world.inverted() @ staff_ref.matrix_world
    rig_tracks['Idle'].is_solo = False
    measures['body_height'] = top
    measures['staff_top'] = staff_top
    measures['staff_to_hand_gap'] = hand_gap

    # 8. Only the export set reaches the file. The bone-parented reference
    # staff goes entirely: the exporter follows the rig's children whether
    # or not the scene holds them.
    scene.collection.objects.unlink(death_staff)
    bpy.data.objects.remove(staff_ref)
    for ob in [rig, *body, staff]:
        ob.hide_viewport = False
        ob.hide_render = False
        ob.hide_set(False, view_layer=scene.view_layers[0])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    activate(scene)
    scene.frame_set(1)
    if True:
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            use_active_scene=True,
            export_yup=True,
            export_apply=False,
            export_materials='EXPORT',
            export_image_format='JPEG',
            export_jpeg_quality=82,
            export_animations=True,
            export_animation_mode='NLA_TRACKS',
            export_merge_animation='NLA_TRACK',
            export_nla_strips=True,
            export_force_sampling=True,
            export_frame_step=1,
            export_anim_slide_to_zero=True,
            export_def_bones=True,
            export_skins=True,
            export_influence_nb=4,
            export_optimize_animation_size=False,
            export_optimize_animation_keep_anim_armature=True,
            export_optimize_animation_keep_anim_object=True,
            export_reset_pose_bones=True,
            export_rest_position_armature=True,
            export_morph=False,
            export_extras=False,
        )
    report = {
        'source': bpy.data.filepath,
        'output': os.path.abspath(out_path),
        'bytes': os.path.getsize(out_path),
        'blender': bpy.app.version_string,
        'clips': [
            {
                'name': clip,
                'frames': [start, end],
                'seconds': (end - start) * (WALK_TIME_SCALE if clip == 'Walk' else 1) / FPS,
                'loop': loop,
            }
            for clip, _a, _s, _r, (start, end), loop in CLIPS
        ],
        'deform_bones': len(deform),
        'renamed_bones': renamed_bones,
        'measures': measures,
        'transfer_joint_gaps': gaps,
    }
    report_path = os.path.splitext(out_path)[0] + '.export.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    log('wrote', out_path, report['bytes'], 'bytes; report', report_path)
    log(json.dumps(measures, indent=1))


# The walk plays on the spot: a planted sole slides backward at the speed
# the character would cover ground. Stance frames are the ones where a foot
# sits at its lowest; the median backward velocity over them is the planted
# speed, in Blender units per second (the witch faces -Y).
def planted_speed(feet):
    speeds = []
    for pts in feet.values():
        floor = min(p.z for p in pts) + 0.008
        for a, b in zip(pts, pts[1:]):
            if a.z <= floor and b.z <= floor and b.y > a.y:
                speeds.append((b.y - a.y) * FPS)
    return statistics.median(speeds) if speeds else 0.0


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(args[0] if args else 'public/models/champions/sylra.glb')

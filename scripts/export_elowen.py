# Exports Elowen's rigged model and her clips from the Blender source to the
# GLB the game ships (public/models/champions/elowen.glb).
#
# The source file (art_src/models_raw/elowen/elowen_v2_segmented.blend,
# gitignored) is the mist spirit as she was built: a Tripo generation in
# quads, rigged by Tripo (41 bones) and given cloth chains for the sleeves,
# the skirt and the hair (84 deform bones in all), segmented into seven
# meshes that already carry their shipped names, and one action per clip
# keyed on every frame of the one rig. The raw Tripo import sits in an
# excluded collection beside them and never reaches the file. This script
# assembles one export scene around the rig and the seven meshes, pushes
# each clip onto its own NLA track and lets the glTF exporter sample the
# deform bones.
#
# The clips the GLB carries, as src/render/champions/manifest.ts names them:
#   Levitate (the idle), Glide (the run, in place), Attack,
#   Cast_Q, Cast_W, Cast_E, Cast_R, Death.
#
# Usage (Blender 5.x, headless; the report lands beside the GLB):
#   blender --background <source.blend> --python scripts/export_elowen.py -- \
#     public/models/champions/elowen.glb [--only Levitate,Glide,Attack]
# Every clip's action must exist in the source; --only restricts the export
# to the named clips while the others are still being authored.

import json
import os
import sys

import bpy
from mathutils import Matrix

FPS = 24
RIG = 'ElowenRig'
MESHES = [
    'Elowen_Body',
    'Elowen_Hair',
    'Elowen_Halo',
    'Elowen_Skirt',
    'Elowen_Legs',
    'Elowen_SleeveLeft',
    'Elowen_SleeveRight',
]
HALO = 'Elowen_Halo'
RAW_COLLECTION = 'Tripo_raw'
IMAGE = 'Elowen_basecolor'
TEXTURE_MAX = 1024

# One row per shipped clip: the glTF animation name, the source action and
# whether the clip loops. The frame range is read from the action's keys,
# so a clip can change length in the source without touching this table.
CLIPS = [
    ('Levitate', 'Levitate', True),
    ('Glide', 'Glide', True),
    ('Attack', 'Attack', False),
    ('Cast_Q', 'Cast_Q', False),
    ('Cast_W', 'Cast_W', False),
    ('Cast_E', 'Cast_E', False),
    ('Cast_R', 'Cast_R', False),
    ('Death', 'Death', False),
]
# The open-hand attack releases at 0.55 s: the right hand's position on that
# frame is what the manifest's muzzle is derived from.
ATTACK_RELEASE_FRAME = 14
HAND_BONE = 'R_Hand'
ROOT_BONE = 'Root'


def log(*parts):
    print('[export_elowen]', *parts, flush=True)


# Blender 5.2 stores an action's curves under its layers' strips'
# channelbags; there is no action.fcurves any more.
def fcurves_of(action):
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def key_range(action):
    frames = [kp.co[0] for fc in fcurves_of(action) for kp in fc.keyframe_points]
    assert frames, f'{action.name} has no keys'
    return int(round(min(frames))), int(round(max(frames)))


def near_identity(m, tol=1e-5):
    return all(abs(m[i][j] - (1.0 if i == j else 0.0)) < tol for i in range(4) for j in range(4))


# Animation only writes back to the objects a script reads through the
# window's active scene; a frame set on any other scene evaluates into a
# copy the reads never see. Headless Blender still has that window.
def activate(scene):
    bpy.data.window_managers[0].windows[0].scene = scene
    assert bpy.context.scene == scene


def evaluated_top(objects):
    dg = bpy.context.evaluated_depsgraph_get()
    top = None
    for ob in objects:
        ev = ob.evaluated_get(dg)
        mesh = ev.to_mesh()
        z = max((ev.matrix_world @ v.co).z for v in mesh.vertices)
        ev.to_mesh_clear()
        top = z if top is None else max(top, z)
    return top


def parse_args(argv):
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    out_path = 'public/models/champions/elowen.glb'
    only = None
    i = 0
    while i < len(args):
        if args[i] == '--only':
            only = [name for name in args[i + 1].split(',') if name]
            i += 2
        else:
            out_path = args[i]
            i += 1
    return out_path, only


def main(out_path, only):
    src = bpy.data.objects
    rig = src[RIG]
    body = [src[name] for name in MESHES]

    # 1. The source as this script expects it.
    assert rig.parent is None and near_identity(rig.matrix_world), 'the rig is not at the origin'
    deform = [b.name for b in rig.data.bones if b.use_deform]
    assert len(deform) == len(rig.data.bones), 'the rig carries non-deform bones'
    for ob in body:
        mods = [(m.type, getattr(m, 'object', None)) for m in ob.modifiers]
        assert ob.parent == rig and mods == [('ARMATURE', rig)], f'{ob.name} is not skinned to the rig'
        assert near_identity(ob.matrix_world), f'{ob.name} moved'
        groups = {g.name for g in ob.vertex_groups}
        assert groups <= set(deform), f'{ob.name} weights a bone the rig lacks: {groups - set(deform)}'
    raw_collection = bpy.data.collections[RAW_COLLECTION]
    source_layer = bpy.context.scene.view_layers[0].layer_collection.children[RAW_COLLECTION]
    assert source_layer.exclude, f'{RAW_COLLECTION} is not excluded from the view layer'
    raw_objects = list(raw_collection.all_objects)
    assert raw_objects and not any(ob.name in MESHES for ob in raw_objects), raw_objects
    clips = CLIPS
    if only is not None:
        unknown = [name for name in only if name not in {clip for clip, _a, _l in CLIPS}]
        assert not unknown, f'--only names clips this script does not know: {unknown}'
        clips = [row for row in CLIPS if row[0] in only]
        log('exporting only', [clip for clip, _a, _l in clips])
    missing = [action for _clip, action, _loop in clips if action not in bpy.data.actions]
    assert not missing, f'actions missing from the source: {missing}'
    ranges = {clip: key_range(bpy.data.actions[action]) for clip, action, _loop in clips}
    for clip, (start, end) in ranges.items():
        assert end > start, f'{clip} spans a single frame'
        assert start == 1, f'{clip} starts on frame {start}, expected 1'

    # 2. The export scene: the rig and its seven meshes, nothing else. The
    # raw import is parented to the rig and the exporter follows the rig's
    # children whether or not the scene holds them, so it goes entirely.
    scene = bpy.data.scenes.new('Elowen export')
    scene.render.fps = FPS
    scene.render.fps_base = 1
    activate(scene)
    for ob in [rig, *body]:
        scene.collection.objects.link(ob)
    for ob in raw_objects:
        bpy.data.objects.remove(ob)
    rig.animation_data_create()
    rig.animation_data.action = None

    # 3. The rig's clips as NLA tracks, one strip each, nothing active.
    tracks = {}
    for clip, action_name, _loop in clips:
        action = bpy.data.actions[action_name]
        action.name = clip
        start, _end = ranges[clip]
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, start, action)
        strip.action_slot = action.slots[0]
        strip.frame_start = start
        tracks[clip] = track
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)

    # 4. The one texture, no larger than 1024.
    image = bpy.data.images[IMAGE]
    w, h = image.size
    if max(w, h) > TEXTURE_MAX:
        k = TEXTURE_MAX / max(w, h)
        image.scale(round(w * k), round(h * k))

    # 5. Silhouette numbers for the manifest: her height and the halo on
    # the idle's first frame, how far the idle lifts her root off its rest,
    # and where the attacking hand is when the strike releases.
    measures = {}
    halo = src[HALO]
    if 'Levitate' in tracks:
        tracks['Levitate'].is_solo = True
        scene.frame_set(ranges['Levitate'][0])
        measures['body_height'] = evaluated_top(body)
        measures['head_top'] = evaluated_top([ob for ob in body if ob != halo])
        measures['halo_top'] = evaluated_top([halo])
        root = rig.pose.bones[ROOT_BONE]
        rest = rig.data.bones[ROOT_BONE].head_local
        measures['hover_offset'] = (rig.matrix_world @ root.head).z - (rig.matrix_world @ rest).z
        tracks['Levitate'].is_solo = False
    if 'Attack' in tracks:
        assert ranges['Attack'][0] <= ATTACK_RELEASE_FRAME <= ranges['Attack'][1], ranges['Attack']
        tracks['Attack'].is_solo = True
        scene.frame_set(ATTACK_RELEASE_FRAME)
        hand = rig.matrix_world @ rig.pose.bones[HAND_BONE].tail
        measures['attack_release_hand'] = {'forward': -hand.y, 'height': hand.z, 'side': hand.x}
        tracks['Attack'].is_solo = False

    # 6. Everything in the export set visible, then the file.
    for ob in [rig, *body]:
        ob.hide_viewport = False
        ob.hide_render = False
        ob.hide_set(False, view_layer=scene.view_layers[0])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    activate(scene)
    scene.frame_set(1)
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

    # 7. The report beside the GLB.
    report = {
        'source': bpy.data.filepath,
        'output': os.path.abspath(out_path),
        'bytes': os.path.getsize(out_path),
        'blender': bpy.app.version_string,
        'partial': only is not None,
        'clips': [
            {
                'name': clip,
                'frames': list(ranges[clip]),
                'seconds': (ranges[clip][1] - ranges[clip][0]) / FPS,
                'loop': loop,
            }
            for clip, _action, loop in clips
        ],
        'deform_bones': len(deform),
        'measures': measures,
    }
    report_path = os.path.splitext(out_path)[0] + '.export.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    log('wrote', out_path, report['bytes'], 'bytes; report', report_path)
    log(json.dumps(measures, indent=1))


if __name__ == '__main__':
    main(*parse_args(sys.argv))

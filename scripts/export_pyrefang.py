# Exports the Pyrefang's rigged model and its seven Codex clips from the Codex
# blend to the GLB the game ships (public/models/creatures/pyrefang.glb).
#
# The source (art_src/models_raw/pyrefang/codex/pyrefang_codex.blend, built by
# scripts/build_pyrefang_codex.py) keeps one scene per clip, each with its own
# copy of the rig object over the one shared armature (PyrefangRig) and its own
# copy of the meshes and fire. The export takes the Idle scene's rig and
# meshes, pushes every Codex_* action onto an NLA track of that rig and lets
# the glTF exporter sample every bone (the Root carries the clips' travel).
#
# What does not ship:
# - the tail's B-bone segments: glTF skins plain bones, so the tail bends at its
#   eight joints only;
# - the fire's per-frame shape keys (world-space bakes, one per frame and per
#   clip): the crest, spine and tail flames ship in their rest shape, skinned to
#   the rig, and the client animates them with a flame shader;
# - the loose embers and the maw glow: the client throws its own embers;
# - the rise column: the client rebuilds it (src/render/vfx/pyrefang_rise_fx.ts)
#   from scripts/pyrefang_codex_rise_column.py, centred where the report says.
#
# Usage (Blender 5.x, headless; the report lands beside the GLB):
#   blender --background art_src/models_raw/pyrefang/codex/pyrefang_codex.blend \
#     --python scripts/export_pyrefang.py -- public/models/creatures/pyrefang.glb

import json
import os
import sys

import bpy

FPS = 24
# glTF animation name, source action. Every clip plays on the Idle rig.
CLIPS = [
    ('Idle', 'Codex_Idle'),
    ('Walk', 'Codex_Walk'),
    ('Attack', 'Codex_Attack'),
    ('Roar', 'Codex_Roar'),
    ('Rise', 'Codex_Rise'),
    ('Death', 'Codex_Death'),
    ('Emerge', 'Codex_Emerge'),
]
RIG = 'PyrefangRig'
BODY = ['Head', 'Jaw', 'Neck', 'Body', 'Tail',
        'L_UpperArm', 'L_Forearm', 'L_Hand', 'L_Thigh', 'L_Shin', 'L_Foot',
        'R_UpperArm', 'R_Forearm', 'R_Hand', 'R_Thigh', 'R_Shin', 'R_Foot']
FLAMES = ['Crest', 'Spine', 'Tail']
FLAME_IMAGE = 'pyre_flame'
# The attack's bite lands on this source second (validate_pyrefang_codex.py).
ATTACK_RELEASE_S = 0.55


def log(*parts):
    print('[export_pyrefang]', *parts, flush=True)


def activate(scene):
    bpy.data.window_managers[0].windows[0].scene = scene
    assert bpy.context.scene == scene


def flame_material():
    """A plain carrier for the flame texture: the client replaces it with
    its own additive flame shader, keyed by this name."""
    mat = bpy.data.materials.new('Pyrefang_Flame')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images[FLAME_IMAGE]
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    mat.surface_render_method = 'BLENDED'
    return mat


def body_material():
    """The body's texture as plain base color: the Codex material halves it
    and lights the lava from its red excess, which the client redoes."""
    mat = bpy.data.materials['Pyrefang_Body']
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    for link in list(bsdf.inputs['Base Color'].links):
        nt.links.remove(link)
    for name in ('Emission Color', 'Emission Strength'):
        for link in list(bsdf.inputs[name].links):
            nt.links.remove(link)
    bsdf.inputs['Emission Strength'].default_value = 0.0
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def bind_loose(ob, rig):
    """Give every vertex no bone moves (the plume past the tail tip, which
    the Codex drove with its per-frame shapes) wholly to the nearest bone
    among the object's groups, so it follows the skin."""
    bones = rig.data.bones
    groups = [g for g in ob.vertex_groups if g.name in bones]
    loose = [v for v in ob.data.vertices
             if sum(e.weight for e in v.groups if ob.vertex_groups[e.group].name in bones) < 1e-4]
    for v in loose:
        p = ob.matrix_world @ v.co

        def distance(group):
            b = bones[group.name]
            a, c = b.head_local, b.tail_local
            t = max(0.0, min(1.0, (p-a).dot(c-a)/max((c-a).length_squared, 1e-12)))
            return (p-(a+(c-a)*t)).length
        min(groups, key=distance).add([v.index], 1.0, 'REPLACE')
    return len(loose)


def bounds(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lo, hi = [1e9]*3, [-1e9]*3
    for ob in objects:
        ev = ob.evaluated_get(depsgraph)
        for v in ev.data.vertices:
            p = ev.matrix_world @ v.co
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
    return lo, hi


def main(out_path):
    objs = bpy.data.objects
    rig = objs[RIG]
    body = [objs[f'Pyrefang_{name}'] for name in BODY]
    flames = [objs[f'Pyrefang_FX_{name}'] for name in FLAMES]
    for ob in body + flames:
        assert ob.parent == rig and any(m.type == 'ARMATURE' and m.object == rig
                                        for m in ob.modifiers), ob.name
    origin = objs['Codex_Rise_Origin']
    rise_centre = [float(origin.location.x), float(origin.location.y)]

    scene = bpy.data.scenes.new('Pyrefang export')
    scene.render.fps = FPS
    scene.render.fps_base = 1
    activate(scene)
    for ob in [rig, *body, *flames]:
        scene.collection.objects.link(ob)

    # The fire in its rest shape, on one carrier material.
    flame = flame_material()
    for ob in flames:
        if ob.data.shape_keys:
            ob.shape_key_clear()
        ob.data.materials.clear()
        ob.data.materials.append(flame)
        bound = bind_loose(ob, rig)
        if bound:
            log(ob.name, 'bound', bound, 'loose vertices')
    body_material()

    # Rest measurements, on the Idle's first frame.
    rig.animation_data.action = bpy.data.actions['Codex_Idle']
    rig.animation_data.action_slot = bpy.data.actions['Codex_Idle'].slots[0]
    scene.frame_set(1)
    lo, hi = bounds(body)

    # One NLA track per clip, nothing left in the active slot.
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    durations = {}
    for clip, action_name in CLIPS:
        action = bpy.data.actions[action_name]
        start, end = action.frame_range
        track = rig.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, int(start), action)
        strip.action_slot = action.slots[0]
        strip.frame_end = end
        track.mute = False
        durations[clip] = round((end-start)/FPS, 4)
    scene.frame_start, scene.frame_end = 1, 241

    for ob in bpy.data.objects:
        ob.select_set(False)
    for ob in [rig, *body, *flames]:
        ob.select_set(True)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        use_active_scene=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_step=1,
        export_def_bones=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
        export_yup=True,
        export_image_format='AUTO',
    )
    report = {
        'glb': os.path.basename(out_path),
        'fps': FPS,
        'clips': durations,
        'attack_release_s': ATTACK_RELEASE_S,
        'rest_bounds_m': {'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi]},
        # Blender X/Y of the rise column's centre, the curled body's centroid
        # on the Emerge's first frame (glTF: x, -z).
        'rise_centre_m': [round(v, 4) for v in rise_centre],
        'bones': [b.name for b in rig.data.bones],
        'meshes': [ob.name for ob in body + flames],
        'size_bytes': os.path.getsize(out_path),
    }
    report_path = os.path.splitext(out_path)[0] + '.export.json'
    with open(report_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=2)
        fh.write('\n')
    log('wrote', out_path, report['size_bytes'], 'bytes;', durations)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    main(os.path.abspath(args[0] if args else 'public/models/creatures/pyrefang.glb'))

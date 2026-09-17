"""Export Elowen's spell effects from the Blender source, without the studio.

Five files land in public/models/effects/: the auto's wisp (core, spinning
mist, its bursting impact), the Q mist lance (core, spinning mist, sheath,
the impact's unfurling petals and its ground wave), the W veil (two domes,
the climbing wisps, the ground mist, the flecks), the E drifting step (the
flash of core, tufts and ring played at both ends, the streak laid between
them) and the R whiteout (the wall of wind, its twisting ribbons,
the eye's spiral, the central vortex, the ground mist, the snow).

The source scenes FX A, FX Q, FX W, FX E and FX R of elowen_v2_segmented.blend are
built by scripts/build_elowen_effects.py: every object carries an
`effectKind`, growing parts carry `poses` relative shape keys named
Pose_00.. (the Basis is the collapsed state) and turning parts a `spin` in
radians a second; materials carry `additive`. All of that ships as glTF
extras and elowen_fx.ts reads it. The preview cameras, lights and floor
(names starting with an underscore) and the preview keyframes never reach
the files. No source scene is modified.

Usage (Blender 5.x, headless):
  blender -b art_src/models_raw/elowen/elowen_v2_segmented.blend \
    --python scripts/export_elowen_effects.py
"""
import json
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'effects')
SCALE = 3.98
FILES = [
    ('FX A', 'elowen_attack_wisp.glb'),
    ('FX Q', 'elowen_mist_lance.glb'),
    ('FX W', 'elowen_veil.glb'),
    ('FX E', 'elowen_step.glb'),
    ('FX R', 'elowen_whiteout.glb'),
]
EXTRAS = ('effectKind', 'poses', 'spin')


def log(*parts):
    print('[elowen effects]', *parts, flush=True)


def activate(scene):
    bpy.data.window_managers[0].windows[0].scene = scene


def export_scene(source_name, filename):
    source = bpy.data.scenes[source_name]
    scene = bpy.data.scenes.new(source_name + ' export')
    scene.render.fps = source.render.fps
    nodes = []
    for old in source.objects:
        if old.name.startswith('_') or old.type != 'MESH' or 'effectKind' not in old:
            continue
        # The copy takes the source's clean name; the source is renamed in
        # memory only (nothing is saved).
        name = old.name
        old.name = name + '.src'
        obj = old.copy()
        obj.data = old.data.copy()
        obj.name = name
        obj.data.name = name
        obj.animation_data_clear()
        obj.rotation_euler = (0, 0, 0)
        obj.location = (0, 0, 0)
        obj.scale = (1, 1, 1)
        keys = obj.data.shape_keys
        if keys:
            keys.animation_data_clear()
            keys.use_relative = True
            blocks = list(keys.key_blocks)
            assert blocks[0].name == 'Basis', (old.name, blocks[0].name)
            for i, key in enumerate(blocks[1:]):
                assert key.name == f'Pose_{i:02d}', (old.name, key.name)
                key.value = 0
            assert obj['poses'] == len(blocks) - 1, (old.name, obj['poses'], len(blocks) - 1)
        for key in list(obj.keys()):
            if key not in EXTRAS:
                del obj[key]
        for mat in obj.data.materials:
            assert mat.name.startswith('Elowen_'), mat.name
        scene.collection.objects.link(obj)
        nodes.append({k: obj[k] for k in EXTRAS if k in obj})
        nodes[-1]['name'] = obj.name
        nodes[-1]['vertices'] = len(obj.data.vertices)
    assert nodes, source_name
    activate(scene)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_active_scene=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_morph=True,
        export_morph_normal=False,
        export_extras=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_skins=False,
    )
    log(filename, os.path.getsize(path), 'bytes,', len(nodes), 'nodes')
    return {'file': filename, 'bytes': os.path.getsize(path), 'nodes': nodes}


def main():
    report = {
        'source': bpy.data.filepath,
        'blender': bpy.app.version_string,
        'fps': 24,
        # The effects are authored around a 1 m champion; the runtime scales
        # them with her manifest height (CHARACTER_SCALE in elowen_fx.ts).
        'sourceScale': SCALE,
        'veilRadius': 3.5 / SCALE,
        'whiteoutRadius': 5.0 / SCALE,
        'lanceAxis': '+Z in Blender, +Y in the file',
        'materials': {m.name: {'additive': bool(m.get('additive', False))}
                      for m in bpy.data.materials if m.name.startswith('Elowen_') and m.get('additive') is not None},
        'files': [export_scene(scene, filename) for scene, filename in FILES],
    }
    with open(os.path.join(OUT, 'elowen_effects.export.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    log('report written')


if __name__ == '__main__':
    main()

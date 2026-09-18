"""Export Sylra's spell effects from the Blender source, without the studio.

Five files land in public/models/effects/: the basic-attack seed, the W
bramble field, the Q thorn bolt and its impact burst, the E verdant shell
(membrane, veins, shards, the burst thorn) and the R overgrowth (the
telegraph's ring, sap and seed; the sixteen giant roots, the torn roots,
the glowing cracks, the pollen and the spores of the eruption).

Run headless against forest_witch_animations_completes.blend. Absolute shape
keys become relative morph targets (Pose_00 the collapsed first key, then
one pose a source frame from `poseStart`); sylra_fx.ts interpolates the
same poses. Curves become meshes at their fullest frame; the runtime grows
them by scale and opacity, not by bevel. No source scene or saved Blender
file is modified by this export.
"""
import bpy
import json
import os
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'models', 'effects')


def source(english, legacy):
    return bpy.data.objects.get(english) or bpy.data.objects[legacy]


def activate(scene):
    bpy.data.window_managers[0].windows[0].scene = scene


def convert_morphs(obj, kind):
    keys = obj.data.shape_keys
    if not keys:
        return
    keys.animation_data_clear()
    keys.use_relative = True
    basis = keys.key_blocks[0]
    basis.name = 'Basis'
    for i, key in enumerate(list(keys.key_blocks)[1:]):
        key.relative_key = basis
        key.name = f'Pose_{i:02d}'
        key.value = 0
    obj['effectKind'] = kind


def export(scene, filename):
    activate(scene)
    for obj in scene.objects:
        if obj.data:obj.data.name = obj.name
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_active_scene=True,
        export_yup=True, export_animations=False, export_morph=True,
        export_morph_normal=False, export_extras=True, export_materials='EXPORT')
    print('[sylra effects]', filename, os.path.getsize(path), flush=True)


def bake_copy(old, name, kind, dg, center, **props):
    """A free copy of a source object at the current frame, moved so `center`
    lands on the origin; curves are converted to meshes at their evaluated
    bevel."""
    if old.type == 'CURVE':
        mesh = bpy.data.meshes.new_from_object(old.evaluated_get(dg), depsgraph=dg)
        obj = bpy.data.objects.new(name, mesh)
        obj.matrix_world = Matrix.Translation(-center) @ old.matrix_world
    else:
        obj = old.copy()
        obj.data = old.data.copy()
        obj.name = name
        obj.animation_data_clear()
        obj.parent = None
        obj.matrix_world = Matrix.Translation(-center) @ old.matrix_world
    obj['effectKind'] = kind
    for key, value in props.items():
        obj[key] = value
    obj.hide_viewport = False
    obj.hide_render = False
    return obj


def base_center(obj):
    """Where a burst mesh sits before it expands: every vertex of its first
    key shares one point."""
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return sum(pts, Vector()) / len(pts)


def link_all(scene, objects):
    for obj in objects:
        scene.collection.objects.link(obj)
        if obj.type == 'MESH':
            convert_morphs(obj, obj['effectKind'])


def export_thorn_bolt():
    """Q: the projectile thorn (authored along +Z, like the seed) and the
    impact burst, 19 poses from source frame 19."""
    q = bpy.data.scenes['Q - Thorn Bolt']
    activate(q)
    q.frame_set(15)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.data.scenes.new('Thorn bolt export')
    bolt = bpy.data.objects.new('Sylra_ThornBolt', bpy.data.objects['Q - Thorn Projectile'].data.copy())
    bolt.matrix_world = Matrix.Identity(4)
    bolt['effectKind'] = 'bolt'
    impact_src = bpy.data.objects['Q - Primary Impact']
    impact = bake_copy(impact_src, 'Sylra_ThornImpact', 'burst', dg, base_center(impact_src),
                       poseStart=19)
    link_all(scene, [bolt, impact])
    export(scene, 'sylra_thorn_bolt.glb')
    return {'boltLength': 0.32, 'impactPoseStart': 19, 'impactPoses': 19}


def export_verdant_shell():
    """E: the shell at full formation (frame 40) around the caster's origin,
    the shard burst (26 poses from source frame 72) and one burst thorn the
    runtime instances fourteen times."""
    e = bpy.data.scenes['E - Verdant Shell']
    activate(e)
    e.frame_set(40)
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.data.scenes.new('Verdant shell export')
    origin = Vector((0, 0, 0))
    objects = [
        bake_copy(bpy.data.objects['E - Translucent Shell'], 'Sylra_ShellMembrane', 'membrane', dg, origin),
        bake_copy(bpy.data.objects['E - Protective Veins'], 'Sylra_ShellVeins', 'veins', dg, origin),
        bake_copy(bpy.data.objects['E - Shield Leaves'], 'Sylra_ShellLeaves', 'veins', dg, origin),
        bake_copy(bpy.data.objects['E - Shield Shards'], 'Sylra_ShellShards', 'burst', dg, origin,
                  poseStart=72),
    ]
    thorn = bpy.data.objects.new('Sylra_ShellThorn', bpy.data.objects['E - Burst Thorn 01'].data.copy())
    thorn.matrix_world = Matrix.Identity(4)
    thorn['effectKind'] = 'thorn'
    objects.append(thorn)
    link_all(scene, objects)
    export(scene, 'sylra_verdant_shell.glb')
    return {'shellRadius': 0.48, 'shellHeight': 1.23, 'shardPoseStart': 72, 'shardPoses': 26,
            'thornStart': 0.35, 'thornEnd': 0.83, 'thornHeight': 0.57, 'thornCount': 14}


def export_overgrowth():
    """R: the telegraph (ring, converging sap, primal seed) and the eruption
    (sixteen giant roots in three beats, torn roots, glowing cracks, pollen,
    spores), everything centered on the zone."""
    r = bpy.data.scenes['R - Overgrowth']
    activate(r)
    r.frame_set(60)
    dg = bpy.context.evaluated_depsgraph_get()
    ring_src = bpy.data.objects['R - Warning Circle']
    ring_mesh = bpy.data.meshes.new_from_object(ring_src.evaluated_get(dg), depsgraph=dg)
    pts = [ring_src.matrix_world @ v.co for v in ring_mesh.vertices]
    bpy.data.meshes.remove(ring_mesh)
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), 0))
    center = (lo + hi) / 2
    radius = (hi.x - lo.x) / 2
    scene = bpy.data.scenes.new('Overgrowth export')
    # The sap has converged and thickened by frame 45; its bevel is gone by
    # the eruption's frame the rest is taken at.
    r.frame_set(45)
    sap_dg = bpy.context.evaluated_depsgraph_get()
    sap = bake_copy(bpy.data.objects['R - Converging Sap'], 'Sylra_OvergrowthSap', 'sap', sap_dg, center)
    r.frame_set(60)
    dg = bpy.context.evaluated_depsgraph_get()
    objects = [
        bake_copy(ring_src, 'Sylra_OvergrowthRing', 'ring', dg, center),
        sap,
        bake_copy(bpy.data.objects['R - Primal Seed'], 'Sylra_OvergrowthSeed', 'seed', dg, center),
        bake_copy(bpy.data.objects['R - Torn Roots'], 'Sylra_OvergrowthTornRoots', 'roots', dg, center),
        bake_copy(bpy.data.objects['R - Glowing Cracks'], 'Sylra_OvergrowthCracks', 'cracks', dg, center),
    ]
    pollen_src = bpy.data.objects['R - Pollen Burst']
    spores_src = bpy.data.objects['R - Falling Spores']
    objects.append(bake_copy(pollen_src, 'Sylra_OvergrowthPollen', 'burst', dg, center, poseStart=42))
    objects.append(bake_copy(spores_src, 'Sylra_OvergrowthSpores', 'burst', dg, center, poseStart=53))
    roots = []
    for i in range(1, 17):
        src = bpy.data.objects[f'R - Giant Root {i:02d}']
        roots.append(bake_copy(src, f'Sylra_GiantRoot_{i:02d}', 'root', dg, center, beat=(i - 1) % 3))
    link_all(scene, objects + roots)
    # The roots of one beat share every morph name: joined, the eruption is
    # three draws instead of sixteen.
    activate(scene)
    batches = [[o for o in roots if o['beat'] == beat] for beat in range(3)]
    for beat, batch in enumerate(batches):
        bpy.ops.object.select_all(action='DESELECT')
        for obj in batch:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = batch[0]
        bpy.ops.object.join()
        batch[0].name = f'Sylra_GiantRoots_{beat}'
    export(scene, 'sylra_overgrowth.glb')
    return {'overgrowthRadius': radius, 'rootPoses': 9, 'rootBeats': 3, 'pollenPoseStart': 42,
            'pollenPoses': 34, 'sporePoseStart': 53, 'sporePoses': 27}


def main():
    src = bpy.data.scenes.get('W - Bramble Field')
    activate(src)
    src.frame_set(36)
    dg = bpy.context.evaluated_depsgraph_get()
    ctrl = source('W_FieldCenter', 'W_FieldCenter')
    center = ctrl.matrix_world.translation.copy()
    collection = bpy.data.collections.get('W - Bramble Effects') or bpy.data.collections['W - Bramble Effects']
    scene = bpy.data.scenes.new('Bramble effect export')
    count = 0
    curve_names = {
        'W_RootBed': ('W_RootBed', 'roots'),
        'W_RootVeins': ('W_RootVeins', 'veins'),
        'W_OrganicBoundary': ('W_OrganicBoundary', 'boundary'),
        'W_SapRoots': ('W_SapRoots', 'veins'),
        'W_LeafSigils': ('W_LeafSigils', 'sigils'),
    }
    for old in list(collection.all_objects):
        name = old.name
        kind = None
        if name.startswith(('W_Ronce_', 'W_Bramble_')):
            kind = 'bramble'; new_name = f'W_Bramble_{count:02d}'; count += 1
        elif name.startswith(('W - Graine enchantee', 'W_EnchantedSeed_')):
            kind = 'seed'; new_name = 'W_EnchantedSeed_' + name[-2:]
        elif name in ['W_RisingPollen', 'W_RisingPollen']:
            kind = 'pollen'; new_name = 'W_RisingPollen'
        elif name in ['W_DriftingPetals', 'W_DriftingPetals']:
            kind = 'petals'; new_name = 'W_DriftingPetals'
        elif name in curve_names:
            new_name, kind = curve_names[name]
        elif name in [v[0] for v in curve_names.values()]:
            new_name = name; kind = next(v[1] for v in curve_names.values() if v[0] == name)
        if kind is None:
            continue
        if old.type == 'CURVE':
            mesh = bpy.data.meshes.new_from_object(old.evaluated_get(dg), depsgraph=dg)
            obj = bpy.data.objects.new(new_name, mesh)
        else:
            obj = old.copy(); obj.data = old.data.copy(); obj.name = new_name
        obj.animation_data_clear()
        obj.parent = None
        obj.matrix_world = Matrix.Translation(-center) @ old.matrix_world
        obj['effectKind'] = kind
        if kind == 'bramble':
            obj['growthStart'] = 12 + (count - 1) % 5
        scene.collection.objects.link(obj)
        convert_morphs(obj, kind)
        obj.hide_viewport = False; obj.hide_render = False
    assert count == 24, count
    # Merge stems sharing the same growth beat. Their matching morph names
    # survive the join, reducing the field from 120 stem draws to 25.
    activate(scene)
    batches = [[o for o in scene.objects if o.get('effectKind') == 'bramble' and o.get('growthStart') == 12+i] for i in range(5)]
    batches.append([o for o in scene.objects if o.get('effectKind') == 'seed'])
    for i, objects in enumerate(batches):
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        objects[0].name = f'W_BrambleGroup_{i}' if i < 5 else 'W_EnchantedSeeds'
    # Give the exported material labels stable English names.
    material_names = ['Bark', 'EmeraldLeaves', 'YoungLeaves', 'LuminousSap', 'ThornTips', 'SeedCore']
    for obj in scene.objects:
        for i, mat in enumerate(obj.data.materials):
            if mat.name.startswith('W - '):mat.name = 'Bramble_' + (material_names[i] if i < len(material_names) else str(i))
    export(scene, 'sylra_bramble.glb')
    # The seed's model faces local +Z in Blender, hence +Y in glTF.
    aa = bpy.data.scenes.get('AA - Basic Attack') or bpy.data.scenes['AA - Basic Attack']
    activate(aa); aa.frame_set(10)
    old = source('AA_SeedProjectile_1', 'AA_SeedProjectile_1')
    projectile_scene = bpy.data.scenes.new('Seed projectile export')
    obj = bpy.data.objects.new('Sylra_AttackSeed', old.data.copy())
    obj.matrix_world = Matrix.Identity(4); projectile_scene.collection.objects.link(obj)
    export(projectile_scene, 'sylra_attack_seed.glb')
    report = {'source': bpy.data.filepath, 'brambles': count, 'sourceRadius': .76,
              'fps': 24, 'growthFrames': 14, 'attackReleaseFrame': 9.4}
    report['thornBolt'] = export_thorn_bolt()
    report['verdantShell'] = export_verdant_shell()
    report['overgrowth'] = export_overgrowth()
    with open(os.path.join(OUT, 'sylra_effects.export.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)


if __name__ == '__main__':
    main()

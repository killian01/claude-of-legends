"""Export Voidmaul's seven game clips through an isolated duplicate rig.

The authored scene, meshes, actions and constraints are preserved. A temporary
scene receives copied rig/mesh datablocks, its IK and modifier targets are
retargeted to that rig, and one NLA track per canonical clip is sampled by the
glTF exporter. Packed atlas images/materials are read without changing them.

Run in Blender or import ``main(out_path, rig=None, meshes=None)``:
  blender --background voidmaul_animated.blend --python scripts/export_voidmaul.py
    -- public/models/creatures/voidmaul.glb
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix

FPS = 24
ATTACK_RELEASE_S = 1.75
WALK_SOURCE_SPEED = 0.11994158146948393
CLIPS = (
    ('Idle', 'Voidmaul_Idle_Loop_96f'),
    ('Walk', 'Voidmaul_Walk_Loop_32f'),
    ('Attack', 'Voidmaul_Attack'),
    ('Hurt', 'Voidmaul_Hurt_20f'),
    ('Death', 'Voidmaul_Death_77f'),
    ('Spawn', 'Voidmaul_Spawn_96f'),
    ('AttackCrush', 'Voidmaul_AttackCrush_77f'),
)
CHECK_POSES = (('Idle', 0.0), ('Walk', .5), ('Attack', 1.5), ('Attack', 1.75),
               ('Death', 3.2), ('Spawn', 0.0), ('Spawn', 2.0), ('Spawn', 4.0),
               ('AttackCrush', 1.166667), ('AttackCrush', 1.75),
               ('AttackCrush', 2.125), ('AttackCrush', 76/24))
CRUSH_CHECK_POSES = (('AttackCrush', 0.0), ('AttackCrush', 1.166667),
                     ('AttackCrush', 1.5), ('AttackCrush', 1.75),
                     ('AttackCrush', 1.875), ('AttackCrush', 2.125),
                     ('AttackCrush', 76/24))
BLENDER_TO_GLTF = Matrix(((1, 0, 0, 0), (0, 0, 1, 0),
                          (0, -1, 0, 0), (0, 0, 0, 1)))


def _activate(scene):
    window = bpy.context.window
    if window is None:
        windows = list(bpy.context.window_manager.windows)
        if not windows:
            raise RuntimeError('A Blender window context is required for scene export')
        window = windows[0]
    window.scene = scene
    if bpy.context.scene != scene:
        raise RuntimeError('Failed to activate the temporary export scene')


def _source_objects(rig=None, meshes=None):
    if rig is None:
        active = bpy.context.view_layer.objects.active
        if active and active.type == 'ARMATURE' and 'CTRL_Body' in active.pose.bones:
            rig = active
        else:
            candidates = [obj for obj in bpy.context.scene.objects
                          if obj.type == 'ARMATURE' and 'CTRL_Body' in obj.pose.bones]
            if len(candidates) != 1:
                raise ValueError('Pass the authored Voidmaul rig explicitly')
            rig = candidates[0]
    if rig.type != 'ARMATURE' or 'CTRL_Global' not in rig.pose.bones:
        raise ValueError('Expected the completed quadruped Voidmaul rig')
    if meshes is None:
        meshes = [obj for obj in bpy.context.scene.objects
                  if obj.type == 'MESH' and obj.get('anatomy_region')
                  and any(mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers)]
    meshes = list(meshes)
    if len(meshes) != 14:
        raise ValueError('Expected the 14 anatomical Voidmaul mesh segments')
    for mesh in meshes:
        if mesh.type != 'MESH' or mesh.data.attributes.get('SourceVertex') is None:
            raise ValueError('Invalid anatomical segment: ' + mesh.name)
        if not any(mod.type == 'ARMATURE' and mod.object == rig for mod in mesh.modifiers):
            raise ValueError('Segment is not skinned to the source rig: ' + mesh.name)
    return rig, meshes


def _set_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    rig.animation_data.action = action
    slots = list(getattr(action, 'slots', ()))
    if slots:
        rig.animation_data.action_slot = slots[0]


def _frame(scene, frame):
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame-integer)
    bpy.context.view_layer.update()


def _rows(matrix):
    return [[round(float(matrix[r][c]), 9) for c in range(4)] for r in range(4)]


def _bounds(meshes, rig):
    graph = bpy.context.evaluated_depsgraph_get()
    inverse = rig.matrix_world.inverted()
    lo, hi = [math.inf]*3, [-math.inf]*3
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        try:
            transform = inverse @ evaluated.matrix_world
            for vertex in geometry.vertices:
                point = transform @ vertex.co
                for axis in range(3):
                    lo[axis], hi[axis] = min(lo[axis], point[axis]), max(hi[axis], point[axis])
        finally:
            evaluated.to_mesh_clear()
    return {'min': [round(value, 9) for value in lo],
            'max': [round(value, 9) for value in hi]}


def _duplicate(scene, source_rig, source_meshes, owned_objects, owned_data):
    rig = source_rig.copy()
    rig.data = source_rig.data.copy()
    rig.name = 'Voidmaul_ExportRig'
    rig.data.name = 'Voidmaul_ExportArmature'
    rig.parent = None
    rig.matrix_world = source_rig.matrix_world.copy()
    rig.animation_data_clear()
    scene.collection.objects.link(rig)
    owned_objects.append(rig)
    owned_data.append(rig.data)
    rig.hide_viewport = False
    rig.hide_render = False
    rig.hide_set(False)
    rig.data.pose_position = 'POSE'
    for bone in rig.pose.bones:
        # Restore the neutral basis. The copied active source pose must not
        # leak into tracks that intentionally omit a fixed channel.
        bone.matrix_basis = Matrix.Identity(4)
        for constraint in bone.constraints:
            for prop in ('target', 'pole_target'):
                if hasattr(constraint, prop) and getattr(constraint, prop) == source_rig:
                    setattr(constraint, prop, rig)
    for constraint in rig.constraints:
        if hasattr(constraint, 'target') and constraint.target == source_rig:
            constraint.target = rig
    meshes = []
    for source in source_meshes:
        obj = source.copy()
        obj.data = source.data.copy()
        obj.animation_data_clear()
        scene.collection.objects.link(obj)
        owned_objects.append(obj)
        owned_data.append(obj.data)
        if source.parent == source_rig:
            obj.parent = rig
        obj.matrix_world = source.matrix_world.copy()
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        for modifier in obj.modifiers:
            if modifier.type == 'ARMATURE' and modifier.object == source_rig:
                modifier.object = rig
        for constraint in obj.constraints:
            if hasattr(constraint, 'target') and constraint.target == source_rig:
                constraint.target = rig
        meshes.append(obj)
    return rig, meshes


def _native_samples(scene, rig, actions, checks=CHECK_POSES):
    samples = []
    conversion = BLENDER_TO_GLTF
    inverse_conversion = conversion.inverted()
    deform = [bone.name for bone in rig.data.bones if bone.use_deform]
    for canonical, seconds in checks:
        action = actions[canonical]
        _set_action(rig, action)
        start, end = action.frame_range
        frame = min(float(end), float(start)+seconds*FPS)
        _frame(scene, frame)
        matrices, parent_relative, converted = {}, {}, {}
        for name in deform:
            bone = rig.pose.bones[name]
            matrix = bone.matrix.copy()
            local = bone.parent.matrix.inverted() @ matrix if bone.parent else matrix
            matrices[name] = _rows(matrix)
            parent_relative[name] = _rows(local)
            converted[name] = _rows(conversion @ matrix @ inverse_conversion)
        samples.append({'clip': canonical, 'seconds': seconds,
                        'source_frame': round(frame, 9),
                        'bone_matrices_armature': matrices,
                        'bone_matrices_parent_relative': parent_relative,
                        'bone_matrices_gltf_armature': converted})
    return samples


def _texture_report(meshes):
    images = {}
    for mesh in meshes:
        for material in mesh.data.materials:
            if not material or not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    image = node.image
                    images[image.name] = {'name': image.name, 'size': list(image.size),
                                          'packed': bool(image.packed_file),
                                          'colorspace': image.colorspace_settings.name}
    return list(images.values())


def main(out_path=None, rig=None, meshes=None, clip_actions=None):
    """Write GLB/report and remove every temporary export object/scene.

    ``clip_actions`` optionally maps canonical names to source action names or
    action datablocks, allowing safely suffixed action names after a rebuild.
    """
    source_rig, source_meshes = _source_objects(rig, meshes)
    mapping = dict(CLIPS)
    if clip_actions:
        mapping.update(clip_actions)
    actions = {}
    for canonical, reference in mapping.items():
        action = bpy.data.actions.get(reference) if isinstance(reference, str) else reference
        if action is None:
            raise ValueError('Missing ' + canonical + ' action: ' + str(reference))
        actions[canonical] = action
    if out_path is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out_path = os.path.join(root, 'public', 'models', 'creatures', 'voidmaul.glb')
    out_path = os.path.abspath(out_path)
    old_scene = bpy.context.scene
    old_frame, old_subframe = old_scene.frame_current, old_scene.frame_subframe
    old_active = bpy.context.view_layer.objects.active
    old_selection = list(bpy.context.selected_objects)
    old_mode = old_active.mode if old_active else 'OBJECT'
    owned_objects, owned_data = [], []
    export_scene = bpy.data.scenes.new('Voidmaul isolated GLB export')
    export_scene.render.fps = FPS
    export_scene.render.fps_base = 1
    try:
        # Object selection/export is performed only in the isolated scene.
        if bpy.context.object and bpy.context.object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        _activate(export_scene)
        duplicate_rig, duplicate_meshes = _duplicate(
            export_scene, source_rig, source_meshes, owned_objects, owned_data)
        bpy.context.view_layer.objects.active = duplicate_rig
        duplicate_rig.select_set(True)
        _set_action(duplicate_rig, actions['Idle'])
        _frame(export_scene, float(actions['Idle'].frame_range[0]))
        rest_bounds = _bounds(duplicate_meshes, duplicate_rig)
        samples = _native_samples(export_scene, duplicate_rig, actions)
        crush_samples = _native_samples(export_scene, duplicate_rig, actions, CRUSH_CHECK_POSES)
        duplicate_rig.animation_data.action = None
        durations = {}
        for canonical, _ in CLIPS:
            action = actions[canonical]
            start, end = action.frame_range
            track = duplicate_rig.animation_data.nla_tracks.new()
            track.name = canonical
            strip = track.strips.new(canonical, int(start), action)
            slots = list(getattr(action, 'slots', ()))
            if slots:
                strip.action_slot = slots[0]
            strip.frame_end = end
            strip.extrapolation = 'NOTHING'
            strip.blend_type = 'REPLACE'
            track.mute = False
            durations[canonical] = round((float(end)-float(start))/FPS, 9)
        export_scene.frame_start = 1
        export_scene.frame_end = int(math.ceil(max(action.frame_range[1]
                                                    for action in actions.values())))
        bpy.ops.object.select_all(action='DESELECT')
        for obj in [duplicate_rig, *duplicate_meshes]:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = duplicate_rig
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=out_path, export_format='GLB', use_selection=True,
            use_active_scene=True, export_animations=True,
            export_animation_mode='NLA_TRACKS', export_force_sampling=True,
            export_frame_step=1, export_def_bones=False,
            export_skins=True, export_morph=False, export_apply=False,
            export_yup=True, export_image_format='AUTO',
        )
        report = {
            'glb': os.path.basename(out_path), 'fps': FPS, 'clips': durations,
            'source_actions': {canonical: actions[canonical].name for canonical, _ in CLIPS},
            'looping_clips': ['Idle', 'Walk'], 'clamped_clips': ['Death'],
            'attack_release_s': ATTACK_RELEASE_S,
            'virtual_forward_speed': WALK_SOURCE_SPEED,
            'source_forward_blender': [0, -1, 0], 'source_forward_gltf': [0, 0, 1],
            'rest_bounds_m': rest_bounds, 'rig_object_matrix_world': _rows(source_rig.matrix_world),
            'deform_bones': [bone.name for bone in source_rig.data.bones if bone.use_deform],
            'bones': [bone.name for bone in source_rig.data.bones],
            'meshes': [mesh.name for mesh in source_meshes],
            'textures': _texture_report(source_meshes),
            'size_bytes': os.path.getsize(out_path),
            'spawn_ground_occlusion_until_s': float(actions['Spawn'].get(
                'intentional_ground_occlusion_until_seconds', 2.65)),
            'spawn_beats_s': {beat: float(actions['Spawn'].get(property_name, fallback))
                              for beat, property_name, fallback in (
                                  ('rupture', 'rupture_seconds', .45),
                                  ('landing', 'landing_seconds', 2.65),
                                  ('stomp', 'stomp_seconds', 2.30))},
            'native_skeletal_pose_samples': samples,
            'native_crush_pose_samples': crush_samples,
            'attack_crush_release_s': float(actions['AttackCrush'].get('impact_seconds', ATTACK_RELEASE_S)),
            'attack_crush_contact_gltf': list(actions['AttackCrush'].get('contact_centroid_gltf', ())),
            'attack_crush_half_spread_gltf': list(actions['AttackCrush'].get('contact_half_spread_gltf', ())),
            'native_samples_units': 'armature/model metres; glTF sample basis x,z,-y',
            'source_scene_preserved': True,
        }
        report_path = os.path.splitext(out_path)[0]+'.export.json'
        with open(report_path, 'w', encoding='utf8') as handle:
            json.dump(report, handle, indent=2)
            handle.write('\n')
        print('[export_voidmaul] wrote', out_path, report['size_bytes'], 'bytes;', durations,
              flush=True)
        return report
    finally:
        _activate(old_scene)
        for obj in owned_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.scenes.remove(export_scene)
        for data in owned_data:
            if data.users == 0:
                if isinstance(data, bpy.types.Armature):
                    bpy.data.armatures.remove(data)
                elif isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
        old_scene.frame_set(old_frame, subframe=old_subframe)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in old_selection:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if old_active and old_active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = old_active
        if old_mode != 'OBJECT' and old_active:
            try:
                bpy.ops.object.mode_set(mode=old_mode)
            except RuntimeError:
                pass
        bpy.context.view_layer.update()


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    main(args[0] if args else None)

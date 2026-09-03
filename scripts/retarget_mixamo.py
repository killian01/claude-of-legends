# Retargets one Mixamo animation (FBX, downloaded without skin) onto the
# Tripo v1.0 rig, using the preview mannequin as the skeleton reference,
# and exports a geometry-free GLB clip file shaped exactly like the ones
# Tripo's own retarget bakes: same node names, one animation named by the
# house clip id. Because every Tripo v1.0 biped shares these bone names,
# the output plays on ANY forged champion by name binding, no per-champion
# work and no credits.
#
# Method: pure world-space delta retarget, no addon. Both rigs rest in a
# T-pose; per frame, each mapped target bone takes the source bone's
# world rotation delta from rest, applied onto the target's rest
# orientation. Only the hip copies translation, scaled by the rigs'
# height ratio. Twist bones stay at rest (they smooth skinning, not
# motion).
#
# The source rig is first yawed so its rest faces world +X, the Tripo
# rig convention (the preset run clip travels along +X exactly, and the
# client aligns every model by that travel). Mixamo FBX rigs import
# facing -Y; without this alignment the copied hip travel and every
# lean axis land ~90 degrees off, which is how the first bake gave the
# run a crab gait. The facing is measured from the shoulder line, never
# assumed.
#
# Usage (Blender 4/5, headless):
#   blender --background --python scripts/retarget_mixamo.py -- \
#     <source.fbx> <clip_id> <out.glb> [--render <dir>] [--yaw <deg>] [--inplace]
# --render also writes 4 workbench frames to <dir> for a visual check.
# --yaw counter-rotates the whole animated character about world up, in
#   the sign convention of the curation scan: pass a clip's measured
#   facing offset verbatim and it comes out facing the rig's rest
#   forward. Many Mixamo clips are authored angled (the sword-and-shield
#   stance sits ~55 degrees off), and the game aligns every clip to the
#   rig's rest facing, so the offset must go at bake time.
# --inplace freezes the hip's horizontal travel at its first-frame value
#   (the vertical bob stays), for strike clips authored as lunges: in the
#   game an attack plays on a standing champion, so the travel is wrong
#   by construction.

import math
import sys

import bpy
from mathutils import Matrix, Vector

# Tripo bone -> Mixamo bone (without the mixamorig prefix), parents first.
BONE_MAP = [
    ('Hip', 'Hips'),
    ('Waist', 'Spine'),
    ('Spine01', 'Spine1'),
    ('Spine02', 'Spine2'),
    ('NeckTwist01', 'Neck'),
    ('Head', 'Head'),
    ('L_Clavicle', 'LeftShoulder'),
    ('L_Upperarm', 'LeftArm'),
    ('L_Forearm', 'LeftForeArm'),
    ('L_Hand', 'LeftHand'),
    ('R_Clavicle', 'RightShoulder'),
    ('R_Upperarm', 'RightArm'),
    ('R_Forearm', 'RightForeArm'),
    ('R_Hand', 'RightHand'),
    ('L_Thigh', 'LeftUpLeg'),
    ('L_Calf', 'LeftLeg'),
    ('L_Foot', 'LeftFoot'),
    ('L_ToeBase', 'LeftToeBase'),
    ('R_Thigh', 'RightUpLeg'),
    ('R_Calf', 'RightLeg'),
    ('R_Foot', 'RightFoot'),
    ('R_ToeBase', 'RightToeBase'),
]

MANNEQUIN = 'public/models/mannequin/mannequin.glb'


def fail(msg):
    print(f'retarget FAILED: {msg}')
    sys.exit(1)


def armatures():
    return [o for o in bpy.data.objects if o.type == 'ARMATURE']


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :]
    if len(argv) < 3:
        fail('usage: -- <source.fbx> <clip_id> <out.glb> [--render <dir>]')
    src_path, clip_id, out_path = argv[0], argv[1], argv[2]
    render_dir = argv[argv.index('--render') + 1] if '--render' in argv else None
    yaw_deg = float(argv[argv.index('--yaw') + 1]) if '--yaw' in argv else 0.0
    inplace = '--inplace' in argv

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30

    bpy.ops.import_scene.gltf(filepath=MANNEQUIN)
    targets = armatures()
    if len(targets) != 1:
        fail(f'expected one armature in the mannequin, found {len(targets)}')
    tgt = targets[0]

    bpy.ops.import_scene.fbx(filepath=src_path)
    sources = [o for o in armatures() if o is not tgt]
    if len(sources) != 1:
        fail(f'expected one armature in the FBX, found {len(sources)}')
    src = sources[0]
    if not src.animation_data or not src.animation_data.action:
        fail('the FBX carries no action')
    action = src.animation_data.action

    # Mixamo bones ride a namespace prefix ('mixamorig:Hips', sometimes
    # numbered); detect it from the hip.
    prefix = None
    for b in src.data.bones:
        if b.name.endswith('Hips'):
            prefix = b.name[: -len('Hips')]
            break
    if prefix is None:
        fail('no Hips bone in the FBX; not a Mixamo rig?')

    # Align the source rest facing onto world +X (the Tripo rig
    # convention) before anything reads a transform, so world deltas
    # transfer in the right frame. Facing is the shoulder line crossed
    # with up.
    def shoulder_facing(obj, lname, rname):
        for n in (lname, rname):
            if n not in obj.data.bones:
                fail(f'facing bone missing: {n}')
        lw = (obj.matrix_world @ obj.data.bones[lname].matrix_local).to_translation()
        rw = (obj.matrix_world @ obj.data.bones[rname].matrix_local).to_translation()
        f = (lw - rw).cross(Vector((0.0, 0.0, 1.0)))
        return math.atan2(f.y, f.x)

    src_facing = shoulder_facing(src, prefix + 'LeftArm', prefix + 'RightArm')
    print(f'  source rest facing: {math.degrees(src_facing):.1f} deg, aligning to +X')
    src.matrix_world = Matrix.Rotation(-src_facing, 4, 'Z') @ src.matrix_world

    pairs = []
    for tname, sname in BONE_MAP:
        if tname not in tgt.data.bones:
            fail(f'mannequin bone missing: {tname}')
        full = prefix + sname
        if full not in src.data.bones:
            print(f'  source bone missing, kept at rest: {full}')
            continue
        pairs.append((tname, full))

    # Rest world transforms, taken from the armature data (edit rest),
    # not the current pose.
    def rest_world(obj, name):
        return obj.matrix_world @ obj.data.bones[name].matrix_local

    src_rest = {s: rest_world(src, s) for _, s in pairs}
    tgt_rest = {t: rest_world(tgt, t) for t, _ in pairs}
    hip_t, hip_s = pairs[0]
    ratio = tgt_rest[hip_t].to_translation().z / max(1e-6, src_rest[hip_s].to_translation().z)
    if abs(tgt_rest[hip_t].to_translation().z) < 1e-6:
        # Some rigs stand on Y; use the dominant axis instead.
        ratio = tgt_rest[hip_t].to_translation().y / max(1e-6, src_rest[hip_s].to_translation().y)
    print(f'  hip height ratio: {ratio:.4f}')

    f0, f1 = (int(action.frame_range[0]), int(action.frame_range[1]))
    scene.frame_start, scene.frame_end = f0, f1
    view = bpy.context.view_layer
    tgt_inv = tgt.matrix_world.inverted()
    prev_quat = {}
    # The facing fix, about world up. The scan measures the offset with
    # yaw = atan2((face x fwd).z, face . fwd), so +yaw here undoes it.
    fix_q = Matrix.Rotation(math.radians(yaw_deg), 4, 'Z').to_quaternion()
    hip_delta0 = None

    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        for tname, sname in pairs:
            spb = src.pose.bones[sname]
            tpb = tgt.pose.bones[tname]
            s_world = src.matrix_world @ spb.matrix
            rot = (
                fix_q
                @ s_world.to_quaternion()
                @ src_rest[sname].to_quaternion().inverted()
                @ tgt_rest[tname].to_quaternion()
            )
            if tname == hip_t:
                delta = fix_q @ (s_world.to_translation() - src_rest[sname].to_translation())
                if hip_delta0 is None:
                    hip_delta0 = delta.copy()
                if inplace:
                    delta.x, delta.y = hip_delta0.x, hip_delta0.y
                loc = tgt_rest[tname].to_translation() + delta * ratio
            else:
                loc = (tgt.matrix_world @ tpb.matrix).to_translation()
            tpb.matrix = tgt_inv @ (Matrix.Translation(loc) @ rot.to_matrix().to_4x4())
            view.update()
            # Quaternion sign continuity, or interpolation jitters.
            q = tpb.rotation_quaternion.copy()
            p = prev_quat.get(tname)
            if p is not None and p.dot(q) < 0:
                q.negate()
                tpb.rotation_quaternion = q
            prev_quat[tname] = q.copy()
            tpb.keyframe_insert('rotation_quaternion', frame=f)
            if tname == hip_t:
                tpb.keyframe_insert('location', frame=f)
        if (f - f0) % 30 == 0:
            print(f'  frame {f}/{f1}')

    if render_dir is not None:
        import os

        os.makedirs(render_dir, exist_ok=True)
        # Frame the mannequin mesh by its world bounding box; a guessed
        # camera missed on the first try, a tracked one cannot.
        mesh = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
        if mesh is not None:
            corners = [mesh.matrix_world @ Matrix.Translation(c).to_translation() for c in mesh.bound_box]
            cx = sum(c.x for c in corners) / 8
            cy = sum(c.y for c in corners) / 8
            cz = sum(c.z for c in corners) / 8
            size = max(
                max(c.x for c in corners) - min(c.x for c in corners),
                max(c.z for c in corners) - min(c.z for c in corners),
                0.1,
            )
            aim = bpy.data.objects.new('aim', None)
            aim.location = (cx, cy, cz)
            scene.collection.objects.link(aim)
            # High three-quarter view from the rig's front (rest facing is
            # world +X), close to the game camera, so a wrongly oriented
            # clip is obvious in the check frames.
            cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
            cam.location = (cx + size * 2.2, cy - size * 1.1, cz + size * 1.7)
            scene.collection.objects.link(cam)
            track = cam.constraints.new('TRACK_TO')
            track.target = aim
            scene.camera = cam
            scene.render.engine = 'BLENDER_WORKBENCH'
            scene.render.resolution_x = 640
            scene.render.resolution_y = 640
            for i, f in enumerate([f0, (f0 + f1) // 2, f0 + (f1 - f0) * 3 // 4, f1]):
                scene.frame_set(f)
                scene.render.filepath = f'{render_dir}/frame_{i}_{f:03d}.png'
                bpy.ops.render.render(write_still=True)

    # Export the animation on the mannequin skeleton alone: the source rig
    # and the mannequin MESH both go, so the clip file stays small and
    # geometry-free, like a Tripo bake.
    bpy.data.actions.remove(action)
    for o in list(bpy.data.objects):
        if o is not tgt and o.type != 'ARMATURE':
            bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in armatures() if o is not tgt]:
        bpy.data.objects.remove(o, do_unlink=True)
    tgt.animation_data.action.name = clip_id
    bpy.ops.object.select_all(action='DESELECT')
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_animations=True,
        export_yup=True,
    )
    print(f'retarget done: {out_path} ({clip_id})')


main()

"""Editable, four-beat quadruped walk for the original Tripo Voidmaul rig.

Call ``build_walk(rig, meshes)`` from Blender after repairing the mesh.  The
function does not open, save, or export files.  All existing deform bones and
their rest matrices are preserved.  The misleading Tripo ``Left_Limb`` bones
are the long FORELEGS; ``Right_Limb`` bones are the short HINDLEGS.  Z is up
and the creature walks toward -Y.

The walk is in place, with 32 unique frames at 24 fps and a closing key on
frame 33.  For a travelling walk, move CTRL_Global toward -Y at the reported
``virtual_forward_speed``.  This cancels the backwards motion of each planted
foot.  Sole height is measured on the deformed mesh, rather than inferred from
the unusual knuckle-bone endpoints below the ground.
"""

import math

import bpy
from mathutils import Matrix, Quaternion, Vector


ACTION_NAME = "Voidmaul_Walk_Loop_32f"
GLOBAL = "CTRL_Global"
BODY = "CTRL_Body"
PELVIS = "CTRL_Pelvis"
PERIOD = 32
FPS = 24
STANCE = 0.75

# Contact order: hind left, fore left, hind right, fore right.  Left/right
# labels here denote model X only, independent of the source bone labels.
LIMBS = {
    "Hind_L": {
        "chain": ("tripo::0_Right_Limb_0", "tripo::0_Right_Limb_1",
                  "tripo::0_Right_Limb_2"),
        "sole": ("tripo::0_Right_Limb_2", "tripo::0_Right_Limb_3"),
        "phase": 0.0,
        "front": False,
    },
    "Fore_L": {
        "chain": ("tripo::0_Left_Limb_0", "tripo::0_Left_Limb_1",
                  "tripo::0_Left_Limb_2"),
        "sole": ("tripo::0_Left_Limb_2",),
        "phase": 0.25,
        "front": True,
    },
    "Hind_R": {
        "chain": ("tripo::1_Right_Limb_0", "tripo::1_Right_Limb_1",
                  "tripo::1_Right_Limb_2"),
        "sole": ("tripo::1_Right_Limb_2", "tripo::1_Right_Limb_3"),
        "phase": 0.5,
        "front": False,
    },
    "Fore_R": {
        "chain": ("bone_10", "tripo::1_Left_Limb_0",
                  "tripo::1_Left_Limb_1"),
        "sole": ("tripo::1_Left_Limb_1",),
        "phase": 0.75,
        "front": True,
    },
}


def _update():
    bpy.context.view_layer.update()


def _set_pose_matrix(bone, matrix):
    """Convert an armature-space pose into basis space using actual rest axes."""
    kwargs = {}
    if bone.parent:
        kwargs["parent_matrix"] = bone.parent.matrix
        kwargs["parent_matrix_local"] = bone.parent.bone.matrix_local
    bone.matrix_basis = bone.bone.convert_local_to_pose(
        matrix, bone.bone.matrix_local, invert=True, **kwargs)


def _matrix(position, rotation):
    return Matrix.LocRotScale(Vector(position), rotation, Vector((1, 1, 1)))


def _world_delta(bone, rotation):
    """Apply a rotation in model axes while inheriting the current parent pose."""
    inherited = bone.bone.matrix_local.copy()
    if bone.parent:
        inherited = (bone.parent.matrix @
                     bone.parent.bone.matrix_local.inverted() @ inherited)
    _set_pose_matrix(bone, _matrix(inherited.translation,
                                  rotation @ inherited.to_quaternion()))


def _fcurves(action):
    """Support both legacy and Blender 4.4+ layered/slotted actions."""
    found = []
    try:
        found.extend(action.fcurves)
    except AttributeError:
        pass
    for layer in getattr(action, "layers", ()):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", ()):
                found.extend(bag.fcurves)
    return list({curve.as_pointer(): curve for curve in found}.values())


def _make_shapes():
    collection = bpy.data.collections.get("Voidmaul_Control_Shapes")
    if collection is None:
        collection = bpy.data.collections.new("Voidmaul_Control_Shapes")
        bpy.context.scene.collection.children.link(collection)
    shapes = {}
    for name, kind in (("Ring", "ring"), ("Foot", "box"), ("Pole", "diamond")):
        object_name = "WGT_Voidmaul_" + name
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            if kind == "ring":
                verts = [(math.cos(i * math.tau / 32),
                          math.sin(i * math.tau / 32), 0) for i in range(32)]
                edges = [(i, (i + 1) % 32) for i in range(32)]
            elif kind == "box":
                verts = [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0),
                         (0, -1, 0), (0, -1.45, 0), (-0.25, -1.15, 0),
                         (0.25, -1.15, 0)]
                edges = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (5, 7)]
            else:
                verts = [(0, 0, 1), (-1, 0, 0), (0, 1, 0), (1, 0, 0),
                         (0, -1, 0), (0, 0, -1)]
                edges = [(0, i) for i in range(1, 5)] + [
                    (5, i) for i in range(1, 5)] + [(1, 2), (2, 3), (3, 4), (4, 1)]
            mesh = bpy.data.meshes.new(object_name)
            mesh.from_pydata(verts, edges, [])
            obj = bpy.data.objects.new(object_name, mesh)
            collection.objects.link(obj)
        obj.hide_render = True
        obj.hide_set(True)
        shapes[name] = obj
    return shapes


def _add_controls(rig, height, floor):
    original = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
    original_heads = {bone.name: bone.head_local.copy() for bone in rig.data.bones}
    original_tails = {bone.name: bone.tail_local.copy() for bone in rig.data.bones}
    source_root = rig.data.bones.get("tripo::Root")
    if source_root is None:
        raise ValueError("Expected the unchanged Tripo Voidmaul rig")
    if rig.data.bones.get(GLOBAL):
        raise ValueError("Voidmaul walk controls already exist; use a clean source rig")
    hips = sum((rig.data.bones[data["chain"][0]].head_local
                for data in LIMBS.values() if not data["front"]), Vector()) / 2
    shoulders = sum((rig.data.bones[data["chain"][0]].head_local
                     for data in LIMBS.values() if data["front"]), Vector()) / 2
    body_center = (hips + shoulders) / 2
    bpy.ops.object.mode_set(mode="OBJECT") if rig.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    edit = rig.data.edit_bones

    def make(name, position, parent=None, matrix=None):
        bone = edit.new(name)
        bone.head = position
        bone.tail = Vector(position) + Vector((0, 0, height * 0.07))
        if matrix is not None:
            bone.matrix = matrix
            bone.length = height * 0.08
        bone.use_deform = False
        bone.parent = parent
        bone.use_connect = False
        return bone

    global_bone = make(GLOBAL, (0, 0, floor))
    body_bone = make(BODY, body_center, global_bone)
    pelvis_bone = make(PELVIS, hips, body_bone)
    # Parent at the anatomical hip level instead of altering the deform root,
    # whose generated head is near the ground.  Rest matrices remain intact.
    for bone in list(edit):
        if bone.name in original and bone.parent is None:
            saved = bone.matrix.copy()
            bone.parent = pelvis_bone
            bone.use_connect = False
            bone.matrix = saved
    for label, data in LIMBS.items():
        upper, lower, terminal = [edit[name] for name in data["chain"]]
        make("CTRL_" + label + "_Foot", terminal.head, global_bone,
             terminal.matrix.copy())
        a, b, c = upper.head.copy(), lower.head.copy(), terminal.head.copy()
        line = c - a
        bend = b - a - line * ((b - a).dot(line) / line.length_squared)
        if bend.length < height * 0.00001:
            bend = Vector((0, -1, 0))
        pole = b + bend.normalized() * height * 0.28
        make("CTRL_" + label + "_Pole", pole, global_bone)
    bpy.ops.object.mode_set(mode="POSE")
    controls = rig.data.collections.get("Voidmaul Controls")
    if controls is None:
        controls = rig.data.collections.new("Voidmaul Controls")
    shapes = _make_shapes()
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        if bone.name.startswith("CTRL_"):
            controls.assign(bone.bone)
            shape = "Foot" if bone.name.endswith("_Foot") else (
                "Pole" if bone.name.endswith("_Pole") else "Ring")
            bone.custom_shape = shapes[shape]
            bone.use_custom_shape_bone_size = False
            # Source bones have arbitrary Tripo rolls.  Draw foot arrows and
            # global/body circles in the model's horizontal plane at rest.
            bone.custom_shape_rotation_euler = (
                bone.bone.matrix_local.to_quaternion().inverted().to_euler())
            size = height * (0.065 if shape == "Foot" else
                             0.035 if shape == "Pole" else
                             0.57 if bone.name == GLOBAL else 0.17)
            bone.custom_shape_scale_xyz = (size,) * 3
            bone.bone.color.palette = "THEME04" if "_L_" in bone.name else (
                "THEME03" if "_R_" in bone.name else "THEME09")
            bone.lock_scale = (True,) * 3
    rig.show_in_front = True
    _update()
    rest_error = max(max(abs(bone.matrix_local[r][c] - original[bone.name][r][c])
                         for r in range(4) for c in range(4))
                     for bone in rig.data.bones if bone.name in original)
    head_error = max((bone.head_local - original_heads[bone.name]).length
                     for bone in rig.data.bones if bone.name in original)
    tail_error = max((bone.tail_local - original_tails[bone.name]).length
                     for bone in rig.data.bones if bone.name in original)
    # Entering/leaving Edit mode normalizes Blender's imported rest rotations
    # slightly.  Compare actual joint displacements as well as matrix entries.
    if rest_error > 1e-5 or max(head_error, tail_error) > height * 1e-6:
        raise RuntimeError("Adding controls altered an existing skin-bind rest matrix")
    return rest_error, head_error, tail_error


def _sole_samples(rig, meshes, height):
    """Indices of originally low foot vertices, measured in armature space."""
    inverse = rig.matrix_world.inverted()
    all_points = []
    candidates = {label: [] for label in LIMBS}
    for mesh in meshes:
        transform = inverse @ mesh.matrix_world
        group_names = {group.index: group.name for group in mesh.vertex_groups}
        for vertex in mesh.data.vertices:
            point = transform @ vertex.co
            all_points.append(point)
            weights = {group_names[g.group]: g.weight for g in vertex.groups
                       if g.group in group_names}
            dominant = max(weights, key=weights.get) if weights else None
            for label, data in LIMBS.items():
                amount = sum(weights.get(name, 0) for name in data["sole"])
                if dominant in data["sole"] or amount >= 0.45:
                    candidates[label].append((mesh, vertex.index, point.z))
    if not all_points:
        raise ValueError("No skinned mesh vertices supplied")
    floor = min(point.z for point in all_points)
    result = {}
    for label, values in candidates.items():
        if not values:
            raise ValueError("No weighted sole vertices found for " + label)
        minimum = min(z for _, _, z in values)
        result[label] = [(mesh, index) for mesh, index, z in values
                         if z <= minimum + height * 0.014]
    return floor, result


def _measure_soles(rig, meshes, samples, capture=False):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    inverse = rig.matrix_world.inverted()
    wanted = {mesh: {} for mesh in meshes}
    for label, refs in samples.items():
        for mesh, index in refs:
            wanted[mesh].setdefault(index, []).append(label)
    minimum = {label: math.inf for label in samples}
    points = []
    entire_minimum = math.inf
    for mesh in meshes:
        evaluated = mesh.evaluated_get(depsgraph)
        geometry = evaluated.to_mesh()
        try:
            transform = inverse @ evaluated.matrix_world
            for vertex in geometry.vertices:
                position = transform @ vertex.co
                entire_minimum = min(entire_minimum, position.z)
                if capture:
                    points.append(tuple(position))
                for label in wanted[mesh].get(vertex.index, ()):
                    minimum[label] = min(minimum[label], position.z)
        finally:
            evaluated.to_mesh_clear()
    if any(not math.isfinite(value) for value in minimum.values()):
        raise RuntimeError("A modifier changed topology before sole measurement")
    return minimum, entire_minimum, points


def _install_ik(rig, height):
    report = {}
    for label, data in LIMBS.items():
        lower = rig.pose.bones[data["chain"][1]]
        terminal = rig.pose.bones[data["chain"][2]]
        ik = lower.constraints.new("IK")
        ik.name = "Voidmaul " + label + " ground IK"
        ik.target = rig
        ik.subtarget = "CTRL_" + label + "_Foot"
        ik.pole_target = rig
        ik.pole_subtarget = "CTRL_" + label + "_Pole"
        ik.chain_count = 2
        ik.use_tail = True
        ik.use_stretch = False
        ik.iterations = 128
        rotation = terminal.constraints.new("COPY_ROTATION")
        rotation.name = "Voidmaul " + label + " sole orientation"
        rotation.target = rig
        rotation.subtarget = ik.subtarget
        rotation.owner_space = "POSE"
        rotation.target_space = "POSE"
        rotation.mix_mode = "REPLACE"
        # Arbitrary Tripo roll angles prohibit a fixed +90/-90 pole angle.
        # Find the angle that reconstructs the existing knee/elbow instead.
        reference = lower.bone.head_local.copy()
        best_angle, best_error = 0.0, math.inf
        for index in range(72):
            angle = -math.pi + index * math.tau / 72
            ik.pole_angle = angle
            _update()
            error = (lower.head - reference).length
            if error < best_error:
                best_angle, best_error = angle, error
        step = math.tau / 72
        for _ in range(4):
            center = best_angle
            for index in range(-4, 5):
                angle = center + index * step / 4
                ik.pole_angle = angle
                _update()
                error = (lower.head - reference).length
                if error < best_error:
                    best_angle, best_error = angle, error
            step /= 4
        ik.pole_angle = best_angle
        _update()
        report[label] = {"pole_angle_degrees": math.degrees(best_angle),
                         "rest_joint_error": best_error,
                         "ik_chain": list(data["chain"][:2]),
                         "foot_bone": data["chain"][2]}
        if best_error > height * 0.004:
            report[label]["warning"] = "Rest joint IK fit exceeds 0.4% of height"
    return report


def _trajectory(phase, stride, lift):
    if phase <= STANCE:
        return -stride / 2 + stride * phase / STANCE, 0.0, 0.0
    u = (phase - STANCE) / (1 - STANCE)
    # Quintic easing keeps the same backwards treadmill velocity at contact
    # and lift-off, with zero vertical velocity at both ends of the swing.
    ease = u ** 3 * (10 - 15 * u + 6 * u * u)
    y = stride / 2 + stride * ((1 - STANCE) * u - ease) / STANCE
    arc = math.sin(math.pi * u) ** 2
    return y, lift * arc, arc


def _key(bone, frame):
    for path in ("location", "rotation_quaternion"):
        bone.keyframe_insert(data_path=path, frame=frame, group=bone.name)


def build_walk(rig, meshes):
    """Build controls and action, then return a JSON-serializable QA report."""
    if rig.type != "ARMATURE":
        raise TypeError("rig must be a Blender armature object")
    meshes = [mesh for mesh in meshes if mesh.type == "MESH"]
    required = {name for data in LIMBS.values() for name in data["chain"]}
    missing = required - set(rig.data.bones.keys())
    if missing:
        raise ValueError("Missing original Voidmaul bones: " + ", ".join(sorted(missing)))
    scene = bpy.context.scene
    rig.animation_data_create()
    previous_action = rig.animation_data.action
    rig.animation_data.action = None
    rig.data.pose_position = "POSE"
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    _update()
    inverse = rig.matrix_world.inverted()
    points = [inverse @ mesh.matrix_world @ vertex.co
              for mesh in meshes for vertex in mesh.data.vertices]
    if not points:
        raise ValueError("No mesh supplied to build_walk")
    height = max(point.z for point in points) - min(point.z for point in points)
    floor, samples = _sole_samples(rig, meshes, height)
    rest_error, head_error, tail_error = _add_controls(rig, height, floor)
    ik_report = _install_ik(rig, height)
    action = bpy.data.actions.new(ACTION_NAME)
    action.use_fake_user = True
    rig.animation_data.action = action
    stride = height * 0.12
    lift = height * 0.028
    clearance = height * 0.00035
    controls = {label: rig.pose.bones["CTRL_" + label + "_Foot"] for label in LIMBS}
    rest = {label: bone.bone.matrix_local.copy() for label, bone in controls.items()}
    body = rig.pose.bones[BODY]
    body_rest = body.bone.matrix_local.copy()
    contacts = []
    solver_errors = []
    mesh_floor_errors = []
    controller_corrections = []
    start_positions = None
    start_bones = None
    for frame in range(1, PERIOD + 2):
        scene.frame_set(frame)
        t = ((frame - 1) % PERIOD) / PERIOD
        angle = math.tau * t
        sway = math.sin(angle)
        bob = -height * 0.002 + height * 0.0025 * math.cos(2 * angle)
        position = body_rest.translation + Vector((height * 0.0045 * sway, 0, bob))
        lean = Quaternion((1, 0, 0), math.radians(0.7 + 0.45 * math.cos(2 * angle)))
        roll = Quaternion((0, 1, 0), math.radians(0.8 * sway))
        yaw = Quaternion((0, 0, 1), math.radians(0.35 * math.cos(angle)))
        _set_pose_matrix(body, _matrix(position, yaw @ roll @ lean @
                                      body_rest.to_quaternion()))
        _update()
        # Small counterrotation keeps the heavy asymmetrical crest stable.
        for name, amount in (("tripo::Spine_0", -0.3), ("tripo::Spine_1", -0.25)):
            if name in rig.pose.bones:
                _world_delta(rig.pose.bones[name], Quaternion(
                    (0, 1, 0), math.radians(amount * sway)))
                _update()
        expected = {}
        phases = {}
        for label, data in LIMBS.items():
            phase = (t - data["phase"]) % 1
            phases[label] = phase
            y, z, arc = _trajectory(phase, stride, lift)
            position = rest[label].translation + Vector((0, y, z))
            rotation = Quaternion((1, 0, 0), math.radians(
                (1.5 if data["front"] else 3.0) * arc))
            _set_pose_matrix(controls[label], _matrix(position,
                rotation @ rest[label].to_quaternion()))
            expected[label] = floor + clearance + z
        _update()
        total_correction = {label: 0.0 for label in LIMBS}
        # Correct actual deformed soles in model Z, all four simultaneously.
        # This also accounts for the original soft skin weights and sole pitch.
        for _ in range(5):
            measured, _, _ = _measure_soles(rig, meshes, samples)
            errors = {label: expected[label] - measured[label] for label in LIMBS}
            if max(abs(value) for value in errors.values()) < height * 0.00005:
                break
            for label, error in errors.items():
                pose = controls[label].matrix.copy()
                pose.translation.z += error
                total_correction[label] += error
                _set_pose_matrix(controls[label], pose)
            _update()
        measured, mesh_min, captured = _measure_soles(
            rig, meshes, samples, capture=frame in (1, PERIOD + 1))
        mesh_floor_errors.append(min(0.0, mesh_min - floor))
        controller_corrections.append(max(abs(v) for v in total_correction.values()))
        for label, data in LIMBS.items():
            error = abs(measured[label] - expected[label])
            solver_errors.append(error)
            if phases[label] <= STANCE:
                contacts.append({"frame": frame, "foot": label,
                                 "sole_z": measured[label],
                                 "floor_error": error})
            _key(controls[label], frame)
        _key(body, frame)
        for name in ("tripo::Spine_0", "tripo::Spine_1"):
            if name in rig.pose.bones:
                _key(rig.pose.bones[name], frame)
        if frame == 1:
            start_positions = captured
            start_bones = {bone.name: bone.matrix.copy() for bone in rig.pose.bones}
        elif frame == PERIOD + 1:
            mesh_seam = max((Vector(a) - Vector(b)).length
                            for a, b in zip(start_positions, captured))
            bone_seam = max(max(abs(bone.matrix[r][c] - start_bones[bone.name][r][c])
                                for r in range(4) for c in range(4))
                            for bone in rig.pose.bones)
    curves = _fcurves(action)
    if not curves:
        raise RuntimeError("The generated Blender action has no animation channels")
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
        cycle = curve.modifiers.new("CYCLES")
        cycle.mode_before = "REPEAT"
        cycle.mode_after = "REPEAT"
    scene.render.fps = FPS
    scene.render.fps_base = 1
    scene.frame_start = 1
    scene.frame_end = PERIOD
    action["loop_frames"] = PERIOD
    action["closing_keyframe"] = PERIOD + 1
    action["gait"] = "heavy quadruped lateral four-beat walk"
    action["heading"] = "-Y"
    action["stance_fraction"] = STANCE
    action["virtual_forward_speed"] = stride / (STANCE * PERIOD / FPS)
    rig["Voidmaul_Rig_Notes"] = (
        "Original Tripo skin bind preserved. Left_Limb = FORELEG; "
        "Right_Limb = HINDLEG. Body/hip controls do not deform directly. "
        "Foot targets and poles are children of CTRL_Global. "
        "32-frame quadruped loop at 24 fps; closing pose on 33.")
    report = {
        "action": action.name,
        "previous_action_preserved": previous_action.name if previous_action else None,
        "fps": FPS,
        "frames": [1, PERIOD],
        "closing_frame": PERIOD + 1,
        "heading": [0, -1, 0],
        "gait": "quadruped lateral four-beat",
        "stance_fraction": STANCE,
        "height": height,
        "stride": stride,
        "swing_lift": lift,
        "floor": floor,
        "sole_clearance": clearance,
        "virtual_forward_speed": action["virtual_forward_speed"],
        "original_rest_matrix_max_error": rest_error,
        "original_rest_head_max_displacement": head_error,
        "original_rest_tail_max_displacement": tail_error,
        "ik": ik_report,
        "sole_sample_counts": {label: len(refs) for label, refs in samples.items()},
        "max_sole_height_error": max(solver_errors),
        "max_stance_contact_error": max(row["floor_error"] for row in contacts),
        "max_floor_penetration": -min(mesh_floor_errors),
        "max_foot_controller_height_correction": max(controller_corrections),
        "loop_mesh_seam_max_distance": mesh_seam,
        "loop_bone_seam_max_matrix_error": bone_seam,
        "animation_channels": len(curves),
        "contact_measurements": contacts,
        "controls": [bone.name for bone in rig.pose.bones if bone.name.startswith("CTRL_")],
        "warnings": [],
    }
    if report["max_sole_height_error"] > height * 0.0005:
        report["warnings"].append("A sole height residual exceeds 0.05% of model height")
    if report["max_floor_penetration"] > height * 0.001:
        report["warnings"].append("Some mesh vertices penetrate the floor by over 0.1% of height")
    if mesh_seam > height * 0.0001 or bone_seam > 0.0001:
        report["warnings"].append("Loop seam needs review")
    scene.frame_set(1)
    _update()
    return report


def validate_walk_subframes(rig, meshes, step=0.25):
    """Read-only interpolation/contact QA on the existing generated action.

    Frame position is restored afterwards.  Horizontal sole drift is measured
    on a fixed patch of the actual skinned foot, after compensating for the
    travelling speed.  The controller's own drift is measured separately so
    soft skin-weight motion can be distinguished from trajectory errors.
    """
    if not 0 < step <= 1:
        raise ValueError("step must lie in (0, 1]")
    meshes = [mesh for mesh in meshes if mesh.type == "MESH"]
    scene = bpy.context.scene
    old_frame, old_subframe = scene.frame_current, scene.frame_subframe
    inverse = rig.matrix_world.inverted()
    points = [inverse @ mesh.matrix_world @ vertex.co
              for mesh in meshes for vertex in mesh.data.vertices]
    height = max(point.z for point in points) - min(point.z for point in points)
    floor, samples = _sole_samples(rig, meshes, height)
    clearance = height * 0.00035
    travel_per_frame = height * 0.12 / (STANCE * PERIOD)
    offsets = {}
    total = 0
    for mesh in meshes:
        offsets[mesh] = total
        total += len(mesh.data.vertices)
    patch_indices = {label: [offsets[mesh] + index for mesh, index in refs]
                     for label, refs in samples.items()}
    anchors = {}
    max_contact_error = 0.0
    max_penetration = 0.0
    max_target_drift = {label: 0.0 for label in LIMBS}
    max_skin_drift = {label: 0.0 for label in LIMBS}
    frame_of_worst_contact = None
    count = int(math.ceil(PERIOD / step))
    try:
        for index in range(count + 1):
            frame = min(1 + index * step, PERIOD + 1)
            integer = int(math.floor(frame))
            scene.frame_set(integer, subframe=frame - integer)
            _update()
            measured, mesh_min, positions = _measure_soles(
                rig, meshes, samples, capture=True)
            if len(positions) != total:
                raise RuntimeError("Subframe QA requires unchanged evaluated vertex indices")
            max_penetration = max(max_penetration, floor - mesh_min)
            t = (frame - 1) / PERIOD
            for label, data in LIMBS.items():
                raw_phase = t - data["phase"]
                cycle = math.floor(raw_phase)
                phase = raw_phase - cycle
                if phase > STANCE + 1e-9:
                    anchors.pop(label, None)
                    continue
                error = abs(measured[label] - floor - clearance)
                if error > max_contact_error:
                    max_contact_error = error
                    frame_of_worst_contact = frame
                centroid = sum((Vector(positions[i]) for i in patch_indices[label]),
                               Vector()) / len(patch_indices[label])
                target = rig.pose.bones["CTRL_" + label + "_Foot"].matrix.translation.copy()
                if label not in anchors or anchors[label][0] != cycle:
                    anchors[label] = (cycle, frame, centroid, target)
                _, beginning, first_centroid, first_target = anchors[label]
                compensation = Vector((0, -travel_per_frame * (frame - beginning), 0))
                skin_delta = centroid - first_centroid + compensation
                target_delta = target - first_target + compensation
                max_skin_drift[label] = max(max_skin_drift[label],
                                           math.hypot(skin_delta.x, skin_delta.y))
                max_target_drift[label] = max(max_target_drift[label],
                                             math.hypot(target_delta.x, target_delta.y))
    finally:
        scene.frame_set(old_frame, subframe=old_subframe)
        _update()
    return {
        "sample_step_frames": step,
        "sample_count": count + 1,
        "max_subframe_stance_contact_error": max_contact_error,
        "worst_contact_frame": frame_of_worst_contact,
        "max_subframe_mesh_floor_penetration": max_penetration,
        "max_stance_target_horizontal_drift": max_target_drift,
        "max_stance_skinned_sole_horizontal_drift": max_skin_drift,
        "max_stance_skinned_sole_drift_fraction_of_height": {
            label: drift / height for label, drift in max_skin_drift.items()},
        "virtual_forward_speed": travel_per_frame * FPS,
    }

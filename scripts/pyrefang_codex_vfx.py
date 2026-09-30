"""Original, baked Pyrefang fire and airborne embers for the Codex scenes.

Only the supplied FX mesh's Basis, UVs and bone weights are used. Imported
shape poses, keys, drivers and animation curves are discarded. Each scene owns
its FX meshes and materials. This module never opens or saves a source file.
"""

import math
import random

import bpy
import numpy as np
from mathutils import Vector

from pyrefang_codex_tail_motion import tail_direction


def _smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _coordinates(points):
    result = np.empty(len(points) * 3, dtype=np.float32)
    points.foreach_get('co', result)
    return result.reshape((-1, 3))


def _curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def _mark_action(id_data, name, duration, loop):
    action = id_data.animation_data.action
    action.name = name
    action['author'] = 'Codex'
    action['source'] = 'Original procedural motion from static FX geometry; no source curves'
    action['duration'] = duration
    action['loop'] = loop
    for curve in _curves(action):
        for key in curve.keyframe_points:
            key.interpolation = 'LINEAR'
    return action


def _isolate(ob, clip):
    """Copying the mesh also copies its Key datablock in Blender."""
    basis = _coordinates(ob.data.shape_keys.key_blocks[0].data
                         if ob.data.shape_keys else ob.data.vertices)
    ob.data = ob.data.copy()
    ob.data.name = f'CodexFX_{clip}_{ob.name}_Mesh'
    ob.animation_data_clear()
    if ob.data.shape_keys:
        ob.data.shape_keys.animation_data_clear()
        ob.shape_key_clear()
    ob.data.vertices.foreach_set('co', basis.ravel())
    ob.data.update()
    return basis


def _bone_name(ob, vertex, rig):
    groups = ob.data.vertices[vertex].groups
    if not groups:
        return 'Root'
    strongest = max(groups, key=lambda group: group.weight)
    name = ob.vertex_groups[strongest.group].name
    return name if name in rig.pose.bones else 'Root'


def _bake_shapes(ob, samples, times, fps, clip, duration, loop):
    """Absolute shape samples need one eval_time curve, not one curve per pose."""
    for index, sample in enumerate(samples):
        key = ob.shape_key_add(name='Basis' if index == 0 else f'Codex_{index:03d}')
        key.data.foreach_set('co', np.asarray(sample, dtype=np.float32).ravel())
        key.interpolation = 'KEY_LINEAR'
    keys = ob.data.shape_keys
    keys.name = f'CodexFX_{clip}_{ob.name}_Shapes'
    keys.use_relative = False
    for time, key in zip(times, keys.key_blocks):
        keys.eval_time = key.frame
        keys.keyframe_insert('eval_time', frame=1.0 + time * fps)
    _mark_action(keys, f'CodexFX_{clip}_{ob.name}_Motion', duration, loop)
    ob['codex_fx'] = True
    ob['codex_fx_samples'] = len(times)


def _fire_samples(ob, basis, times, matrices, clip, duration):
    # Supplied tongues have eight rings of three crossed cards (48 vertices).
    # Per-tongue phase and frequency create a continuously changing silhouette.
    ring_count, ring_size = 8, 6
    tongue_size = ring_count * ring_size
    if len(basis) % tongue_size:
        raise ValueError(f'Unexpected fire card topology: {ob.name}')
    rng = random.Random(47 + sum(ord(c) for c in ob.name.split('_')[:3][-1]))
    tongues = []
    count = len(basis) // tongue_size
    plume_start = (count - 4) * tongue_size if 'Tail' in ob.name else len(basis)
    object_inverse = np.array(ob.matrix_world.inverted(), dtype=np.float64)
    if plume_start < len(basis):
        # These four overlapping cards are baked directly in object space.
        # Leaving their old Tail08 weights would bend the already-curved plume
        # a second time through the B-Bone modifier and break its skin contact.
        plume_vertices = list(range(plume_start, len(basis)))
        for group in ob.vertex_groups:
            group.remove(plume_vertices)
    for index in range(count):
        start = index * tongue_size
        points = basis[start:start + tongue_size].reshape(ring_count, ring_size, 3)
        centers = points.mean(axis=1)
        plume = 'Tail' in ob.name and index >= count - 4
        if plume:
            # A single tapered continuation, with concentric flame layers,
            # replaces the four separately waving tips. Their existing UVs
            # still provide the orange outline and bright inner flame.
            tongues.append((start, points, centers, 0.14, 'Tail08', 0, 0, 0, True))
            continue
        height = max(0.015, float(np.linalg.norm(centers[-1] - centers[0])))
        tongues.append((start, points, centers, height,
                        _bone_name(ob, start, matrices.rig),
                        rng.random() * math.tau,
                        max(1, round(duration * rng.uniform(2.0, 3.7))),
                        max(2, round(duration * rng.uniform(4.0, 5.5))),
                        plume))
    samples = []
    for time in times:
        transformations = matrices(time)
        result = basis.copy()
        life = 1.0 - 0.84 * _smooth((time - 0.55) / 2.0) if clip == 'Death' else 1.0
        if clip == 'Emerge':
            life = _ignition(clip, time, 'Tail08')
        plume_curve = (_plume_curve(matrices, clip, time, duration, life)
                       if plume_start < len(basis) else None)
        for start, points, centers, height, bone, phase, cycles, fine, plume in tongues:
            if plume:
                layer = (start - plume_start) // tongue_size
                _write_plume(result, start, layer, plume_curve, life, object_inverse)
                continue
            life = _ignition(clip, time, bone) if clip == 'Emerge' else life
            transform = transformations[bone]
            rotation = np.array(transform.to_3x3(), dtype=np.float64)
            inverse = np.array(transform.inverted(), dtype=np.float64)
            root = np.array(transform @ Vector(centers[0]))
            wave = math.tau * cycles * time / duration + phase
            detail = math.tau * fine * time / duration + phase * 2.17
            for ring in range(ring_count):
                s = ring / (ring_count - 1)
                local_delta = centers[ring] - centers[0]
                rotated_delta = rotation @ local_delta
                # Buoyancy keeps small flames upright as the tail and neck bend.
                upright = 0.82
                center = root + life * ((1.0-upright) * rotated_delta + upright * local_delta)
                weight = s ** 1.7
                center += life * height * weight * np.array((
                    .20 * math.sin(wave - s*2.2) + .06 * math.sin(detail - s*3.1),
                    .16 * math.cos(wave*1.0 - s*1.7) + .045 * math.sin(detail - s*2.4),
                    .20 * math.sin(wave - s*1.4 + .8) + .055 * math.cos(detail - s*2.8)))
                width = life * (1.0 + .14 * weight * math.sin(wave - s*2.8 + 1.1))
                for corner in range(ring_size):
                    target = center + width * (rotation @ (points[ring, corner] - centers[ring]))
                    result[start + ring*ring_size + corner] = inverse[:3, :3] @ target + inverse[:3, 3]
        samples.append(result)
    return samples


# Emerge lights the fire from the head to the tail end as the body unfolds.
_IGNITION_DELAY = {'Head': 0.0, 'Jaw': 0.0, 'Neck02': .04, 'Neck01': .08, 'Chest': .12,
                   'Spine': .18, 'Hips': .24}


def _ignition(clip, time, bone):
    delay = _IGNITION_DELAY.get(bone)
    if delay is None:
        delay = .28 + .04*int(bone[4:]) if bone.startswith('Tail') else .20
    # Lit over the slow wake-up: the head first as it rises from the curl.
    return .06 + .94*_smooth((time - .9 - 2.5*delay) / .9)


def _plume_curve(matrices, clip, time, duration, life):
    """Integrate a shared centerline beyond the physical, evaluated skin tip."""
    root, actual_tangent = matrices.tail_frame(time)
    authored_tangent = Vector(tail_direction(clip, time, 1.0)).normalized()
    alignment = authored_tangent.rotation_difference(Vector(actual_tangent))
    length = .14 * life
    divisions = 28
    points = [root.copy()]
    tangents = []
    for index in range(divisions + 1):
        s = index / divisions
        tangent = np.array(alignment @ Vector(tail_direction(clip, time, 1.0 + .3*s)))
        tangent /= max(1e-8, np.linalg.norm(tangent))
        tangents.append(tangent)
        if index:
            average = tangents[-2] + tangent
            average /= max(1e-8, np.linalg.norm(average))
            points.append(points[-1] + average * length / divisions)
    points = np.asarray(points)
    tangents = np.asarray(tangents)
    # One small ripple travels across all layers together. Its vanishing root
    # value and derivative keep the skin junction continuous, never forked.
    cycles = max(1, round(duration * 1.4))
    wave = math.tau * cycles * time / duration
    if clip == 'Death':
        wave = math.tau * cycles * min(time, 2.7) / duration
    s = np.linspace(0.0, 1.0, divisions + 1)
    points += (.0016 * life * s[:, None]**2) * np.column_stack((
        np.sin(wave - 3.0*s), .3*np.sin(wave - 2.0*s),
        .6*np.cos(wave - 2.7*s)))
    return points, tangents


def _write_plume(result, start, layer, curve, life, inverse):
    points, tangents = curve
    # All layers terminate on the same curve. Only the longest layer reaches
    # its last point, avoiding either two silhouettes or a blunt square cap.
    end = (1.0, .965, .925, .875)[layer]
    width_scale = (1.0, .82, .64, .48)[layer]
    for ring in range(8):
        s = ring / 7
        coordinate = s * end * (len(points)-1)
        lo = min(len(points)-2, math.floor(coordinate))
        mix = coordinate - lo
        center = points[lo]*(1-mix) + points[lo+1]*mix
        tangent = tangents[lo]*(1-mix) + tangents[lo+1]*mix
        tangent /= max(1e-8, np.linalg.norm(tangent))
        normal = np.array((1.0, 0.0, 0.0))
        normal -= tangent * float(np.dot(normal, tangent))
        if np.linalg.norm(normal) < .01:
            normal = np.cross(tangent, (0.0, 0.0, 1.0))
        normal /= max(1e-8, np.linalg.norm(normal))
        binormal = np.cross(tangent, normal)
        radius = life * width_scale * (.0052 * (1-s)**.72 + .00025)
        for corner in range(6):
            # Three two-sided cards share the same center and taper.
            card, sign = divmod(corner, 2)
            angle = card * math.pi / 3
            offset = (normal*math.cos(angle) + binormal*math.sin(angle))
            target = center + radius * (1 if sign else -1) * offset
            result[start + ring*6 + corner] = inverse[:3, :3] @ target + inverse[:3, 3]


class _RigMatrices:
    def __init__(self, scene, rig, duration, fps, loop):
        self.scene, self.rig = scene, rig
        self.duration, self.fps, self.loop = duration, fps, loop
        self.rest_inverse = {bone.name: bone.matrix_local.inverted() for bone in rig.data.bones}
        self.cache = {}
        self.tail_cache = {}
        self.tail_object = next(ob for ob in scene.objects
                                if ob.type == 'MESH' and ob.name.startswith('Pyrefang_Tail'))
        points = _coordinates(self.tail_object.data.vertices)
        candidates = np.flatnonzero(points[:, 1] >= points[:, 1].max() - .001)
        _, unique = np.unique(points[candidates].round(7), axis=0, return_index=True)
        self.tip_vertices = candidates[unique]

    def __call__(self, time):
        # Sample only our independently authored rig action. Past particle births
        # use the previous cycle for loops and the initial pose for one-shots.
        time = time % self.duration if self.loop else max(0.0, min(self.duration, time))
        time = round(time, 9)
        if time not in self.cache:
            frame = 1.0 + time * self.fps
            self.scene.frame_set(math.floor(frame), subframe=frame % 1.0)
            bpy.context.view_layer.update()
            self.cache[time] = {bone.name: self.rig.matrix_world @ bone.matrix @ self.rest_inverse[bone.name]
                               for bone in self.rig.pose.bones}
            evaluated = self.tail_object.evaluated_get(bpy.context.evaluated_depsgraph_get())
            tip = sum((evaluated.matrix_world @ evaluated.data.vertices[int(index)].co
                       for index in self.tip_vertices), Vector()) / len(self.tip_vertices)
            bone = self.rig.pose.bones['Tail08']
            tangent = self.rig.matrix_world.to_3x3() @ (bone.tail - bone.head)
            self.tail_cache[time] = (np.array(tip), np.array(tangent.normalized()))
        return self.cache[time]

    def tail_frame(self, time):
        self(time)
        time = time % self.duration if self.loop else max(0.0, min(self.duration, time))
        return self.tail_cache[round(time, 9)]


def _ember_samples(ob, basis, times, matrices, clip, duration):
    if len(basis) % 8:
        raise ValueError(f'Unexpected ember card topology: {ob.name}')
    rng = random.Random(103)
    particles = []
    for index in range(len(basis) // 8):
        vertices = basis[index*8:index*8+8]
        center = vertices.mean(axis=0)
        cycles = max(1, round(duration * rng.uniform(.7, 1.35)))
        lifetime = duration / cycles
        particles.append((center, vertices-center,
                          _bone_name(ob, index*8, matrices.rig), lifetime,
                          rng.random(), rng.uniform(.10, .19),
                          rng.uniform(-.035, .035), rng.uniform(.006, .042),
                          rng.random()*math.tau, rng.uniform(.30, .80)))
    samples = []
    for time in times:
        result = np.empty_like(basis)
        for index, (seed, offsets, bone, lifetime, phase, rise, dx, dy, spin, size) in enumerate(particles):
            age = ((time / lifetime + phase) % 1.0) * lifetime
            # Force mathematically identical endpoint samples despite float mod.
            if abs(time-duration) < 1e-7 and matrices.loop:
                age = phase*lifetime
            birth = time - age
            origin = np.array(matrices(birth)[bone] @ Vector(seed))
            age01 = age/lifetime
            center = origin + np.array((dx*age + .007*age*math.sin(spin+age*4),
                                        dy*age + .006*age*math.cos(spin+age*3),
                                        rise*age + .025*age*age))
            envelope = _smooth(age01 / .12) * (1.0-_smooth((age01-.65)/.35))
            envelope *= size * (.88+.12*math.sin(spin+age*16))
            if clip == 'Emerge':
                # Embers gather and burst with the unfolding body.
                envelope *= .25 + .75*_smooth((time-1.0)/1.0)
            if clip == 'Death':
                envelope *= 1.0-_smooth((time-.8)/1.8)
                if birth > 1.0:
                    envelope = 0.0
            # Crossed cards stay world-aligned after emission; no skeleton drag.
            result[index*8:index*8+8] = center + offsets*envelope
        samples.append(result)
    ob.parent = None
    ob.matrix_world.identity()
    for modifier in list(ob.modifiers):
        if modifier.type == 'ARMATURE':
            ob.modifiers.remove(modifier)
    return samples


def _materials(objects, clip, times, fps, duration, loop):
    copies = {}
    for ob in objects:
        for index, original in enumerate(ob.data.materials):
            if original not in copies:
                material = original.copy()
                material.name = f'CodexFX_{clip}_{original.name}'
                material.animation_data_clear()
                if material.node_tree:
                    material.node_tree.animation_data_clear()
                    for node in material.node_tree.nodes:
                        if node.type != 'BSDF_PRINCIPLED':
                            continue
                        socket = node.inputs.get('Emission Strength')
                        if socket is None or socket.is_linked:
                            continue
                        initial = socket.default_value
                        for time in times:
                            phase = math.tau * max(1, round(duration * 2.0)) * time / duration
                            strength = .97 + .055*math.sin(phase) + .025*math.sin(phase*2+.7)
                            if clip == 'Death':
                                strength *= 1.0-.82*_smooth((time-.6)/2.0)
                            if clip == 'Emerge':
                                strength *= .20+.80*_smooth((time-.8)/1.6)
                            socket.default_value = initial*strength
                            socket.keyframe_insert('default_value', frame=1.0+time*fps)
                    if material.node_tree.animation_data and material.node_tree.animation_data.action:
                        _mark_action(material.node_tree, f'CodexFX_{clip}_{original.name}_Radiance', duration, loop)
                copies[original] = material
            ob.data.materials[index] = copies[original]
    return len(copies)


def animate_effects(scene, rig, clip, duration, fps=24):
    """Bake scene-local fire and embers after the six rig scenes are cloned.

    Call once for each scene, passing its own rig with its Codex action assigned.
    Render the actual clip scene (not another scene with only its action swapped).
    Returns JSON-compatible QA metadata; no files are opened or saved here.
    """
    previous_scene = bpy.context.window.scene
    previous_frame, previous_subframe = scene.frame_current, scene.frame_subframe
    bpy.context.window.scene = scene
    loop = clip in ('Idle', 'Walk')
    times = sorted({i/fps for i in range(math.floor(duration*fps)+1)} | {duration})
    objects = [ob for ob in scene.objects if ob.type == 'MESH' and ob.name.startswith('Pyrefang_FX_')]
    matrices = _RigMatrices(scene, rig, duration, fps, loop)
    report = {'samples': len(times), 'fps': fps, 'source_curves_used': False,
              'airborne_embers': True, 'objects': {}, 'loop': loop,
              'tail_plume': {'centerline': 'Shared continuation of authored tail direction',
                             'length_m': .14, 'concentric_layers': 4,
                             'attachment': 'Centroid of evaluated skin-tip vertices',
                             'max_turbulence_m': .0016}}
    try:
        for ob in objects:
            basis = _isolate(ob, clip)
            if 'Embers' in ob.name:
                samples = _ember_samples(ob, basis, times, matrices, clip, duration)
            elif any(part in ob.name for part in ('Crest', 'Spine', 'Tail')):
                samples = _fire_samples(ob, basis, times, matrices, clip, duration)
            else:
                continue
            _bake_shapes(ob, samples, times, fps, clip, duration, loop)
            endpoint_error = float(np.max(np.abs(samples[0]-samples[-1])))
            report['objects'][ob.name] = {'vertices': len(basis), 'endpoint_error': endpoint_error,
                                        'max_motion_m': float(np.max(np.abs(samples[0]-samples[len(samples)//2])))}
            if loop and endpoint_error > 1e-5:
                raise AssertionError(f'{ob.name}: nonseamless FX loop ({endpoint_error})')
        report['materials'] = _materials(objects, clip, times, fps, duration, loop)
    finally:
        scene.frame_set(previous_frame, subframe=previous_subframe)
        bpy.context.window.scene = previous_scene
    return report

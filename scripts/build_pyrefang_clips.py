"""The Pyrefang's clips, generated procedurally on PyrefangRig in
art_src/models_raw/pyrefang/pyrefang_segmented.blend: no hand keys, every
clip is a set of tracks (sine waves for the loops, smoothstep beats for
the gestures) baked to one key per frame at 24 fps, quaternion-free (XYZ
Euler, every bone's local X being the world X, so an X angle is a pitch).

  Idle    6 s loop   prowling on the spot: breath, a slow look around, the tail alive
  Walk    1.2 s loop diagonal trot in place (the manifest's runSpeed plants the feet)
  Attack  1.4 s      the bite: coil, lunge, jaws snap at 0.55 s, recover
  Roar    1.5 s      rears the head, jaws wide, the tail up (the reset, the first contact)
  Rise    2.5 s      from a crouch on the ring to its feet, a head shake, a roar
  Death   3.0 s      struck, a stagger, the legs buckle, over on its flank, a last breath

Signs (see docs/pyrefang-model.md): the creature faces -Y. On the spine,
the neck and the head negative X raises the tip; on the tail positive X
raises it; on a leg negative X swings it forward, positive back; Z is yaw.

Run inside Blender with the source file open:
  import build_pyrefang_clips as c; c.build_all()
or headless:
  blender -b art_src/models_raw/pyrefang/pyrefang_segmented.blend \
    --python scripts/build_pyrefang_clips.py -- --save [--preview]
"""
import math
import os
import subprocess
import sys

import bpy
from mathutils import Euler, Vector

FPS = 24
RIG = 'PyrefangRig'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW_DIR = os.path.join(ROOT, 'art_src', 'models_raw', 'pyrefang')
FRAMES_DIR = os.path.join(ROOT, '.tmp', 'pyrefang-clips')
TAIL = [f'Tail{i:02d}' for i in range(1, 9)]
TAU = math.tau


# ------------------------------------------------------------ tracks
def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def track(t, points):
    """Piecewise smoothstep through (time, value) points, held outside."""
    if t <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0)) if t1 > t0 else v1
    return points[-1][1]


def sine(t, period, amp, phase=0.0):
    return amp * math.sin(TAU * t / period + phase)


class Pose:
    """Rotations in degrees per bone and a world offset for the root."""

    def __init__(self):
        self.rot = {}
        self.root = Vector((0, 0, 0))

    def add(self, bone, x=0.0, y=0.0, z=0.0):
        r = self.rot.setdefault(bone, [0.0, 0.0, 0.0])
        r[0] += x
        r[1] += y
        r[2] += z

    def side(self, side, bone, x=0.0, y=0.0, z=0.0):
        self.add(f'{side}_{bone}', x, y, z)


# ------------------------------------------------------------ layers
def breath(p, t, scale=1.0):
    """Idle life: breathing, the head looking slowly, the tail swaying."""
    b = sine(t, 3.0, 1.2 * scale)
    p.add('Spine', x=b)
    p.add('Chest', x=-b * 0.8)
    p.add('Neck01', x=b * 0.5)
    p.root += Vector((0, 0, 0.003 * scale * math.sin(TAU * t / 3.0)))
    look = sine(t, 6.0, 9.0 * scale)
    p.add('Neck01', z=look * 0.5)
    p.add('Neck02', z=look * 0.5, x=sine(t, 6.0, 3.0 * scale, 1.2))
    p.add('Head', z=look * 0.3, x=sine(t, 4.5, 2.0 * scale, 0.6))
    p.add('Jaw', x=2.0 * scale + sine(t, 2.2, 1.5 * scale))
    tail_wave(p, t, 5.0 * scale, 4.0, 8.0 * scale, 5.0)
    for s, ph in (('L', 0.0), ('R', math.pi)):
        p.side(s, 'UpperArm', x=sine(t, 3.0, 1.2 * scale, ph))
        p.side(s, 'Thigh', x=-sine(t, 3.0, 1.0 * scale, ph))


def tail_wave(p, t, pitch_amp, pitch_period, yaw_amp, yaw_period, lag=0.55, base_pitch=0.0):
    for i, name in enumerate(TAIL):
        p.add(name,
              x=base_pitch / 8 + sine(t, pitch_period, pitch_amp, -i * lag),
              z=sine(t, yaw_period, yaw_amp, -i * lag * 1.1))


def gait(p, t, period, stride=1.0):
    """A diagonal trot on the spot: L front with R hind, R front with L hind.
    A leg swings forward (negative X) with the lower joints folded, then
    drives back through its stance."""
    for s, other, ph in (('L', 'R', 0.0), ('R', 'L', math.pi)):
        phi = TAU * t / period + ph
        swing = max(0.0, math.sin(phi))       # 1 mid-swing (leg carried forward)
        p.side(s, 'UpperArm', x=-22 * stride * math.cos(phi))
        p.side(s, 'Forearm', x=38 * stride * swing)
        p.side(s, 'Hand', x=-18 * stride * swing + 6 * stride)
        p.side(other, 'Thigh', x=-24 * stride * math.cos(phi))
        p.side(other, 'Shin', x=-28 * stride * swing)
        p.side(other, 'Foot', x=30 * stride * swing)
    bob = math.cos(2 * TAU * t / period)
    p.root += Vector((0, 0, 0.008 * stride * bob))
    p.add('Hips', z=3.5 * stride * math.sin(TAU * t / period), x=1.5 * stride * bob)
    p.add('Spine', x=-1.5 * stride * bob)
    p.add('Neck01', x=1.5 * stride * bob, z=-2.0 * stride * math.sin(TAU * t / period))
    p.add('Head', x=-2.0 * stride * bob)
    tail_wave(p, t, 4.0 * stride, period, 12.0 * stride, period, lag=0.5, base_pitch=12.0 * stride)


# ------------------------------------------------------------ clips
def clip_idle(t):
    p = Pose()
    breath(p, t)
    return p


def clip_walk(t):
    p = Pose()
    gait(p, t, 1.2)
    p.add('Jaw', x=4.0)
    return p


def clip_attack(t):
    """Coil for 0.35 s, lunge to the snap at 0.55 s, recover by 1.4 s."""
    p = Pose()
    breath(p, t, 0.4)
    coil = track(t, [(0.0, 0), (0.30, 1), (0.55, 0), (0.60, 0)])
    lunge = track(t, [(0.30, 0), (0.55, 1), (0.85, 0.6), (1.4, 0)])
    jaw = track(t, [(0.0, 0), (0.30, 1), (0.50, 1), (0.56, 0), (0.62, 0.1), (1.4, 0)])
    p.root += Vector((0, 0.05 * coil - 0.10 * lunge, -0.02 * coil + 0.01 * lunge))
    p.add('Hips', x=-4 * coil + 5 * lunge)
    p.add('Spine', x=6 * coil - 6 * lunge)
    p.add('Chest', x=4 * coil - 6 * lunge)
    p.add('Neck01', x=-18 * coil + 14 * lunge)
    p.add('Neck02', x=-12 * coil + 22 * lunge)
    p.add('Head', x=-8 * coil + 12 * lunge)
    p.add('Jaw', x=38 * jaw)
    for s in 'LR':
        p.side(s, 'UpperArm', x=14 * coil - 16 * lunge)
        p.side(s, 'Forearm', x=22 * coil + 4 * lunge)
        p.side(s, 'Thigh', x=-10 * coil + 12 * lunge)
        p.side(s, 'Shin', x=8 * coil - 10 * lunge)
    tail_wave(p, t, 3.0, 1.2, 6.0, 0.9, base_pitch=20 * coil - 10 * lunge)
    return p


def clip_roar(t):
    p = Pose()
    breath(p, t, 0.4)
    up = track(t, [(0.0, 0), (0.35, 1), (1.0, 1), (1.5, 0)])
    jaw = track(t, [(0.0, 0), (0.40, 1), (1.05, 1), (1.35, 0)])
    shake = sine(t, 0.18, 4.0) * track(t, [(0.35, 0), (0.5, 1), (1.0, 1), (1.15, 0)])
    p.root += Vector((0, 0.02 * up, 0.015 * up))
    p.add('Hips', x=-5 * up)
    p.add('Spine', x=-4 * up)
    p.add('Chest', x=-5 * up)
    p.add('Neck01', x=-16 * up, z=shake)
    p.add('Neck02', x=-16 * up, z=shake)
    p.add('Head', x=-10 * up, z=shake * 0.5)
    p.add('Jaw', x=42 * jaw)
    for s in 'LR':
        p.side(s, 'UpperArm', x=-6 * up)
        p.side(s, 'Forearm', x=8 * up)
        p.side(s, 'Thigh', x=6 * up)
        p.side(s, 'Shin', x=-4 * up)
    tail_wave(p, t, 4.0, 1.5, 8.0, 1.2, base_pitch=35 * up)
    return p


def crouch(p, amount):
    """A sphinx on the ring: the belly a centimetre off the ground, the
    forelegs laid out in front with the paws flat, the hind legs tucked
    forward under the body, the head low, the tail curled round. The
    angles come from a search over the deformed mesh for ground contact."""
    p.root += Vector((0, 0, -0.19 * amount))
    p.add('Hips', x=2 * amount)
    p.add('Spine', x=-2 * amount)
    p.add('Chest', x=-3 * amount)
    p.add('Neck01', x=18 * amount)
    p.add('Neck02', x=14 * amount)
    p.add('Head', x=-16 * amount)
    for s in 'LR':
        p.side(s, 'UpperArm', x=-40 * amount)
        p.side(s, 'Forearm', x=-10 * amount)
        p.side(s, 'Hand', x=-30 * amount)
        p.side(s, 'Thigh', x=-75 * amount)
        p.side(s, 'Shin', x=-35 * amount)
        p.side(s, 'Foot', x=0 * amount)
    # the tail curls up and round, clear of the ground the body dropped to
    for i, name in enumerate(TAIL):
        p.add(name, x=(9 - i) * amount, z=9 * amount)


def clip_rise(t):
    """Crouched at frame 1, to its feet by 1.2 s, a head shake, then the
    roar, settling to rest at 2.5 s."""
    p = Pose()
    breath(p, t, 0.5)
    low = track(t, [(0.0, 1), (0.25, 1), (1.2, 0)])
    crouch(p, low)
    # getting up, the hind feet come up under the body before they plant
    bump = math.sin(math.pi * low)
    for s in 'LR':
        p.side(s, 'Thigh', x=-40 * bump)
        p.side(s, 'Shin', x=-60 * bump)
    shake = sine(t, 0.2, 14.0) * track(t, [(1.15, 0), (1.3, 1), (1.65, 1), (1.8, 0)])
    p.add('Neck02', z=shake)
    p.add('Head', z=shake * 0.6, x=sine(t, 0.2, 4.0, 0.7) * track(t, [(1.15, 0), (1.3, 1), (1.65, 1), (1.8, 0)]))
    up = track(t, [(1.7, 0), (1.95, 1), (2.25, 1), (2.5, 0)])
    jaw = track(t, [(1.75, 0), (2.0, 1), (2.25, 1), (2.45, 0)])
    p.root += Vector((0, 0.015 * up, 0.01 * up))
    p.add('Hips', x=-4 * up)
    p.add('Chest', x=-4 * up)
    p.add('Neck01', x=-14 * up)
    p.add('Neck02', x=-14 * up)
    p.add('Head', x=-8 * up)
    p.add('Jaw', x=40 * jaw)
    tail_wave(p, t, 4.0, 1.5, 8.0, 1.2, base_pitch=30 * up)
    return p


def clip_death(t):
    """Seven beats, each joint giving way after the one before it.
    Struck (0 to 0.3 s): the head is thrown up and aside with a cry, the
    body jolts back. The stagger (0.15 to 0.5 s): the left hind leg steps
    back to catch the weight and the body sways toward the side it will
    fall on. The front gives (0.45 to 0.9 s): the elbows fold, the chest
    drops. The rear gives (0.8 to 1.25 s): the hind legs fold, the belly
    meets the ground. The fall (1.15 to 1.95 s): over onto the left flank,
    overshooting and settling back, the root bouncing once as the body
    lands. The head lands last (1.3 to 2.0 s), a small rebound, the jaw
    slack; the upper legs loosen from the tuck. The last breath (1.95 to
    2.9 s): one long heave, the upper hind leg kicks once, the tail tip
    curls; still by 3 s."""
    p = Pose()
    hit = track(t, [(0.0, 0), (0.08, 1), (0.30, 0.6), (0.55, 0.2), (0.90, 0)])
    sway = track(t, [(0.10, 0), (0.45, 1), (0.90, 0)])
    step = max(0.0, min(1.0, (t - 0.15) / 0.30))
    lift = math.sin(math.pi * step)
    back = smooth(step) * track(t, [(0.60, 1), (1.00, 0)])
    front = track(t, [(0.45, 0), (0.90, 1)])
    rear = track(t, [(0.80, 0), (1.25, 1)])
    roll = track(t, [(1.15, 0), (1.60, 1.07), (1.80, 0.98), (1.95, 1)])
    land = track(t, [(1.52, 0), (1.60, 1), (1.72, 0)])
    lay = track(t, [(1.30, 0), (1.72, 1.08), (1.86, 0.97), (2.00, 1)])
    relax = track(t, [(1.50, 0), (2.20, 1)])
    gasp = track(t, [(1.95, 0), (2.25, 1), (2.90, 0)])
    kick = math.sin(math.pi * max(0.0, min(1.0, (t - 2.12) / 0.32)))
    curl = track(t, [(2.05, 0), (2.45, 1), (3.0, 0.7)])
    drop = track(t, [(1.60, 0), (2.30, 1)])
    belly = track(t, [(1.00, 0), (1.25, 1), (1.45, 0)])  # flat on the belly
    # the body: back with the hit and the step, nose-down as the chest
    # drops, flat as the rear folds, then over onto the left flank (the
    # hips' -Y roll). The chest drops by the hips pitching, the hind legs
    # still planted (a root drop here would push their feet through the
    # floor); the root only drops once the rear folds. Root -0.21 in all
    # lying down, the flank three centimetres off the ground and the head
    # and the under foreleg just on it, found by search over the mesh.
    p.root += Vector((0.0, 0.03 * hit + 0.03 * back - 0.02 * front, 0.0))
    p.root += Vector((0.0, 0.0, -0.18 * rear + 0.012 * land))
    p.root += Vector((-0.03 * roll, 0.0, -0.03 * roll))
    p.add('Hips', x=-5 * hit + 28 * front - 26 * rear, y=-5 * sway - 88 * roll)
    p.add('Spine', x=-5 * hit - 3 * front + 3 * gasp, y=-3 * sway, z=-6 * roll)
    p.add('Chest', x=-4 * hit - 4 * front - 4 * gasp, z=-5 * roll)
    # the head: thrown up and aside with the cry, then following the
    # chest down, then laid on the ground along the body with a rebound,
    # lifting a little on the last breath
    p.add('Neck01', x=-26 * hit + 14 * front + 6 * lay + 3 * gasp, z=10 * hit + 2 * roll)
    p.add('Neck02', x=-20 * hit + 10 * front + 8 * lay - 4 * gasp, z=8 * hit)
    p.add('Head', x=-12 * hit - 8 * front + 12 * lay - 3 * gasp, y=6 * hit, z=-6 * roll)
    p.add('Jaw', x=40 * hit + 6 * front + 8 * lay + 10 * gasp)
    # the hind feet lift through the fold, ahead of the thighs swinging
    # under (a fold tied to `rear` drags them through the floor)
    bump = track(t, [(0.76, 0), (0.90, 1), (1.25, 0)])
    squat = front * (1 - rear)  # the hind legs flex under the dropping chest
    # the legs: the left hind steps back under the hit, toward the side
    # the body will fall on; the elbows fold as the front gives, the hind
    # legs as the rear gives, everything ends folded along the ground
    # (angles searched on the deformed mesh so they stay clear of the
    # ground belly-down, mid-roll and on the flank); the under-side (left)
    # legs tuck tighter, the upper (right) ones loosen once the body lies
    # still and the upper hind leg kicks once
    for s, k in (('L', 1.0), ('R', 0.92)):
        loose = 1 - (0.25 * relax if s == 'R' else 0.0)
        p.side(s, 'UpperArm', x=8 * hit - 75 * front * k * loose)
        p.side(s, 'Forearm', x=12 * hit + 55 * front * k * loose)
        p.side(s, 'Hand', x=-45 * front * k * loose)
        p.side(s, 'Thigh', x=-4 * hit + 8 * squat - 90 * rear * k * loose - 60 * bump)
        p.side(s, 'Shin', x=-14 * squat - 40 * rear * k * loose - 80 * bump)
        p.side(s, 'Foot', x=6 * squat - 15 * bump)
    # the stepped leg, planted further back, folds wider to clear the floor
    p.side('L', 'Thigh', x=14 * back + 10 * lift - 25 * bump)
    p.side('L', 'Shin', x=-8 * lift - 20 * bump)
    p.side('L', 'Foot', x=15 * lift - 20 * bump)
    p.side('L', 'UpperArm', x=6 * sway - 50 * roll)
    p.side('R', 'Thigh', x=22 * kick)
    p.side('R', 'Shin', x=-18 * kick)
    p.side('R', 'Foot', x=25 * kick)
    # the tail: whipped up by the hit, then laid out along the ground
    # (raised in body space so the drop of the body keeps it clear); the
    # waves fade with the roll, a body-space yaw becoming a world pitch on
    # the flank, where the tail falls to the ground last; the tip curls
    # once on the last breath
    for i, name in enumerate(TAIL):
        tip = max(0, i - 4) / 3
        p.add(name,
              x=8 * hit * (i / 8) + rear * (6.5 - 3.8 * roll) + 3.5 * belly
              + sine(t, 1.6, 1.2, -i * 0.5) * (1 - lay) * (1 - roll),
              z=sine(t, 1.4, 6.0, -i * 0.5) * (1 - lay) * (1 - roll) * 0.6
              + 5 * sway * (1 - roll) - 2 * drop - 14 * curl * tip)
    return p


CLIPS = [
    ('Idle', 6.0, clip_idle),
    ('Walk', 1.2, clip_walk),
    ('Attack', 1.4, clip_attack),
    ('Roar', 1.5, clip_roar),
    ('Rise', 2.5, clip_rise),
    ('Death', 3.0, clip_death),
]
LOOPS = {'Idle', 'Walk'}
RELEASE = {'Attack': 0.55}


# ------------------------------------------------------------ baking
def apply(rig, pose):
    root = rig.pose.bones['Root']
    rest = rig.data.bones['Root'].matrix_local.to_3x3()
    root.location = rest.inverted() @ pose.root
    for pb in rig.pose.bones:
        r = pose.rot.get(pb.name)
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler([math.radians(v) for v in r]) if r else Euler((0, 0, 0))


def bake(rig, name, seconds, fn):
    n = int(round(seconds * FPS))
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    try:
        rig.animation_data.action_slot = act.slots.new('OBJECT', rig.name)
    except Exception:
        pass
    last = n if name in LOOPS else n + 1
    for f in range(1, last + 1):
        t = ((f - 1) % n) / FPS if name in LOOPS else (f - 1) / FPS
        apply(rig, fn(t))
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=f)
        rig.pose.bones['Root'].keyframe_insert('location', frame=f)
    act['loop'] = name in LOOPS
    if name in RELEASE:
        act['release'] = RELEASE[name]
    return act


def body_parts():
    return [o for o in bpy.data.objects
            if o.type == 'MESH' and o.name.startswith('Pyrefang_') and not o.name.startswith('Pyrefang_FX_')]


def lowest_point(frame):
    """The lowest world z of the deformed body at that frame."""
    sc = bpy.data.scenes[0]
    sc.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    low = 9.0
    for o in body_parts():
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        m = ev.matrix_world
        for v in me.vertices:
            z = (m @ v.co).z
            if z < low:
                low = z
        ev.to_mesh_clear()
    return low


def ground(rig, name, seconds, tolerance=0.004, window=5, cap=0.05):
    """Ground contact, after the bake: wherever the body's lowest point
    would sink below the floor, the root is lifted by that much (smoothed
    over `window` frames so a fold never pops, capped so a badly posed leg
    can never float the body: past the cap the pose is wrong, fix it),
    and the keys are rewritten."""
    show(name)
    n = int(round(seconds * FPS))
    last = n if name in LOOPS else n + 1
    lifts = []
    for f in range(1, last + 1):
        lifts.append(min(cap, max(0.0, -lowest_point(f) - tolerance)))
    if max(lifts) <= 0.0:
        return 0.0
    half = window // 2
    smoothed = [max(lifts[max(0, i - half):i + half + 1]) for i in range(len(lifts))]
    root = rig.pose.bones['Root']
    rest = rig.data.bones['Root'].matrix_local.to_3x3()
    for f, lift in zip(range(1, last + 1), smoothed):
        bpy.data.scenes[0].frame_set(f)
        root.location = root.location + rest.inverted() @ Vector((0, 0, lift))
        root.keyframe_insert('location', frame=f)
    return max(smoothed)


def build_all(previews=False):
    rig = bpy.data.objects[RIG]
    rig.rotation_euler = (0, 0, 0)
    for name, seconds, fn in CLIPS:
        bake(rig, name, seconds, fn)
        lift = ground(rig, name, seconds)
        print(f'{name}: {int(round(seconds * FPS))} frames, ground lift up to {lift * 100:.1f} cm')
    apply(rig, Pose())
    if previews:
        for name, seconds, fn in CLIPS:
            preview(rig, name, seconds)


def show(name, frame=1):
    rig = bpy.data.objects[RIG]
    act = bpy.data.actions[name]
    rig.animation_data_create()
    rig.animation_data.action = act
    try:
        rig.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    sc = bpy.data.scenes[0]
    n = int(round(dict((c[0], c[1]) for c in CLIPS)[name] * FPS))
    sc.frame_start, sc.frame_end = 1, n
    sc.frame_set(frame)


def preview(rig, name, seconds, yaw=-52, tilt=72, dist=1.35):
    """The 3D view in Material Preview (the fire needs Eevee, which the
    camera path of render.opengl does not give) rendered frame by frame to
    PNG, then ffmpeg (Blender 5.2 has no FFMPEG output). Needs a window: not
    for the headless run."""
    sc = bpy.data.scenes[0]
    show(name)
    win = bpy.data.window_managers[0].windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    space = area.spaces[0]
    space.shading.type = 'MATERIAL'
    space.overlay.show_overlays = False
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    out = os.path.join(FRAMES_DIR, name)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    sc.render.filepath = os.path.join(out, 'f_')
    with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region, scene=sc):
        r3 = space.region_3d
        r3.view_perspective = 'PERSP'
        r3.view_rotation = Euler((math.radians(tilt), 0, math.radians(yaw))).to_quaternion()
        r3.view_location = Vector((0, 0, 0.27))
        r3.view_distance = dist
        r3.update()
        bpy.ops.render.opengl(animation=True, view_context=True)
    mp4 = os.path.join(PREVIEW_DIR, f'pyrefang_{name.lower()}_preview.mp4')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(FPS), '-i',
                    os.path.join(out, 'f_%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-crf', '20', mp4], check=False)
    return mp4


if __name__ == '__main__' and bpy.app.background:
    build_all(previews='--preview' in sys.argv)
    if '--save' in sys.argv:
        bpy.ops.wm.save_mainfile()

"""A feline four-beat walk: long strides, peeling paws, rolling shoulder blades.

Revision 16, after Rusty Animator's cat walk cycle (youtube -G-ZDo1UXhU):
- lateral sequence, each hind paw leading its fore paw by 0.22 of a cycle,
  as measured on the reference (RH 0, RF .22, LH .50, LF .72);
- a paw peels off the ground heel first, pivoting on its claw tips, then
  hangs from a folded wrist or hock during the swing and unfolds to reach;
- the shoulder blade over the supporting fore leg rises and slides back with
  it, the other one drops and slides forward with the reaching leg;
- pelvis and thorax roll toward their supporting legs and yaw toward their
  reaching legs, so the spine twists between the two girdles;
- the neck absorbs the thorax motion with a delay and the gaze stays steady.

The controls are authored in place: translate the character along -Y at
WALK_SPEED to keep the supporting paws planted. Paw targets are the claw
tips, in armature space, relative to each paw's rest claw tips for X and in
absolute armature Y. Rotations are degrees. No source animation is used.
"""

import math


WALK_DURATION = 4.0/3.0
STANCE_FRACTION = .68
SWING_FRACTION = 1.0-STANCE_FRACTION
STANCE_TRAVEL = .20
WALK_SPEED = STANCE_TRAVEL/(STANCE_FRACTION*WALK_DURATION)
CONTACT_PHASES = {('R', False): 0.0, ('R', True): .22,
                  ('L', False): .50, ('L', True): .72}
# Claw tip Y at contact, armature space (-Y is forward).
CONTACT_Y = {True: -.365, False: -.045}
# Inward shift of each paw from its rest track: a cat walks on a narrow line.
TRACK_IN = {True: .016, False: .010}
PAW_LIFT = {True: .024, False: .040}
SOLE_CLEAR = .0012
# Paw pitch about the claw tips, positive curls the toes under.
PEEL = {True: 38.0, False: 30.0}
FOLD = {True: 58.0, False: 52.0}
PEEL_START = .15
BODY_DROP = -.030


def walk_event_times(duration=WALK_DURATION):
    """Exact contact and lift-off times, plus both loop endpoints."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Walk duration must be positive and finite')
    times = {0.0, float(duration)}
    for contact in CONTACT_PHASES.values():
        times.add(contact*duration)
        times.add(((contact+STANCE_FRACTION) % 1.0)*duration)
    return sorted(times)


def _ease(u):
    return u**3*(10.0-15.0*u+6.0*u*u)


def _arc(u, peak):
    """Rounded swing arc with zero velocity and acceleration at contact."""
    if u <= 0.0 or u >= 1.0:
        return 0.0
    order = 3.0/min(peak, 1.0-peak)
    return (u/peak)**(order*peak)*((1.0-u)/(1.0-peak))**(order*(1.0-peak))


def _travel(u):
    """Claw tip Y relative to contact; stance is linear, the swing C2."""
    stance = STANCE_FRACTION
    if u <= stance:
        return STANCE_TRAVEL*u/stance
    swing = SWING_FRACTION
    v = (u-stance)/swing
    return STANCE_TRAVEL*(1.0+(swing*v-_ease(v))/stance)


def _monotone(keys, u):
    """Periodic monotone cubic through (u, value) keys on [0, 1)."""
    n = len(keys)
    xs = [k[0] for k in keys] + [keys[0][0]+1.0]
    ys = [k[1] for k in keys] + [keys[0][1]]
    slopes = [(ys[i+1]-ys[i])/(xs[i+1]-xs[i]) for i in range(n)]
    tangents = []
    for i in range(n):
        a, b = slopes[i-1], slopes[i]
        tangents.append(0.0 if a*b <= 0 else 2*a*b/(a+b))
    tangents.append(tangents[0])
    u %= 1.0
    if u < xs[0]:
        u += 1.0
    i = max(k for k in range(n) if xs[k] <= u)
    h = xs[i+1]-xs[i]
    s = (u-xs[i])/h
    h00, h10 = 2*s**3-3*s*s+1, s**3-2*s*s+s
    h01, h11 = -2*s**3+3*s*s, s**3-s*s
    return h00*ys[i]+h10*h*tangents[i]+h01*ys[i+1]+h11*h*tangents[i+1]


def _paw_pitch(u, front):
    d, s = STANCE_FRACTION, SWING_FRACTION
    keys = [(0.0, 0.0), (d-PEEL_START, 0.0), (d, PEEL[front]),
            (d+(.42 if front else .42)*s, FOLD[front]),
            (d+(.80 if front else .78)*s, -3.0 if front else 2.0)]
    return _monotone(keys, u)


def _girdles(phase):
    """Height, roll, yaw of the pelvis and thorax from their legs' loading.

    Each girdle is highest when its supporting leg passes vertical, rolls up
    over that leg and yaws its other side forward with the reaching leg.
    """
    mid = STANCE_FRACTION/2
    hind = math.tau*(phase-mid)
    fore = math.tau*(phase-CONTACT_PHASES[('R', True)]-mid)
    hips_z = BODY_DROP+.0055*math.cos(2*hind)
    chest_z = BODY_DROP-.004+.0065*math.cos(2*fore)
    hip_roll, hip_yaw = -2.2*math.cos(hind), 3.2*math.cos(hind)
    chest_roll, chest_yaw = -2.8*math.cos(fore), 3.0*math.cos(fore)
    # A small surge: the body is pushed forward after each hind contact.
    surge = -.003*math.sin(2*hind)
    return hips_z, chest_z, surge, (hip_roll, hip_yaw), (chest_roll, chest_yaw)


def _body(phase):
    hips_z, chest_z, surge, (hip_roll, hip_yaw), (shoulder_roll, shoulder_yaw) = _girdles(phase)
    hind = math.tau*(phase-STANCE_FRACTION/2)
    hip_pitch = .9*math.sin(2*hind)
    trunk_pitch = .8*math.sin(2*hind-math.pi/3)
    # Spine pitch supplies the thorax height on this short FK spine; the
    # chest then restores its own orientation instead of nodding the trunk.
    spine_pitch = math.degrees((hips_z-chest_z)/.12)-2*hip_pitch
    chest_pitch = trunk_pitch-hip_pitch-spine_pitch
    roll_delta, yaw_delta = shoulder_roll-hip_roll, shoulder_yaw-hip_yaw
    rotations = {
        'Hips': (hip_pitch, hip_roll, hip_yaw),
        'Spine': (spine_pitch, .55*roll_delta, .55*yaw_delta),
        'Chest': (chest_pitch, .45*roll_delta, .45*yaw_delta),
    }
    return (0.0, surge, hips_z), rotations, (trunk_pitch, shoulder_roll, shoulder_yaw)


def walk_pelvis_rotation(t, duration=WALK_DURATION):
    """Shared source for the walk's pelvis and delayed tail response."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Walk duration must be positive and finite')
    return _body((t % duration)/duration)[1]['Hips']


def walk_controls(t, duration=WALK_DURATION):
    """Return a periodic walk, RH/RF/LH/LF contacts in the reference rhythm."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Walk duration must be positive and finite')
    phase = (t % duration)/duration
    hips, rotations, chest_world = _body(phase)
    # The neck takes the thorax motion one reference frame later per
    # control, with a low gain: the head glides while the shoulders roll.
    # The prowl carries the head low, just under the line of the back.
    previous = chest_world
    for index, (name, rest_pitch, gain) in enumerate(
            (('Neck01', 4.0, .55), ('Neck02', 3.0, .40), ('Head', -9.0, .25)), 1):
        delayed = _body((phase-index/32.0) % 1.0)[2]
        inherited = tuple(gain*value for value in delayed)
        local = [inherited[axis]-previous[axis] for axis in range(3)]
        local[0] += rest_pitch
        rotations[name] = tuple(local)
        previous = inherited
    rotations['Jaw'] = (1.4, 0.0, 0.0)

    feet, shoulder_offsets = {}, {}
    for key, contact in CONTACT_PHASES.items():
        side, front = key
        sign = 1.0 if side == 'L' else -1.0
        u = (phase-contact) % 1.0
        swing = max(0.0, (u-STANCE_FRACTION)/SWING_FRACTION)
        arc = _arc(swing, .45 if front else .46)
        # The swinging paw passes slightly outside the supporting one.
        x = sign*(-TRACK_IN[front]+.005*arc)
        y = CONTACT_Y[front]+_travel(u)
        z = SOLE_CLEAR+PAW_LIFT[front]*arc
        feet[key] = ((x, y, z), _paw_pitch(u, front))
        if front:
            # The blade rides up over the vertical supporting leg and follows
            # the paw back; it drops and protracts with the reaching leg.
            stance_mid = math.cos(math.tau*(u-STANCE_FRACTION/2))
            shoulder_offsets[side] = (
                0.0,
                .10*(_travel((u-.04) % 1.0)-STANCE_TRAVEL/2),
                .004+.007*stance_mid,
            )

    return {'hips': hips, 'rotations': rotations, 'feet': feet,
            'shoulder_offsets': shoulder_offsets}

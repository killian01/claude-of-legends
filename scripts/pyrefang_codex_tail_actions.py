"""Action-specific tail follow-through, authored without source animation.

Angles are absolute armature-space pitch/yaw in degrees. The anatomical tail
occupies s=0..1; its luminous continuation can sample through s=1.35. Compact
gestures release through the chain instead of holding a curled end pose.
"""

import math

from pyrefang_codex_walk import WALK_DURATION, walk_pelvis_rotation


_DURATIONS = {'Walk': WALK_DURATION, 'Attack': 1.4, 'Roar': 1.5,
              'Rise': 2.5, 'Emerge': 3.0, 'Death': 3.0}


# The curled tail: its root slope down to the floor, and the flat run's tilt.
EMERGE_DROP, EMERGE_DROP_SPAN, EMERGE_FLAT = 58.0, .52, 2.5


def _ease(value):
    """Septic ease with zero first three derivatives at either boundary."""
    u = max(0.0, min(1.0, value))
    return u**4 * (35.0 - 84.0*u + 70.0*u*u - 20.0*u**3)


def _gesture(t, start, end, peak=.5):
    """One rounded, asymmetric lobe, C3 where it joins the resting interval.

    Beta exponents are at least four. Unlike an eased up/down track, the
    maximum has ordinary curved acceleration, so there is no flat pose at
    the turn. ``peak`` is the fraction of the support interval at maximum.
    """
    if t <= start or t >= end:
        return 0.0
    u = (t-start)/(end-start)
    order = 4.0/min(peak, 1.0-peak)
    return (u/peak)**(order*peak) * ((1-u)/(1-peak))**(order*(1-peak))


def _rest(s):
    return -18.0 + 50.0*min(s, 1.0)**3 + 65.0*max(0.0, s-1.0)


def _relaxed(s):
    skin = min(s, 1.0)
    return (-18.0 - 4.0*math.sin(math.pi*skin) + 44.0*skin**3
            - 38.0*max(0.0, s-1.0))


def action_tail_angles(clip, t, s):
    """Return the five non-idle actions' continuous pitch/yaw directions.

    Walk is periodic, including velocity and acceleration. Attack/Roar join
    the analytic rest shape at both ends; Rise joins it at its finish, and
    Death starts there before settling permanently by 2.60 seconds.
    """
    if clip not in _DURATIONS:
        raise ValueError(f'Unsupported tail action: {clip}')
    s = max(0.0, min(1.35, s))
    skin, extension = min(s, 1.0), max(0.0, s-1.0)
    rest = _rest(s)

    if clip == 'Walk':
        # The tutorial's overlap follows the pelvis, one frame later at each
        # control. Sample that same motion instead of an unrelated tail beat.
        lag = (1.0+7.0*s)*WALK_DURATION/32.0
        hip_pitch, hip_roll, hip_yaw = walk_pelvis_rotation(t-lag)
        pitch = -30.0-8.0*math.sin(math.pi*skin)+45.0*skin**3
        pitch -= 28.0*extension
        pitch += (1.0+.55*skin+.7*extension)*hip_pitch
        yaw = -(1.15+.65*skin+.7*extension)*hip_yaw
        yaw += .25*hip_roll
        return pitch, yaw

    t = max(0.0, min(_DURATIONS[clip], t))
    if clip in ('Attack', 'Roar') and (t == 0.0 or t == _DURATIONS[clip]):
        return rest, 0.0

    if clip == 'Attack':
        # The crouch gathers the base before the .55 s bite. Extension then
        # travels outwards, while the base has already begun its recovery.
        lag = .10*skin + .07*extension
        gather = _gesture(t-lag, .02, .73, .44)
        reach = _gesture(t-lag, .22, 1.22, .43)
        release = _gesture(t-.03*s, .02, 1.35, .54)
        pitch = rest + (11.0-3.0*skin)*gather
        pitch -= (7.0+8.0*skin+15.0*extension)*reach
        pitch += (.65*skin**2+.10*extension)*release*(_relaxed(s)-rest)
        yaw = (4.0+4.0*skin)*gather - (5.0+5.0*skin)*reach
        return pitch, yaw

    if clip == 'Roar':
        # Broad support for the .49-.90 s chest lift, followed by one small
        # delayed release. The terminal curve opens as the root supports it.
        lag = .12*skin + .10*extension
        support = _gesture(t-lag, .08, 1.28, .48)
        release = _gesture(t-lag, .42, 1.30, .50)
        pitch = rest + (8.0*(1-skin)-10.0*skin**2-55.0*extension)*support
        pitch += (-2.0+5.0*skin)*release
        yaw = -(3.0+6.0*skin)*support + (1.0+2.0*skin)*release
        return pitch, yaw

    if clip == 'Emerge':
        if t == _DURATIONS['Emerge']:
            return rest, 0.0
        # Timed on a 1.2 s rise, played over the slow wake-up.
        t *= 1.2/_DURATIONS['Emerge']
        # Curled, the tail drops from the hip to the floor and lies on it all
        # the way round to the muzzle. It unwinds from the root and its end
        # whips once before settling on the rest shape.
        wrapped = 1.0-_ease((t-.18-.22*s)/(.62+.10*s))
        lying = -EMERGE_DROP*(1.0-_ease(skin/EMERGE_DROP_SPAN)) - EMERGE_FLAT
        pitch = rest + wrapped*(lying-rest)
        pitch += (6.0+14.0*skin+10.0*extension)*_gesture(t-.20*s, .40, 1.15, .40)
        yaw = wrapped*(-(30.0+135.0*skin))
        yaw += (8.0+16.0*skin)*_gesture(t-.16*s, .52, 1.18, .45)
        return pitch, yaw

    if clip == 'Rise':
        if t == 2.5:
            return rest, 0.0
        # A low animal needs clearance from the attachment, not a uniform
        # raised angle that leaves the entire tail pointing rigidly upwards.
        low_pose = 12.0-6.0*math.sin(math.pi*skin)+10.0*skin**3+10.0*extension
        lift = _ease((t-.20-.12*s)/(1.35+.08*s))
        pitch = low_pose + lift*(rest-low_pose)
        # The root opens a little sideways as the hindquarters leave the
        # ground; the end follows after the rear paw step around 1.04 s.
        lag = .16*skin + .10*extension
        unfold = _gesture(t-lag, .17, 1.84, .48)
        stretch = _gesture(t-lag, 1.10, 2.28, .50)
        pitch += (4.0-7.0*skin-12.0*extension)*unfold
        pitch -= (3.0+4.0*skin+12.0*extension)*stretch
        yaw = (6.0+6.0*skin)*unfold - (2.0+3.0*skin)*stretch
        return pitch, yaw

    # Death: transmit the hit, then lose support from the base outwards. The
    # final shape never recovers to the living rest pose or adds a last flick.
    final_pitch = -30.0+31.0*skin
    if t == 0.0:
        return rest, 0.0
    if t >= 2.60:
        return final_pitch, 0.0
    falling = _ease((t-(.40+.22*s))/(1.25+.40*s))
    lag = .16*skin + .09*extension
    hit = _gesture(t-lag, .0, .84, .32)
    drag = _gesture(t-lag, .43, 2.15, .52)
    # Remove the extra support as the chain falls. Scaling the settling bend
    # by the remaining height in angle space keeps it above its final floor
    # profile, so a transient overshoot cannot lift the whole animal through
    # the builder's contact correction.
    remaining = 1.0-falling
    pitch = final_pitch + remaining*((rest-final_pitch)*(1.0-.14*drag)
                                     + (5.0+7.0*skin)*hit)
    yaw = remaining*((3.0+6.0*skin)*hit - (1.5+2.5*skin)*drag)
    return pitch, yaw

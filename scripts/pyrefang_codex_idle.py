"""Acting idle with separate paw gestures and a haunch-led sit.

The forefeet support a high chest while the pelvis folds down. The near hind
paw steps forward before the sit and steps back after the pelvis rises. These
are planted placements, not feet dragged along with the body translation.
"""

# Planted stance shared by every clip but the walk: the rest mesh reaches its
# fore paws forward and its hind paws back on nearly straight legs; standing
# tall needs them under the body. build_pyrefang_codex adds it to all targets.
FORE_UNDER = (0.0, .040, 0.0)
# The hind soles sit 3 to 4 mm higher than the fore soles in the rest mesh.
HIND_UNDER = (0.0, -.030, -.0028)


def _ease(value):
    value = min(1.0, max(0.0, value))
    return value**3 * (10-15*value+6*value*value)


def _track(t, points):
    for (a, x), (b, y) in zip(points, points[1:]):
        if t <= b:
            return x + (y-x)*_ease((t-a)/(b-a))
    return points[-1][1]


def _pulse(t, start, peak, end):
    """One rounded gesture with a moving apex, not two stop/start eases.

    A compact beta curve keeps contact windows exact and has zero velocity
    and acceleration at lift-off and landing. Its apex has nonzero curvature,
    so the paw changes direction without freezing before the return.
    """
    if t <= start or t >= end:
        return 0.0
    u = (t-start)/(end-start)
    apex = (peak-start)/(end-start)
    power = 3.0/min(apex, 1-apex)
    return (u/apex)**(power*apex) * ((1-u)/(1-apex))**(power*(1-apex))


def _paw(t, start, peak, end, side, reach, height):
    lift = _pulse(t, start, peak, end)
    u = min(1.0, max(0.0, (t-start)/(end-start)))
    # Reach through the apex and return along a different arc. The wrist
    # follows after the lift instead of rotating in lockstep with the paw.
    travel = lift * (1 + .70*(u-.5))
    wrist = _pulse(t, start+.04, peak+.07, end)
    return (side*travel, reach*travel, height*lift), wrist


def idle_controls(t):
    # Attention starts in the head. The neck and supported trunk catch up,
    # instead of every part opening and closing together like one hinge.
    head_alert = _pulse(t, .12, .88, 2.12)
    neck_alert = _pulse(t, .20, .98, 2.27)
    alert = _pulse(t, .31, 1.11, 2.43)
    awake = _track(t, ((0, 0), (.95, 0), (2.15, 1), (9.05, 1), (10, 0)))
    # Revision 16: the reference stands tall once it has noticed something,
    # back level and neck carried forward, and only sinks back for the loop.
    stand = _track(t, ((0, 0), (.30, 0), (1.45, 1), (9.10, 1), (10, 0)))
    head_gaze = _pulse(t, 4.13, 5.04, 6.35)
    neck_gaze = _pulse(t, 4.26, 5.18, 6.49)
    gaze = _pulse(t, 4.40, 5.32, 6.66)
    head_dip = _pulse(t, 4.43, 5.35, 6.31)
    # Three quiet breaths have a shorter inhale and a longer release. Looking
    # at something interrupts the expansion; no free-running noise is added.
    breath = (.70*_pulse(t, .10, .92, 3.15)
              + .90*_pulse(t, 3.35, 4.22, 6.45)
              + .60*_pulse(t, 6.70, 7.56, 9.90))
    breath *= 1 - .32*head_gaze - .18*head_alert
    # A continuous lowering and rising. Intermediate pose keys previously
    # brought the pelvis to a stop partway through each transition.
    sit = _track(t, ((0, 0), (6.80, 0), (7.75, 1),
                     (8.20, 1), (9.04, 0), (10, 0)))
    right_paw, right_wrist = _paw(t, 2.49, 2.93, 3.44, -.003, .006, .045)
    left_paw, left_wrist = _paw(t, 3.62, 4.10, 4.62, .004, .008, .043)
    hind_forward = _track(t, ((0, 0), (6.78, 0), (7.39, 1), (8.46, 1), (9.15, 0), (10, 0)))
    hind_lift_in = _pulse(t, 6.77, 7.09, 7.40)
    hind_lift_out = _pulse(t, 8.44, 8.79, 9.17)
    right_support = _pulse(t, 2.24, 2.81, 3.62)
    left_support = _pulse(t, 3.40, 3.97, 4.82)
    front_balance = right_support - left_support
    front_settle = right_support + left_support
    support = (.007*right_support
               - .008*left_support
               - .010*_pulse(t, 6.52, 7.08, 7.62)
               - .007*_pulse(t, 8.24, 8.75, 9.34))
    hips = (support + .005*gaze, -.004*alert + .005*sit,
            -.026 + .020*stand - .150*sit + .0020*breath - .0018*front_settle)
    rotations = {
        'Hips': (.5*breath - 24*sit, -.8*gaze + 60*support, -.6*gaze),
        'Spine': (-1.3*breath - 1.6*alert - 24*sit, 0, -.8*gaze - 50*support),
        # Counter-rotate the front of the trunk as the back folds. This keeps
        # the shoulder roots at almost their standing height and supports the
        # seated silhouette with fairly extended forelegs.
        'Chest': (-.9*breath - 1.2*alert + 44*sit + .7*front_settle,
                  .5*gaze + .6*front_balance, -.9*gaze + 40*support),
        'Neck01': (.8*breath + 3*alert - 5*stand - 6*sit,
                   -.3*front_balance, -8*neck_gaze - 2*sit),
        'Neck02': (.6*breath - 8*neck_alert - 4*stand + 2*head_dip - 4*sit,
                   -neck_gaze, -12*neck_gaze + 2*sit),
        'Head': (.4*breath - 14*head_alert - 8*stand + 8*head_dip + 6*sit - .4*front_settle,
                 5*head_gaze, -30*head_gaze - 3*sit - .8*front_balance),
        # A wide hiss at the first notice, a lower snarl, a breath at the look.
        'Jaw': (1.4 + .45*breath + 36*_pulse(t, .30, .98, 1.85)
                + 16*_pulse(t, 2.15, 2.75, 3.40)
                + 4*_pulse(t, 4.91, 5.37, 6.02), 0, 0),
    }
    paws = {
        ('R', True): right_paw,
        ('L', True): left_paw,
        ('L', False): (.004*hind_forward, -.083*hind_forward,
                       .029*hind_lift_in + .034*hind_lift_out),
        ('R', False): (0, 0, 0),
    }
    toes = {('R', True): 32*right_wrist, ('L', True): 34*left_wrist,
            ('L', False): 20*hind_lift_in + 18*hind_lift_out, ('R', False): 0}
    return {'hips': hips, 'rotations': rotations, 'paws': paws, 'toes': toes,
            'chest_scale': (1+.012*breath, 1, 1+.006*breath)}

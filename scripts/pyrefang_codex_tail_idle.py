"""Passing tail gestures with staggered returns to a relaxed silhouette.

The dark tail opens into a broad resting curve between gestures, while the
luminous continuation finishes its follow-through. No source action is sampled.
"""

import math
from functools import lru_cache

import numpy as np

from pyrefang_codex_idle import idle_controls


_S = np.linspace(0, 1.35, 19)
_DT = 1/240
PHASE_SHIFT = 4.0
_REST = -18 + 50*np.minimum(1, _S)**3 + 65*np.maximum(0, _S-1)


def _ease(u):
    u = max(0.0, min(1.0, u))
    return u**3*(10-15*u+6*u*u)


def _cue(t, keys):
    for (a, x), (b, y) in zip(keys, keys[1:]):
        if t <= b:
            return x+(y-x)*_ease((t-a)/(b-a))
    return keys[-1][1]


_SIDE = ((0,0),(.90,5),(1.62,9),(2.58,-7),(3.46,-3),(4.12,4),
         (5.28,-19),(6.28,-12),(6.90,2),(7.50,18),(8.20,-10),(8.86,6),(9.52,0),(10,0))


def _relaxation(t):
    """Release each gesture through the chain, without freezing all controls.

    These are brief recovery windows observed in the reference, not fixed
    neutral keys. Spring lag and the spatial delay let the tip finish later.
    """
    time = t - .11*_S

    def smooth(value):
        u = np.clip(value, 0, 1)
        return u**3*(10-15*u+6*u*u)

    windows = ((.55,1.20,1.62,2.10), (2.94,3.46,3.58,4.08),
               (4.40,4.97,5.08,5.70), (5.90,6.48,6.79,7.32),
               (8.02,8.60,8.72,9.30))
    relaxation = np.zeros_like(_S)
    for start, arrive, leave, end in windows:
        relaxation += (smooth((time-start)/(arrive-start))
                       * (1-smooth((time-leave)/(end-leave))))
    return .55*relaxation


def _target(t):
    t = max(0.0, min(10.0, t))
    skin = np.minimum(_S, 1)
    extension = np.maximum(0, _S-1)
    body = idle_controls(t)
    sitting = _ease((-.030-body['hips'][2])/.10)
    # Phase keeps advancing through the old 2.55--3.16 s hold. The changing
    # speed and strength vary successive passes without stopping at a pose.
    # Revision 16 shifts the wave so that the distal hook peaks near 2.8,
    # 4.5, 6.2, 7.9 and 9.6 s, as in the reference, not at its troughs.
    phase = (math.tau*(t-2.35)/1.72 + math.pi/2 + 5.1 + PHASE_SHIFT
             + .17*(math.sin(.9*t)-math.sin(.9*2.35)))
    # During the sit, carry the turn through 8 s instead of leaving its
    # terminal bend behind until the pelvis rises. Phase remains monotonic.
    phase += .68*sitting
    travelling = phase - 5.1*_S - 1.4*extension
    sine = np.sin(travelling)
    wave = .75*sine + .25*sine*sine
    strength = .86 + .14*math.sin(.65*t+.4)
    # Revision 16: the reference raises the distal third of the dark tail
    # itself into the hook; the luminous continuation only prolongs it.
    amplitude = (8 + 20*skin + 70*skin**3 + 110*extension)*strength
    amplitude += 55*extension*sitting
    pitch = -18 - 9*np.sin(math.pi*skin) + 40*skin**3 + 60*extension
    pitch += amplitude*wave
    side = _cue(t, _SIDE)
    yaw = side*(1-.42*skin) + (1+4*skin)*np.sin(phase-3.8*_S+.9)
    # A broad, gently hanging curve is the resting family between gestures.
    # Keep a trace of motion, plus pelvis response below, rather than resetting
    # the entire chain to the same rigid pose at every recovery.
    relaxation = _relaxation(t)
    relaxed_pitch = -18 - 4*np.sin(math.pi*skin) + 44*skin**3 - 38*extension
    pitch += relaxation*(relaxed_pitch-pitch)
    yaw *= 1-relaxation
    # Keep floor clearance while letting the base descend with the pelvis.
    # The old larger lift left the seated tail held high and nearly level.
    pitch += 20*sitting*np.exp(-2*_S)
    # The heavy attachment follows pelvis pitch and counters weight shifts.
    # The distal chain receives these changes through its spring coupling.
    pitch += .32*body['rotations']['Hips'][0]*np.exp(-2.8*_S)
    yaw -= 380*body['hips'][0]*np.exp(-2*_S)
    # Enter and leave the rest pose gradually, preserving all clip splices.
    blend = _ease(t/.90)*_ease((10-t)/.90)
    return np.stack((_REST+blend*(pitch-_REST), blend*yaw), axis=-1)


@lru_cache(maxsize=1)
def _simulation():
    """Deterministic RK4 angular chain; the thin end has less damping."""
    omega = (24-10*np.minimum(_S,1))[:,None]
    damping = (.94-.27*np.minimum(_S,1))[:,None]
    stiffness, drag = omega**2, 2*damping*omega
    state = np.zeros((2, len(_S), 2))
    state[0,:,0] = _REST
    states, accelerations = [], []

    def derivative(value, target):
        position, velocity = value
        error = target-position
        # A parent's unsettled angle propagates to its child. A reversal at
        # the root reaches the end later, while the middle is already opening.
        parent_error = np.vstack((np.zeros((1,2)), (position-target)[:-1]))
        acceleration = stiffness*(error+.48*parent_error)-drag*velocity
        return np.stack((velocity, acceleration))

    for index in range(2401):
        time = index*_DT
        target = _target(time)
        first = derivative(state, target)
        states.append(state.copy())
        accelerations.append(first[1])
        if index == 2400:
            break
        half_target = _target(time+_DT/2)
        second = derivative(state+first*_DT/2, half_target)
        third = derivative(state+second*_DT/2, half_target)
        fourth = derivative(state+third*_DT, _target(time+_DT))
        state += _DT*(first+2*second+2*third+fourth)/6
    return np.array(states), np.array(accelerations)


@lru_cache(maxsize=2048)
def _pose(t):
    states, accelerations = _simulation()
    frame = max(0.0, min(2400.0, t/_DT))
    index = min(2399, int(frame))
    u = frame-index
    q0, v0 = states[index]
    q1, v1 = states[index+1]
    a0, a1 = accelerations[index:index+2]
    delta = q1-q0-_DT*v0-.5*_DT**2*a0
    speed = _DT*(v1-v0)-_DT**2*a0
    accel = _DT**2*(a1-a0)
    result = (q0+_DT*v0*u+.5*_DT**2*a0*u*u
              +(10*delta-4*speed+.5*accel)*u**3
              +(-15*delta+7*speed-accel)*u**4
              +(6*delta-3*speed+.5*accel)*u**5)
    # The resting recovery is already authored from 9 s. This last gentle
    # blend removes the residual spring error exactly at the loop boundary.
    settle = _ease((t-9.20)/.80)
    result[:,0] = (1-settle)*result[:,0]+settle*_REST
    result[:,1] *= 1-settle
    return result


def idle_tail_angles(t, s):
    values = _pose(max(0.0, min(10.0,t)))
    x = max(0.0, min(1.35,s))/_S[1]
    index = min(len(_S)-2,int(x))
    u = x-index
    # Catmull-Rom tangents avoid a visible hinge between simulated controls.
    before, a, b, after = values[max(0,index-1)], values[index], values[index+1], values[min(len(_S)-1,index+2)]
    m0, m1 = .5*(b-before), .5*(after-a)
    value = ((2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*m0
             +(-2*u**3+3*u*u)*b+(u**3-u*u)*m1)
    # Preserve the exact analytic rest shape between simulated samples.
    # Apply the same spatial interpolation to the analytic rest controls.
    rest_points = _REST[[max(0,index-1),index,index+1,min(len(_S)-1,index+2)]]
    r0,ra,rb,r1 = rest_points
    rest_value = ((2*u**3-3*u*u+1)*ra+(u**3-2*u*u+u)*.5*(rb-r0)
                  +(-2*u**3+3*u*u)*rb+(u**3-u*u)*.5*(r1-ra))
    rest = -18+50*min(1,s)**3+65*max(0,s-1)
    return float(value[0]+rest-rest_value), float(value[1])

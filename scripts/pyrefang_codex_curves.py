"""Smooth subframe playback while preserving every baked pose."""

import numpy as np


def smooth_loop(action):
    """Keep baked poses and join them with a periodic C2 cubic spline.

    Explicit Bezier handles preserve the solved IK poses at render frames.
    Shared derivatives and second derivatives remove the linear bake's speed
    steps, including at the loop seam. This only applies to the idle action.
    """
    curves = [curve for layer in action.layers for strip in layer.strips
              for bag in strip.channelbags for curve in bag.fcurves]
    frames = np.array([key.co.x for key in curves[0].keyframe_points])
    count = len(frames)-1
    step = float(frames[1]-frames[0])
    if count < 3 or not np.allclose(np.diff(frames), step):
        raise ValueError('Idle smoothing requires a uniform loop bake')
    values = np.array([[key.co.y for key in curve.keyframe_points] for curve in curves]).T
    if len(values) != len(frames) or not np.allclose(values[0], values[-1], atol=1e-5):
        raise ValueError('Idle smoothing requires matching loop endpoints')
    values = values[:-1]
    matrix = 4*np.eye(count) + np.roll(np.eye(count), 1, axis=1) + np.roll(np.eye(count), -1, axis=1)
    rhs = 6*(np.roll(values, -1, axis=0)-2*values+np.roll(values, 1, axis=0))/step**2
    acceleration = np.linalg.solve(matrix, rhs)
    velocity = ((np.roll(values, -1, axis=0)-values)/step
                - step*(2*acceleration+np.roll(acceleration, -1, axis=0))/6)
    for column, curve in enumerate(curves):
        for index, key in enumerate(curve.keyframe_points):
            frame = float(frames[index])
            value = float(values[index % count, column])
            tangent = float(velocity[index % count, column])
            key.co.y = value
            key.interpolation = 'BEZIER'
            key.handle_left_type = 'FREE'
            key.handle_right_type = 'FREE'
            key.handle_left = (frame-step/3, value-tangent*step/3)
            key.handle_right = (frame+step/3, value+tangent*step/3)
        curve.update()


def smooth_tail(action, loop=False, still_frame=None):
    """Join only tail keys with C2 curves; body and IK keys stay untouched.

    Nonuniform intervals support the exact bite, clip end and death rest keys.
    Periodic derivatives close Walk; clamped derivatives stop one-shot clips.
    A death rest boundary ends the spline and starts an exactly flat suffix.
    """
    curves = [curve for layer in action.layers for strip in layer.strips
              for bag in strip.channelbags for curve in bag.fcurves
              if curve.data_path.startswith('pose.bones["Tail')]
    _smooth_channels(curves, loop, still_frame)


def smooth_walk(action):
    """Keep solved walking poses with periodic C2 motion on the whole rig."""
    curves = [curve for layer in action.layers for strip in layer.strips
              for bag in strip.channelbags for curve in bag.fcurves]
    _smooth_channels(curves, loop=True, still_frame=None)


def _smooth_channels(curves, loop, still_frame):
    if not curves:
        raise ValueError('Smoothing requires baked channels')
    frames = np.array([key.co.x for key in curves[0].keyframe_points], dtype=float)
    for curve in curves:
        if not np.array_equal(frames, [key.co.x for key in curve.keyframe_points]):
            raise ValueError('Baked channels must share the same sample times')
    values = np.array([[key.co.y for key in curve.keyframe_points] for curve in curves]).T
    last = len(frames)-1
    if still_frame is not None:
        matches = np.flatnonzero(np.isclose(frames, still_frame, atol=1e-5, rtol=0))
        if len(matches) != 1 or loop:
            raise ValueError('A non-looping rest boundary must be explicitly keyed')
        last = int(matches[0])
        if not np.allclose(values[last:], values[last], atol=1e-6, rtol=0):
            raise ValueError('Tail must already be stationary after its rest boundary')
    x, y = frames[:last+1], values[:last+1]
    steps = np.diff(x)
    if len(steps) < 2 or np.any(steps <= 0):
        raise ValueError('Tail smoothing requires ordered distinct sample times')
    count = len(x)-int(loop)
    matrix = np.zeros((count, count))
    rhs = np.zeros((count, len(curves)))
    if loop:
        if not np.allclose(y[0], y[-1], atol=1e-5, rtol=0):
            raise ValueError('Periodic tail curves require matching endpoint poses')
        y = y[:-1]
        for i in range(count):
            previous, following = (i-1) % count, (i+1) % count
            before, after = steps[previous], steps[i]
            matrix[i, previous] += before
            matrix[i, i] += 2*(before+after)
            matrix[i, following] += after
            rhs[i] = 6*((y[following]-y[i])/after-(y[i]-y[previous])/before)
    else:
        matrix[0, 0], matrix[0, 1] = 2*steps[0], steps[0]
        matrix[-1, -2], matrix[-1, -1] = steps[-1], 2*steps[-1]
        rhs[0] = 6*(y[1]-y[0])/steps[0]
        rhs[-1] = -6*(y[-1]-y[-2])/steps[-1]
        for i in range(1, count-1):
            before, after = steps[i-1], steps[i]
            matrix[i, i-1:i+2] = (before, 2*(before+after), after)
            rhs[i] = 6*((y[i+1]-y[i])/after-(y[i]-y[i-1])/before)
    acceleration = np.linalg.solve(matrix, rhs)
    velocity = np.zeros_like(y)
    for i in range(count if loop else count-1):
        following = (i+1) % count
        velocity[i] = ((y[following]-y[i])/steps[i]
                       - steps[i]*(2*acceleration[i]+acceleration[following])/6)
    if not loop:
        velocity[0] = velocity[-1] = 0
    for column, curve in enumerate(curves):
        for i, key in enumerate(curve.keyframe_points):
            frame, value = float(frames[i]), float(values[i, column])
            tangent = float(velocity[i % count, column]) if i <= last else 0.0
            before = frames[i]-frames[i-1] if i else steps[-1] if loop else steps[0]
            after = frames[i+1]-frames[i] if i+1 < len(frames) else steps[0] if loop else steps[-1]
            key.interpolation = 'BEZIER'
            key.handle_left_type = key.handle_right_type = 'FREE'
            key.handle_left = (frame-before/3, value-tangent*before/3)
            key.handle_right = (frame+after/3, value+tangent*after/3)
        curve.update()

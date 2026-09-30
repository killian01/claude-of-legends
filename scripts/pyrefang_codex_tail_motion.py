"""Independent tail directions in armature space for each Codex clip.

Idle keeps its damped gestures and relaxed recoveries. The other clips use
their own action-led responses and share only the exact neutral splice pose.
"""

import math

from pyrefang_codex_tail_idle import idle_tail_angles
from pyrefang_codex_tail_actions import action_tail_angles


def tail_angles(clip, t, s):
    """Absolute pitch/yaw in degrees for a point along the tail."""
    s = max(0.0, min(1.35, s))
    if clip == 'Idle':
        t = min(10.0, max(0.0, t))
        pitch, yaw = idle_tail_angles(t, s)
    else:
        pitch, yaw = action_tail_angles(clip, t, s)
    return pitch, yaw


def tail_direction(clip, t, s):
    pitch, yaw = (math.radians(value) for value in tail_angles(clip, t, s))
    return (math.sin(yaw)*math.cos(pitch), math.cos(yaw)*math.cos(pitch), math.sin(pitch))

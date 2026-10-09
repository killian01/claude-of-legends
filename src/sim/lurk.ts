// The lurk (Nisk's Lie Low, CONTEXT.md: Lurk): a champion whose passive
// declares one hides from its enemies once it has kept still for a beat,
// or kept to one brush for as long, and stays hidden until it acts or
// moves (in the open) or leaves its brush. The first attack out of hiding
// swings with a burst of attack speed: primed while hidden, so the very
// swing that breaks the hiding is already the faster one, and kept for the
// burst's span when an attack is what ended it. Taking damage restarts the
// count, so a champion under fire never melts away mid-fight.
//
// Stepped once a tick after everything that moves or acts (sim.ts), right
// before the tick's vision: a step out of the brush is seen on the same
// tick. The hiding is the generic stealth status (vision.ts reads it), so
// people and bots alike lose sight of the lurker the same way.

import { addStatus, breakStealth, isStealthed, refreshBuff } from './combat/status';
import type { GameMap } from './content/map';
import { copy, dist } from './geo';
import { passiveOf } from './passives';
import type { Vec2 } from './types';
import type { Unit } from './unit';
import { brushIndexAt } from './vision';

export interface LurkSpec {
  // Seconds of keeping still, or of keeping to one brush, before hiding.
  after: number;
  // The attack speed share the first attack out of hiding swings with,
  // and how long the burst lasts when an attack ended the hiding.
  burst: { asPct: number; duration: number };
}

export interface LurkState {
  // Where the stillness began (inside a brush: where it stands now).
  at: Vec2;
  // Since when it has kept still or kept to its brush.
  since: number;
  // The brush it stood in at `since`, -1 in the open; -2 before the first
  // step, so the first step always starts the count.
  brush: number;
  hidden: boolean;
}

// Farther than this from where the stillness began is moving: separation
// drift and float noise stay under it.
const STILL_EPS = 0.05;
// The hiding and the primed burst are renewed every tick while they hold,
// for a little longer than a tick, and broken outright when they end.
const LINGER_S = 0.2;

export function newLurkState(at: Vec2): LurkState {
  return { at: copy(at), since: 0, brush: -2, hidden: false };
}

function restart(st: LurkState, at: Vec2, time: number, brush: number): void {
  st.at = copy(at);
  st.since = time;
  st.brush = brush;
  st.hidden = false;
}

function hold(u: Unit, spec: LurkSpec, time: number): void {
  if (!isStealthed(u, time)) addStatus(u, { kind: 'stealth', until: time + LINGER_S });
  for (const s of u.statuses) {
    if (s.kind === 'stealth') s.until = Math.max(s.until, time + LINGER_S);
  }
  refreshBuff(u, time, LINGER_S, { asPct: spec.burst.asPct });
}

export function stepLurk(u: Unit, time: number, map: GameMap): void {
  const spec = passiveOf(u)?.lurk;
  const st = u.lurk;
  if (!spec || !st) return;
  if (u.dead) {
    restart(st, u.pos, time, -2);
    return;
  }
  const brush = brushIndexAt(map, u.pos);
  const acted = u.actedAt >= time;
  const moved = dist(u.pos, st.at) > STILL_EPS || u.activeDash !== null;
  if (st.hidden) {
    const leftBrush = st.brush !== -1 && brush !== st.brush;
    const movedInOpen = st.brush === -1 && moved;
    if (acted || leftBrush || movedInOpen || !isStealthed(u, time)) {
      breakStealth(u);
      // An attack ended it: the burst it swung with carries on.
      if (acted && u.pendingAttack !== null) {
        refreshBuff(u, time, spec.burst.duration, { asPct: spec.burst.asPct });
      }
      restart(st, u.pos, time, brush);
      return;
    }
    if (st.brush !== -1) st.at = copy(u.pos);
    hold(u, spec, time);
    return;
  }
  if (acted || u.lastDamagedAt >= time || brush !== st.brush || (brush === -1 && moved)) {
    restart(st, u.pos, time, brush);
    return;
  }
  if (brush !== -1) st.at = copy(u.pos);
  if (time - st.since >= spec.after - 1e-9) {
    st.hidden = true;
    hold(u, spec, time);
  }
}

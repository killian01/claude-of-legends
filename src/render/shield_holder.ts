// Who a self-or-ally shield landed on, read back from the world after the
// cast: the sim never says on the wire, but the holder is the one unit in
// reach carrying the freshest shield. Pure, so the pick is testable without
// the renderer.

export interface ShieldCandidate {
  id: number;
  team: number;
  dead: boolean;
  pos: { x: number; z: number };
  statuses: readonly { kind: string; until: number }[];
}

function freshestShield(unit: ShieldCandidate, now: number): number {
  let best = -Infinity;
  for (const s of unit.statuses) {
    if (s.kind === 'shield' && s.until > now && s.until > best) best = s.until;
  }
  return best;
}

// The caster or an allied unit within `reach` of it whose shield status
// expires latest (the one applied this tick). The reach is how far the
// spell can land: its cast range plus its search radius around the aim.
// The caster when no shield shows yet, which the renderer treats as
// "nothing to draw" once it checks the status list itself.
export function pickShieldHolder<T extends ShieldCandidate>(
  caster: T,
  units: Iterable<T>,
  reach: number,
  now: number,
): T {
  let holder = caster;
  let best = freshestShield(caster, now);
  for (const u of units) {
    if (u === caster || u.team !== caster.team || u.dead) continue;
    const dx = u.pos.x - caster.pos.x;
    const dz = u.pos.z - caster.pos.z;
    if (dx * dx + dz * dz > reach * reach) continue;
    const until = freshestShield(u, now);
    if (until > best) {
      best = until;
      holder = u;
    }
  }
  return holder;
}

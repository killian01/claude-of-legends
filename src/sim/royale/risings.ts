// The Risings (CONTEXT.md: Rising): the big creatures and the Warden called
// RISING_WARN_S ahead on the planet, the Warden's site drawn inside the
// light, what a big creature's last hit pays, and the Wrath's holder on the
// Wanderseed and its passing. The bodies themselves stand on the sim's own
// rings and pit (rings.ts, objectives.ts), scaled at their rise
// (CombatCtx.neutralScale); this module keeps their clocks on the planet's
// (content/royale_events.ts): the Pyrefang and the Voidmaul at 3:00 and
// RISING_RETURN_S after each death, the Warden once, and a heads-up for
// each. The mode drives it from stepAfterDeaths and onDeath.

import {
  RISING_HEAL,
  RISING_MANA,
  RISING_PIECES,
  RISING_PIECES_BEFORE_GRAFTS,
  RISING_RETURN_S,
  RISING_WARN_S,
  WARDEN_SITE_FORECAST_S,
  WRATH_PASS_MIN_S,
  WRATH_ROYALE_S,
} from '../content/royale_events';
import type { Vec3 } from '../geo';
import { wardenPitOf } from '../objectives';
import type { ObsRising, ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import { type DuskSchedule, duskAt } from './dusk';
import type { RoyaleGround } from './layout';
import type { RoyaleMode } from './mode';
import type { RisingKind, RisingState, RoyaleVariant } from './types';

const EPS = 1e-9;

// Where the Warden rises (pure): the walkable point nearest the center of
// the light as it will stand WARDEN_SITE_FORECAST_S after the rise, the
// Hastening's offset applied, so the field is already headed there. The
// center itself when no walkable ground is near it.
export function wardenSite(
  schedule: DuskSchedule,
  risesAt: number,
  duskOffset: number,
  ground: RoyaleGround,
): Vec3 {
  const d = duskAt(schedule, risesAt + WARDEN_SITE_FORECAST_S + duskOffset);
  const center = d.now.radius > 0 ? d.now.center : schedule.final;
  if (ground.walkable(center)) return { ...center };
  return ground.nearestWalkable(center) ?? { ...center };
}

// What a big creature's last hit pays (pure): pieces of the build, all the
// health and all the mana. With a Heartwood Graft offered (grafts.ts, once
// Grafts ship) it pays RISING_PIECES; with none, the piece in its place.
export interface RisingReward {
  pieces: number;
  heal: number;
  mana: number;
}

export function risingReward(heartwoodOffered: boolean): RisingReward {
  return {
    pieces: heartwoodOffered ? RISING_PIECES : RISING_PIECES_BEFORE_GRAFTS,
    heal: RISING_HEAL,
    mana: RISING_MANA,
  };
}

// The Wrath's length for a Warden's last hit, by variant.
export function wrathLength(variant: RoyaleVariant): number {
  return WRATH_ROYALE_S[variant];
}

// What the Wrath's taker gets when its holder falls (pure): whatever was
// left, never less than WRATH_PASS_MIN_S; nothing when it had run out.
export function wrathPassedUntil(holderUntil: number, time: number): number | null {
  const left = holderUntil - time;
  if (left <= EPS) return null;
  return time + Math.max(left, WRATH_PASS_MIN_S);
}

function call(sim: Sim, s: RisingState): void {
  sim.pushEvent({ type: 'royale_rising', kind: s.kind, at: { ...s.pos }, risesAt: s.risesAt });
}

function siteOf(p: { x: number; y?: number; z: number }): Vec3 {
  return { x: p.x, y: p.y ?? 0, z: p.z };
}

// One tick of the Risings after the deaths: each ring's creature called
// RISING_WARN_S ahead, standing, and when it falls its return moved to
// RISING_RETURN_S; the Warden called once with its site drawn inside the
// light, and once fallen never again; the Wrath run out.
export function stepRisings(mode: RoyaleMode, sim: Sim): void {
  const s = mode.state;
  if (s.stage !== 'play') return;
  const time = sim.time;
  for (const ring of sim.ringStates) {
    const kind: RisingKind = ring.creature;
    const i = s.risings.findIndex((r) => r.kind === kind);
    const live = i >= 0 ? s.risings[i]! : null;
    if (live?.up && ring.unitId !== live.unitId) {
      // It fell this tick (rings.ts set the 5v5's return): the planet's.
      s.risings.splice(i, 1);
      ring.nextRiseAt = time + RISING_RETURN_S;
      continue;
    }
    if (ring.unitId !== null) {
      if (live && !live.up) {
        live.up = true;
        live.unitId = ring.unitId;
      } else if (!live) {
        s.risings.push({
          kind,
          pos: siteOf(ring.site),
          risesAt: time,
          up: true,
          unitId: ring.unitId,
        });
      }
      continue;
    }
    if (!live && time + EPS >= ring.nextRiseAt - RISING_WARN_S) {
      const r: RisingState = {
        kind,
        pos: siteOf(ring.site),
        risesAt: ring.nextRiseAt,
        up: false,
        unitId: null,
      };
      s.risings.push(r);
      call(sim, r);
    }
  }
  stepWarden(mode, sim);
  if (s.wrathHolder && time + EPS >= s.wrathHolder.until) {
    const holder = sim.units.get(s.wrathHolder.unitId);
    if (holder) sim.teamBuffs.clearWrath(holder.team);
    s.wrathHolder = null;
  }
}

function stepWarden(mode: RoyaleMode, sim: Sim): void {
  const s = mode.state;
  const o = sim.objectives;
  const time = sim.time;
  const i = s.risings.findIndex((r) => r.kind === 'warden');
  const live = i >= 0 ? s.risings[i]! : null;
  if (live?.up && o.wardenId !== live.unitId) {
    // It fell: no second Warden on the planet.
    s.risings.splice(i, 1);
    o.nextSpawnAt = Number.POSITIVE_INFINITY;
    return;
  }
  if (o.wardenId !== null) {
    if (live && !live.up) {
      live.up = true;
      live.unitId = o.wardenId;
    } else if (!live) {
      const w = sim.units.get(o.wardenId);
      s.risings.push({
        kind: 'warden',
        pos: w ? siteOf(w.pos) : siteOf(wardenPitOf(sim.map, o)),
        risesAt: time,
        up: true,
        unitId: o.wardenId,
      });
    }
    return;
  }
  if (live || !Number.isFinite(o.nextSpawnAt)) return;
  if (time + EPS < o.nextSpawnAt - RISING_WARN_S) return;
  const site = wardenSite(mode.schedule, o.nextSpawnAt, s.duskOffset, mode.ground);
  o.site = site;
  const r: RisingState = {
    kind: 'warden',
    pos: { ...site },
    risesAt: o.nextSpawnAt,
    up: false,
    unitId: null,
  };
  s.risings.push(r);
  call(sim, r);
}

// The Wrath handed to a champion on the planet (the Warden's last hit, an
// Ascendant's): its own for wrathLength, the one holder there is; a holder
// before it loses theirs.
export function grantRoyaleWrath(mode: RoyaleMode, sim: Sim, killer: Unit): void {
  const s = mode.state;
  const before = s.wrathHolder;
  if (before && before.unitId !== killer.id) {
    const was = sim.units.get(before.unitId);
    if (was) sim.teamBuffs.clearWrath(was.team);
  }
  const until = sim.time + wrathLength(mode.variant);
  sim.teamBuffs.setWrath(killer.team, until);
  s.wrathHolder = { unitId: killer.id, until };
}

// The holder fell (onDeath's champion branch, every variant): its Wrath goes
// with it, and to the champion credited with the takedown with what was
// left, at least WRATH_PASS_MIN_S; a fall nobody is credited with (the
// Dusk's burn, a Seedfall's impact, a creature with no champion's hit in
// the credit window) drops it. Nothing when the victim holds no Wrath.
export function wrathOnDeath(mode: RoyaleMode, sim: Sim, victim: Unit, killer: Unit | null): void {
  const s = mode.state;
  const h = s.wrathHolder;
  if (!h || h.unitId !== victim.id) return;
  sim.teamBuffs.clearWrath(victim.team);
  const until = killer ? wrathPassedUntil(h.until, sim.time) : null;
  if (killer && until !== null) {
    sim.teamBuffs.setWrath(killer.team, until);
    s.wrathHolder = { unitId: killer.id, until };
  } else {
    s.wrathHolder = null;
  }
  sim.pushEvent({
    type: 'royale_wrath_passed',
    from: victim.id,
    to: s.wrathHolder ? s.wrathHolder.unitId : null,
  });
}

// The Risings as everyone sees them (ObsRoyale.risings): each called and
// each standing, where, when it rises, and a standing body's health share.
export function observeRisings(mode: RoyaleMode, sim: Sim, _u: Unit): Pick<ObsRoyale, 'risings'> {
  const out: ObsRising[] = [];
  for (const r of mode.state.risings) {
    const body = r.unitId !== null ? sim.units.get(r.unitId) : undefined;
    out.push({
      kind: r.kind,
      x: r.pos.x,
      y: r.pos.y,
      z: r.pos.z,
      risesAt: r.risesAt,
      up: r.up,
      hpFrac: body && body.maxHp > 0 ? body.hp / body.maxHp : 1,
    });
  }
  return { risings: out };
}

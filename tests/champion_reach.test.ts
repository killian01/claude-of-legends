// The reach floors (docs/design/kits-v2.md, the reach pass).
//
// Reach is the cheapest power on the roster: widening a zone or lengthening
// a skillshot multiplies a payload the Kit envelope has already paid for
// (src/sim/forge/budget.ts), which is why it drifts. It drifted here: one
// ultimate was doubled across in the v2 playtest and the champions beside
// it were left where they were, until a marksman's own volley reached less
// far than his bow and an assassin opened from two units closer than the
// fighter.
//
// So the floors are written down. They are floors, not a formula: a
// champion may reach much further than its role asks (Vesk crosses the map
// and that is his whole name), but none may reach so short that the button
// has no moment of its own.

import { describe, expect, it } from 'vitest';
import { RANGED_THRESHOLD } from '../src/sim/combat/auto_attack';
import type { AbilityDef, CastSpec } from '../src/sim/combat/casting';
import { specForRank } from '../src/sim/combat/casting';
import { CHAMPION_LIST, type ChampionDef } from '../src/sim/content/champions';
import type { AbilityKey } from '../src/sim/types';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// How far the button threatens, in world units: the far edge of what it can
// touch. A skillshot or a cone is its own length; a zone or a burst is the
// distance it is placed at plus its rim; a leap is where it lands.
function reachOfSpec(spec: CastSpec, castRange: number): number {
  switch (spec.kind) {
    case 'skillshot':
    case 'cone':
      return spec.range;
    case 'dash':
      return spec.range;
    case 'zone':
      return castRange + spec.radius;
    case 'burst':
      return castRange + spec.radius;
    case 'self_or_ally':
      return Math.max(castRange, spec.searchRadius ?? 0);
    case 'enemy_target':
    case 'wall':
      return castRange;
  }
}

// The priciest rank reaches furthest, so a rank-up never lowers a floor.
function reachOf(a: AbilityDef): number {
  let far = reachOfSpec(a.spec, a.castRange);
  for (const v of a.atRank ?? []) {
    far = Math.max(far, reachOfSpec(specForRank(a, v.rank), a.castRange));
  }
  return far;
}

// A leap is judged by what it closes, not by what it hits, so it is exempt
// from the "further than your own attack" floor: Vesk's Backstep is three
// units on purpose, and a retreat that outranged his rifle would be a
// different spell. A cast on the champion's own body (Ember Flurry, Smoke
// Veil, Apex Frenzy) has no reach to speak of at all.
function isMobility(a: AbilityDef): boolean {
  return a.spec.kind === 'dash';
}

function isOnSelf(a: AbilityDef): boolean {
  return a.spec.kind === 'self_or_ally' && a.castRange === 0 && !a.spec.searchRadius;
}

// Every leap a champion owns, on any key: for a melee kit this is the
// whole engage, whether it sits on Q (Dain, Fenn, Rhoka, Torv) or on the
// ultimate (Korrath, who has no other way in).
function gapClosers(c: ChampionDef): number[] {
  return KEYS.map((k) => c.abilities[k])
    .filter(isMobility)
    .map(reachOf);
}

const melee = (c: ChampionDef): boolean => c.base.attackRange <= RANGED_THRESHOLD;

// A melee champion's engage has to cross the ground a ranged champion
// stands on, and the longest auto-attack on the roster is Vesk's 6.2.
const MELEE_ENGAGE_FLOOR = 6;
// A spell is worth its cast time only if it offers reach an attack does
// not already have.
const THREAT_MARGIN = 2;

describe('the reach floors', () => {
  it('never lets a spell land shorter than its caster own attack range', () => {
    // Ashvyn's Shadow Volley was the violation this rule was written from:
    // a cone of 5.5 on a champion who shoots at 5.9, so there was no
    // distance at which pressing Q bought anything.
    for (const c of CHAMPION_LIST) {
      for (const key of KEYS) {
        const a = c.abilities[key];
        if (isMobility(a) || isOnSelf(a)) continue;
        expect(
          reachOf(a),
          `${c.id} ${key} (${a.name}) reaches under its own attack`,
        ).toBeGreaterThan(c.base.attackRange);
      }
    }
  });

  it('gives every champion one button that reaches past its attack', () => {
    for (const c of CHAMPION_LIST) {
      const far = Math.max(...KEYS.map((k) => reachOf(c.abilities[k])));
      expect(far, `${c.id} threatens no further than it attacks`).toBeGreaterThanOrEqual(
        c.base.attackRange + THREAT_MARGIN,
      );
    }
  });

  it('gives every melee champion a way onto a ranged one', () => {
    // Without this a melee kit is a champion who can only fight what walks
    // into it, which is the shape every playtest complains about.
    for (const c of CHAMPION_LIST.filter(melee)) {
      const leaps = gapClosers(c);
      expect(leaps.length, `${c.id} has no leap at all`).toBeGreaterThan(0);
      expect(
        Math.max(...leaps),
        `${c.id} cannot cross a ranged champion's range`,
      ).toBeGreaterThanOrEqual(MELEE_ENGAGE_FLOOR);
    }
  });
});

describe('the kits that read as one kit', () => {
  it('lets Korrath raise his wall where his grip can pull', () => {
    // The rampart and the grip are sold as one combo (stun against stone),
    // and the combo only exists where both reach: the wall was placed at 7
    // while the grip pulled from 8.
    const k = CHAMPION_LIST.find((c) => c.id === 'korrath');
    expect(k).toBeDefined();
    if (!k) return;
    expect(k.abilities.W.castRange).toBeGreaterThanOrEqual(reachOf(k.abilities.E));
  });

  it('keeps the melee engage a band and not a ladder', () => {
    // The v2 playtest doubled Dain's punch to 7 and left the other four
    // melee champions where they were, so the fighter opened from two
    // units further than the assassin whose case for existing is arriving
    // first. Every melee leap now sits between 6 and 7.
    const best = CHAMPION_LIST.filter(melee).map((c) => Math.max(...gapClosers(c)));
    expect(Math.min(...best)).toBeGreaterThanOrEqual(MELEE_ENGAGE_FLOOR);
    expect(Math.max(...best) / Math.min(...best)).toBeLessThanOrEqual(1.25);
  });
});

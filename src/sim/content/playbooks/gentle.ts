// The Gentle player, a house style (CONTEXT.md: House style): the fair
// first fight a newcomer meets. It farms and holds its lane, answers a hit
// with a trade back from where it stands, never walks under an enemy tower
// while an enemy champion is near (no dive, no chase, whatever the kill),
// and starts no fight of its own before GENTLE_FROM_S of match time AND
// level GENTLE_FROM_LEVEL; past both, a fight in sight walks in only with
// the odds on its side. No hunt into the dark, no answer to a vanish, no
// join before the threshold. Seated by post, never drawn: the enemy lane
// seats of an offline practice match and of a public match whose people
// are all Guests (house.ts, gentleSeats).
//
// Measured on the retention replica (a scripted careful newcomer, every
// champion in every lane, three minutes of practice, seeds 3, 7, 11 and
// 42, 120 runs): against the drawn styles the newcomer died 104 times and
// killed 17, against the Gentle player 88 and 42; top gained the most, mid
// lost to tower dives (the reach ring's business, src/render/tower_reach.ts).
// A version that also stepped back from any enemy champion within eight
// before the threshold did worse (the newcomer followed it under its tower),
// so the engine's idle defense still strikes for a Gentle player that
// stands still beside a champion (src/sim/idle_defense.ts), as for anyone.

import type { PlaybookDef, Trigger } from '../../playbook/types';
import { DRINK_PLAY } from './drink';

// The threshold: before both hold, the Gentle player starts nothing.
export const GENTLE_FROM_S = 120;
export const GENTLE_FROM_LEVEL = 3;

const PAST_THRESHOLD: Trigger = {
  kind: 'all',
  of: [
    { kind: 'time', atLeast: GENTLE_FROM_S },
    { kind: 'level', atLeast: GENTLE_FROM_LEVEL },
  ],
};

export const GENTLE_PLAYBOOK: PlaybookDef = {
  version: 4,
  plays: [
    DRINK_PLAY,
    { id: 'retreat', when: { kind: 'hp', below: 0.32 }, do: { kind: 'retreat' } },
    {
      id: 'rest',
      when: { kind: 'all', of: [{ kind: 'atFountain' }, { kind: 'hp', below: 0.7 }] },
      do: { kind: 'hold' },
    },
    { id: 'shop', when: { kind: 'atFountain' }, do: { kind: 'shop' } },
    {
      id: 'shop-trip',
      when: {
        kind: 'all',
        of: [
          { kind: 'not', of: { kind: 'atFountain' } },
          { kind: 'gold', atLeast: 1000 },
        ],
      },
      do: { kind: 'goShop' },
    },
    // No dive: under an enemy tower with an enemy champion near, step back
    // toward the own tower, even for a kill the Laner would stay for.
    {
      id: 'no-dive',
      when: {
        kind: 'all',
        of: [{ kind: 'underTower' }, { kind: 'enemies', within: 20, atLeast: 1 }],
      },
      do: { kind: 'fallBack' },
    },
    { id: 'avoid-tower', when: { kind: 'underTower' }, do: { kind: 'avoidTower' } },
    { id: 'finish', when: { kind: 'always' }, do: { kind: 'finishSanctum' } },
    {
      id: 'finish-warden',
      when: { kind: 'warden', state: 'up', hpAtMost: 0.2, near: 10 },
      do: { kind: 'contestWarden', partyAtLeast: 1 },
    },
    {
      id: 'finish-creature',
      when: { kind: 'creature', state: 'up', hpAtMost: 0.2, near: 10 },
      do: { kind: 'contestCreature', partyAtLeast: 1 },
    },
    // The trade back: hit a moment ago, it answers what is in reach, with
    // no odds good enough to walk in on (the engage spell held).
    {
      id: 'trade-back',
      when: { kind: 'struck', within: 3 },
      do: { kind: 'fight', commitAt: 1 },
    },
    // Past the threshold, a fight of its own, walking in only with the odds.
    {
      id: 'fight',
      when: { kind: 'all', of: [{ kind: 'enemyVisible' }, PAST_THRESHOLD] },
      do: { kind: 'fight', commitAt: 0.55 },
    },
    {
      id: 'join',
      when: { kind: 'all', of: [{ kind: 'allyFighting', within: 25 }, PAST_THRESHOLD] },
      do: { kind: 'joinAlly', within: 25 },
    },
    { id: 'warden', when: { kind: 'always' }, do: { kind: 'contestWarden' } },
    {
      id: 'ascendant',
      when: { kind: 'always' },
      do: { kind: 'contestCreature', which: 'ascendant' },
    },
    { id: 'creature', when: { kind: 'always' }, do: { kind: 'contestCreature' } },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'camp', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'takeCamp' } },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push' } },
  ],
};

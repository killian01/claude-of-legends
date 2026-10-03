// The battle royale's seats (ADR 0031): fifty, house bots on every seat a
// person does not take, each house seat a champion of the roster drawn
// from the match's seed (the same champion twice is allowed: fifty seats,
// ten champions), and every seat's bot skill dealt from the seed too
// (bot/skill.ts). Each on a stream of its own, so the sim's stream and the
// fill's never shift each other.

import type { RoyaleSkillId } from '../content/bots/royale_skills';
import { CHAMPION_LIST } from '../content/champions';
import { Rng } from '../rng';
import { skillMix } from './bot/skill';
import { ROYALE_SEATS } from './types';

const FILL_SALT = 0x5b0a11;
const SKILL_SALT = 0x5c111;

// The champions of `count` house seats, from the seed.
export function royaleHouseChampions(seed: number, count: number): string[] {
  const ids = CHAMPION_LIST.map((c) => c.id).sort();
  const rng = new Rng((seed ^ FILL_SALT) >>> 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ids[rng.int(ids.length)]!);
  return out;
}

// The bot skill of every seat, in seat order, from the seed: the stand-in
// a person's seat gets plays its seat's skill too.
export function royaleSeatSkills(
  seed: number,
  seats = ROYALE_SEATS,
  guestsOnly = false,
): RoyaleSkillId[] {
  return skillMix(seats, new Rng((seed ^ SKILL_SALT) >>> 0), guestsOnly);
}

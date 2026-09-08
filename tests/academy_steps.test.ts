// The Academy's steps (ui/academy_steps.ts): their order, the way between
// them, which are open on a bot being made, and the line each says of a
// bot.

import { describe, expect, it } from 'vitest';
import { SIGIL_LIST } from '../src/sim/content/sigils';
import {
  openSteps,
  SIGIL_BLURBS,
  STEPS,
  type StepFacts,
  stepAfter,
  stepBefore,
  stepIndex,
  stepOf,
  stepStatus,
} from '../src/ui/academy_steps';

const facts = (over: Partial<StepFacts> = {}): StepFacts => ({
  bot: {
    championName: 'Torv',
    sigilNames: ['Riftstep', 'Mend'],
    version: 3,
    deposited: false,
  },
  kit: { items: 7, roleBuild: true, variants: 0 },
  plays: { total: 16, off: 0 },
  record: { games: 0, wins: 0 },
  dirty: false,
  ...over,
});

describe('the Academy steps', () => {
  it('go from the bot to play, one way through', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['bot', 'kit', 'playbook', 'spar', 'play']);
    expect(STEPS.map((s) => s.label)).toEqual([
      'The bot',
      'The kit',
      'The playbook',
      'Sparring',
      'Play',
    ]);
    for (const s of STEPS) expect(s.lead.length).toBeGreaterThan(20);
    expect(stepIndex('bot')).toBe(0);
    expect(stepIndex('play')).toBe(4);
    expect(stepOf('kit').label).toBe('The kit');
  });

  it('knows the step before and after, and none past either end', () => {
    expect(stepBefore('bot')).toBeNull();
    expect(stepAfter('bot')?.id).toBe('kit');
    expect(stepBefore('playbook')?.id).toBe('kit');
    expect(stepAfter('playbook')?.id).toBe('spar');
    expect(stepAfter('play')).toBeNull();
    expect(stepBefore('play')?.id).toBe('spar');
  });

  it('opens every step on a bot that exists and the first alone before', () => {
    expect(openSteps(true)).toEqual(['bot', 'kit', 'playbook', 'spar', 'play']);
    expect(openSteps(false)).toEqual(['bot']);
  });

  it('says what the bot is, and that the other steps wait for it', () => {
    expect(stepStatus('bot', facts())).toBe('Torv, Riftstep and Mend, v3');
    expect(stepStatus('bot', facts({ bot: null }))).toBe('Not made yet');
    for (const id of ['kit', 'playbook', 'spar', 'play'] as const) {
      expect(stepStatus(id, facts({ bot: null }))).toBe('After it is made');
    }
  });

  it('says whose build it is and how many items', () => {
    expect(stepStatus('kit', facts())).toBe("7 items, the role's build");
    expect(stepStatus('kit', facts({ kit: { items: 6, roleBuild: false, variants: 2 } }))).toBe(
      '6 items, your own build, 2 variants',
    );
    expect(stepStatus('kit', facts({ kit: { items: 1, roleBuild: false, variants: 1 } }))).toBe(
      '1 item, your own build, 1 variant',
    );
    expect(stepStatus('kit', facts({ kit: { items: 0, roleBuild: false, variants: 0 } }))).toBe(
      'No build: it buys what its role does',
    );
  });

  it('counts the plays, the ones off, and an unsaved edit', () => {
    expect(stepStatus('playbook', facts())).toBe('16 plays');
    expect(stepStatus('playbook', facts({ plays: { total: 9, off: 2 }, dirty: true }))).toBe(
      '9 plays, 2 off, unsaved',
    );
    expect(stepStatus('playbook', facts({ plays: { total: 1, off: 0 } }))).toBe('1 play');
  });

  it('reads the Record for the sparring step', () => {
    expect(stepStatus('spar', facts({ record: null }))).toBe('Reading the Record');
    expect(stepStatus('spar', facts())).toBe('Not sparred yet');
    expect(stepStatus('spar', facts({ record: { games: 1, wins: 1 } }))).toBe('1 match, 1 won');
    expect(stepStatus('spar', facts({ record: { games: 6, wins: 4 } }))).toBe('6 matches, 4 won');
  });

  it('says whether the bot is ranked, and how it has done', () => {
    expect(stepStatus('play', facts())).toBe('Not ranked');
    const ranked = facts();
    ranked.bot = { ...ranked.bot!, deposited: true };
    expect(stepStatus('play', ranked)).toBe('Ranked');
    ranked.bot = { ...ranked.bot, tally: { wins: 7, losses: 3 } };
    expect(stepStatus('play', ranked)).toBe('Ranked, 7-3 rated');
  });

  it('describes every sigil in the pool, and no other', () => {
    expect(Object.keys(SIGIL_BLURBS).sort()).toEqual(SIGIL_LIST.map((s) => s.id).sort());
    for (const s of SIGIL_LIST) expect(SIGIL_BLURBS[s.id]?.length).toBeGreaterThan(20);
  });
});

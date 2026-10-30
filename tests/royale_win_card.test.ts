// The win card on a battle royale landing (src/ui/royale_win_card.ts): what
// wins the match in at most four short lines, for a few seconds counted
// while it shows, closed sooner by its button, for a person on the seat
// only; the first steps waiting while it shows and running after it as
// they ran from the landing.

import { describe, expect, it } from 'vitest';
import { GRAFT_SETTLE_S } from '../src/ui/royale_grafts';
import {
  FIGHT_EARLY_S,
  NOT_LANDED,
  noteLanding,
  type RoyaleStepsView,
  royaleStepLine,
  royaleStepsStart,
  sinceLanding,
  stepRoyaleSteps,
} from '../src/ui/royale_steps';
import {
  closeWinCard,
  holdsSteps,
  stepsLanding,
  stepWinCard,
  WIN_CARD_LATE_S,
  WIN_CARD_S,
  type WinCardState,
  winCardStart,
  winCardUp,
  winCardWords,
} from '../src/ui/royale_win_card';
import { ONE_LIFE_WINS, RESPAWN_WINS } from '../src/ui/royale_win_line';

const run = (
  s: WinCardState,
  from: number,
  to: number,
  over: (t: number) => { landed?: boolean; covered?: boolean } = () => ({}),
): WinCardState => {
  let at = s;
  for (let t = from; t <= to + 1e-9; t += 0.05) {
    const o = over(t);
    at = stepWinCard(at, { time: t, landed: o.landed ?? true, covered: o.covered ?? false });
  }
  return at;
};

describe("the win card's words", () => {
  it('says Respawn: most takedowns when the light goes out, and three short lines', () => {
    expect(winCardWords('respawn')).toEqual({
      title: 'Most takedowns when the light goes out wins',
      lines: [
        'Fight champions for takedowns',
        'Open caches for your build',
        'Stay in the light: the Dusk burns',
      ],
    });
  });

  it('says One life: last one standing, and its own lines', () => {
    const card = winCardWords('one_life');
    expect(card.title).toBe('Last one standing wins');
    expect(card.lines).toContain('Stay in the light: the Dusk burns');
    expect(card.lines.some((l) => /one life/i.test(l))).toBe(true);
  });

  it('never says more than four short lines, the title one of them', () => {
    for (const v of ['respawn', 'one_life'] as const) {
      const card = winCardWords(v);
      expect(1 + card.lines.length).toBeLessThanOrEqual(4);
      for (const line of card.lines) expect(line.length, line).toBeLessThanOrEqual(36);
      expect(card.title.length).toBeLessThanOrEqual(44);
    }
  });

  it('opens on the words the win line keeps saying', () => {
    expect(winCardWords('respawn').title.startsWith('Most takedowns')).toBe(true);
    expect(RESPAWN_WINS.startsWith('Most takedowns')).toBe(true);
    expect(winCardWords('one_life').title).toBe(ONE_LIFE_WINS);
  });

  it('names no control: the first steps say the keys and the taps', () => {
    for (const v of ['respawn', 'one_life'] as const) {
      for (const line of [winCardWords(v).title, ...winCardWords(v).lines]) {
        expect(line).not.toMatch(/click|tap|press|thumb|stick|key/i);
      }
    }
  });
});

describe("the win card's clock", () => {
  it('waits for the landing, then shows for WIN_CARD_S and goes', () => {
    let s = winCardStart(true);
    s = run(s, 0, 9.5, () => ({ landed: false }));
    expect(winCardUp(s, false)).toBe(false);
    expect(s.done).toBe(false);
    s = run(s, 10, 10 + WIN_CARD_S - 0.2);
    expect(winCardUp(s, false)).toBe(true);
    s = run(s, 10 + WIN_CARD_S - 0.15, 10 + WIN_CARD_S + 0.1);
    expect(s.done).toBe(true);
    expect(winCardUp(s, false)).toBe(false);
    expect(s.endedAt).toBeCloseTo(10 + WIN_CARD_S, 1);
  });

  it('shows a drop-in its card from its first update in play', () => {
    // A drop-in lands minutes into the match: its landing is its own.
    const s = run(winCardStart(true), 300, 301);
    expect(s.landedAt).toBe(300);
    expect(winCardUp(s, false)).toBe(true);
  });

  it('counts only the seconds it shows: a menu or a death holds its clock', () => {
    let s = run(winCardStart(true), 10, 13);
    s = run(s, 13.05, 18, () => ({ covered: true }));
    expect(s.done).toBe(false);
    expect(winCardUp(s, true)).toBe(false);
    s = run(s, 18.05, 18.05 + WIN_CARD_S - 3 - 0.3);
    expect(winCardUp(s, false)).toBe(true);
    s = run(s, 18.05 + WIN_CARD_S - 3 - 0.25, 18.05 + WIN_CARD_S - 3 + 0.2);
    expect(s.done).toBe(true);
  });

  it('gives up once the landing is WIN_CARD_LATE_S behind, shown or not', () => {
    const s = run(winCardStart(true), 10, 10 + WIN_CARD_LATE_S + 0.1, () => ({ covered: true }));
    expect(s.done).toBe(true);
    expect(s.shown).toBe(0);
  });

  it('closes on its button', () => {
    let s = run(winCardStart(true), 10, 11);
    s = closeWinCard(s, 11.2);
    expect(s.done).toBe(true);
    expect(s.endedAt).toBe(11.2);
    expect(closeWinCard(s, 14)).toBe(s);
    expect(stepWinCard(s, { time: 12, landed: true, covered: false })).toBe(s);
  });

  it('never shows to a replay viewer or a coach', () => {
    const s = run(winCardStart(false), 10, 12);
    expect(s.done).toBe(true);
    expect(winCardUp(s, false)).toBe(false);
    expect(holdsSteps(s)).toBe(false);
  });

  it('is gone before the Graft cards unfold after the landing', () => {
    // The cards fold for GRAFT_SETTLE_S after the landing
    // (src/ui/royale_grafts.ts graftFolded): the card and the cards'
    // row never stand together unless the cards are opened again, and
    // then the card steps aside.
    expect(WIN_CARD_S).toBeLessThan(GRAFT_SETTLE_S);
  });
});

// The first steps' view, just landed, nothing done.
const view = (time: number, since: number | null, covered = false): RoyaleStepsView => ({
  time,
  covered,
  dead: false,
  sinceLanding: since,
  fought: false,
  openedCache: false,
  padUsed: false,
  outside: false,
  overtaken: false,
  enemyNear: false,
  takedowns: 0,
  level: 3,
  ultReady: false,
  ultCast: false,
  hpFrac: 1,
});

describe('the first steps and the win card', () => {
  it('wait while the card is to come or up, and count their landing from its going', () => {
    let s = winCardStart(true);
    expect(holdsSteps(s)).toBe(true);
    expect(stepsLanding(s, null, 5)).toBeNull();
    s = run(s, 10, 12);
    expect(stepsLanding(s, 2, 12)).toBeNull();
    s = run(s, 12.05, 10 + WIN_CARD_S + 0.1);
    expect(holdsSteps(s)).toBe(false);
    expect(stepsLanding(s, WIN_CARD_S + 0.1, 10 + WIN_CARD_S + 0.1)).toBeCloseTo(0.1, 1);
    expect(stepsLanding(s, 30, 40)).toBeCloseTo(30 - WIN_CARD_S, 1);
  });

  it('run from the landing when no card showed', () => {
    const s = winCardStart(false);
    expect(stepsLanding(s, 3, 13)).toBe(3);
  });

  it('bring the fight step first once the card has gone, never the card lines with it', () => {
    let card = winCardStart(true);
    let steps = royaleStepsStart(false, []);
    let landing = NOT_LANDED;
    const shown: { t: number; id: string | null }[] = [];
    for (let t = 0; t <= 30; t += 0.05) {
      const st = t < 10 ? 'drop' : 'play';
      landing = noteLanding(landing, st, 10, t);
      const since = sinceLanding(landing, st, t);
      card = stepWinCard(card, { time: t, landed: since !== null, covered: false });
      const up = winCardUp(card, false);
      steps = stepRoyaleSteps(steps, view(t, stepsLanding(card, since, t), holdsSteps(card)));
      const visible = steps.current !== null && !holdsSteps(card);
      shown.push({ t, id: up ? 'card' : visible ? steps.current : null });
      // Never the card and a step at once.
      expect(up && visible).toBe(false);
    }
    const first = shown.find((x) => x.id !== null && x.id !== 'card');
    expect(first?.id).toBe('br_fight');
    expect(first?.t ?? 0).toBeGreaterThanOrEqual(10 + WIN_CARD_S);
    // Its early window is counted from the card's going.
    const fight = shown.filter((x) => x.id === 'br_fight');
    expect(fight.length * 0.05).toBeGreaterThanOrEqual(FIGHT_EARLY_S - 0.1);
    expect(royaleStepLine('br_fight', 'mouse')).toMatch(/attack/);
  });
});

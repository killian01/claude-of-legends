// The team kill score, top center: the number both teams are actually
// playing for. It only existed inside the Tab panel, so reading it meant
// covering the screen with the scoreboard in the middle of a fight.

import type { ScoreRow, TeamId } from '../sim/types';

// Total champion takedowns per team, indexed by team id.
export function teamKills(rows: readonly ScoreRow[]): readonly [number, number] {
  const totals: [number, number] = [0, 0];
  for (const r of rows) totals[r.team] += r.kills;
  return totals;
}

export class TeamScore {
  readonly el: HTMLElement;
  private readonly numbers: readonly [HTMLElement, HTMLElement];
  // Last written pair, so a 20 Hz update does not touch the DOM every frame.
  private shown: [number, number] = [-1, -1];

  constructor(colors: readonly string[], viewerTeam: TeamId) {
    const mk = (cls: string, text: string): HTMLElement => {
      const e = document.createElement('div');
      e.className = cls;
      e.textContent = text;
      return e;
    };
    this.el = mk('hud-teamscore', '');
    const zero = mk('hud-teamscore-n', '0');
    zero.style.color = colors[0] ?? '#9dbcf5';
    const one = mk('hud-teamscore-n', '0');
    one.style.color = colors[1] ?? '#f5a3a3';
    // Team 1 always reads left, the way the Tab panel lists it and the way
    // the minimap is drawn. Swapping the sides per viewer would make this the
    // only element in the HUD that means something different on each screen;
    // which side is yours is said by the glow instead.
    (viewerTeam === 0 ? zero : one).classList.add('mine');
    this.el.append(zero, mk('hud-teamscore-label', 'KILLS'), one);
    this.numbers = [zero, one];
  }

  update(rows: readonly ScoreRow[]): void {
    const [a, b] = teamKills(rows);
    if (a === this.shown[0] && b === this.shown[1]) return;
    this.shown = [a, b];
    this.numbers[0].textContent = String(a);
    this.numbers[1].textContent = String(b);
  }
}

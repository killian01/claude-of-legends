import { describe, expect, it } from 'vitest';
import {
  AFK_IDLE_TICKS,
  AFK_SWEEP_TICKS,
  AFK_WARN_SECONDS,
  AFK_WARN_TICKS,
  afkCall,
} from '../server/afk';
import { Match } from '../server/match';
import { AFK_TITLE_MARK, afkTitle, afkWarnLine } from '../src/ui/afk_warn';

function twoSeats(): Match {
  return new Match(7, [
    { clientId: 1, name: 'alice', team: 0, championId: 'sylra', sigils: ['riftstep', 'mend'] },
    { clientId: 2, name: 'bob', team: 1, championId: 'fenn', sigils: ['zephyr', 'sear'] },
  ]);
}

// Puts a seat's last command `ticks` ago, without stepping two minutes.
function silentFor(match: Match, clientId: number, ticks: number): void {
  match.players.get(clientId)!.lastCommandAt = match.sim.tickCount - ticks;
}

describe('the AFK clock', () => {
  it('warns past the warning mark, once, and removes past the idle mark', () => {
    expect(afkCall(AFK_WARN_TICKS, false)).toBeNull();
    expect(afkCall(AFK_WARN_TICKS + 1, false)).toBe('warn');
    expect(afkCall(AFK_WARN_TICKS + 1, true)).toBeNull();
    expect(afkCall(AFK_IDLE_TICKS + 1, true)).toBe('remove');
    expect(afkCall(AFK_IDLE_TICKS + 1, false)).toBe('remove');
  });

  it('lands the warning a whole sweep period or more before the removal', () => {
    expect(AFK_IDLE_TICKS - AFK_WARN_TICKS).toBeGreaterThanOrEqual(AFK_SWEEP_TICKS);
    expect(AFK_WARN_SECONDS).toBe(30);
  });
});

describe('the AFK sweep of a 5v5', () => {
  it('warns a silent seat once a silence, and an order starts it over', () => {
    const match = twoSeats();
    silentFor(match, 1, AFK_WARN_TICKS + 1);
    silentFor(match, 2, 10);
    expect(match.afkSweep()).toEqual({ warn: [1], remove: [] });
    expect(match.afkSweep()).toEqual({ warn: [], remove: [] });
    // An order keeps the seat; the next long silence is warned again.
    match.tick();
    match.handleCommand(1, { t: 'stop' });
    expect(match.afkSweep()).toEqual({ warn: [], remove: [] });
    match.tick();
    silentFor(match, 1, AFK_WARN_TICKS + 1);
    expect(match.afkSweep()).toEqual({ warn: [1], remove: [] });
  });

  it('removes a seat that stayed silent after the warning', () => {
    const match = twoSeats();
    silentFor(match, 2, AFK_WARN_TICKS + 1);
    expect(match.afkSweep().warn).toEqual([2]);
    silentFor(match, 2, AFK_IDLE_TICKS + 1);
    expect(match.afkSweep()).toEqual({ warn: [], remove: [2] });
  });

  it('never sweeps a rejoined seat on arrival', () => {
    const match = twoSeats();
    silentFor(match, 2, AFK_IDLE_TICKS + 1);
    const seat = match.handleDisconnect(2)!;
    match.restorePlayer(9, seat);
    expect(match.afkSweep()).toEqual({ warn: [], remove: [] });
  });
});

describe('the AFK warning on screen', () => {
  it('names the seconds left and the way to keep the seat', () => {
    expect(afkWarnLine(30)).toBe(
      'Still there? Give any order within 30 s or a bot takes your champion over.',
    );
  });

  it('marks the tab title once and gives it back', () => {
    const marked = afkTitle('Claude of Legends', true);
    expect(marked).toBe(`${AFK_TITLE_MARK}Claude of Legends`);
    expect(afkTitle(marked, true)).toBe(marked);
    expect(afkTitle(marked, false)).toBe('Claude of Legends');
    expect(afkTitle('Claude of Legends', false)).toBe('Claude of Legends');
  });
});

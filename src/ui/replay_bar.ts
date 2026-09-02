// The replay control bar: a REPLAY badge, pause and playback speeds up to
// ten times, thirty seconds back or forward, a scrub slider over the whole
// match, a time to type, and the way out. Pure DOM; src/main.ts owns the
// clock and the seeking (a backward seek rebuilds the deterministic sim
// and steps it silently to the tick) and reports through setTime.
//
// It sits above the ability bar: the top center belongs to the team score,
// the target frame and the announcements.

import { DT } from '../sim/types';

const CSS = `
.replay-bar {
  position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 11;
  width: min(680px, 94vw); display: flex; flex-direction: column; gap: 6px;
  background: rgba(10, 15, 7, 0.88); border: 1px solid #6b5a2e; border-radius: 8px;
  padding: 6px 10px; pointer-events: auto; font-family: system-ui, sans-serif;
}
.replay-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.replay-badge { color: #c9a84a; font-weight: 800; font-size: 12px; letter-spacing: 2px; margin-right: 4px; }
.replay-btn {
  padding: 5px 10px; border-radius: 6px; border: 1px solid #466030;
  background: #1d2a14; color: #d8e6c0; font-size: 12px; font-weight: 600; cursor: pointer;
}
.replay-btn:hover { border-color: #7ca050; }
.replay-btn.on { background: #2c4a1c; border-color: #a3c96a; color: #e8f5c8; }
.replay-time {
  color: #e8dfae; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
  min-width: 96px; text-align: center;
}
.replay-time.seeking { color: #c9a84a; }
.replay-goto {
  width: 58px; padding: 4px 6px; border-radius: 6px; border: 1px solid #466030;
  background: #10160c; color: #d8e6c0; font-size: 12px; text-align: center; outline: none;
}
.replay-goto:focus { border-color: #a3c96a; }
.replay-exit { margin-left: auto; }
.replay-slider { width: 100%; margin: 0; accent-color: #a3c96a; cursor: pointer; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const TICKS_PER_S = Math.round(1 / DT);
export const SEEK_STEP_S = 30;

export function fmtClock(tick: number): string {
  const s = Math.max(0, Math.floor(tick / TICKS_PER_S));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A typed time: m:ss (or m.ss), else a plain number of seconds.
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,3})[:.](\d{1,2})$/.exec(t);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * TICKS_PER_S;
  if (/^\d{1,5}$/.test(t)) return Number(t) * TICKS_PER_S;
  return null;
}

export interface ReplayBar {
  el: HTMLElement;
  // The clock, every frame: where the sim stands, and whether a seek is
  // still stepping toward its target.
  setTime(tick: number, seeking: boolean): void;
}

export function buildReplayBar(opts: {
  ticks: number;
  onSpeed: (mult: number) => void;
  onSeek: (tick: number) => void;
  onExit: () => void;
}): ReplayBar {
  ensureCss();
  const bar = document.createElement('div');
  bar.className = 'replay-bar';
  const row = document.createElement('div');
  row.className = 'replay-row';
  const badge = document.createElement('span');
  badge.className = 'replay-badge';
  badge.textContent = 'REPLAY';
  row.appendChild(badge);

  let current = 0;
  const btn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'replay-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    row.appendChild(b);
    return b;
  };
  const speedBtns: HTMLButtonElement[] = [];
  const speed = (label: string, mult: number): void => {
    const b = btn(label, mult === 0 ? 'Pause' : `Play at ${label}`, () => {
      opts.onSpeed(mult);
      for (const s of speedBtns) s.classList.toggle('on', s === b);
    });
    speedBtns.push(b);
  };
  speed('Pause', 0);
  speed('1x', 1);
  speed('2x', 2);
  speed('4x', 4);
  speed('10x', 10);
  speedBtns[1]?.classList.add('on');
  btn(`-${SEEK_STEP_S}s`, 'Thirty seconds back', () =>
    opts.onSeek(current - SEEK_STEP_S * TICKS_PER_S),
  );
  btn(`+${SEEK_STEP_S}s`, 'Thirty seconds forward', () =>
    opts.onSeek(current + SEEK_STEP_S * TICKS_PER_S),
  );

  const time = document.createElement('span');
  time.className = 'replay-time';
  row.appendChild(time);

  const goto = document.createElement('input');
  goto.className = 'replay-goto';
  goto.placeholder = 'm:ss';
  goto.title = 'Jump to a time (m:ss), Enter to go';
  goto.maxLength = 7;
  goto.addEventListener('keydown', (e) => {
    // The HUD's keybinds must not fire while a time is being typed.
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const tick = parseClock(goto.value);
    if (tick !== null) {
      opts.onSeek(tick);
      goto.value = '';
      goto.blur();
    }
  });
  row.appendChild(goto);

  const exit = btn('Exit replay', 'Leave the replay', opts.onExit);
  exit.classList.add('replay-exit');
  bar.appendChild(row);

  const slider = document.createElement('input');
  slider.className = 'replay-slider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(Math.max(1, opts.ticks));
  slider.step = String(TICKS_PER_S);
  slider.value = '0';
  // While the thumb is held the clock shows where it points, not where the
  // sim stands; the seek fires on release.
  let dragging = false;
  slider.addEventListener('pointerdown', () => {
    dragging = true;
  });
  slider.addEventListener('input', () => {
    dragging = true;
    time.textContent = `${fmtClock(Number(slider.value))} / ${fmtClock(opts.ticks)}`;
  });
  slider.addEventListener('change', () => {
    dragging = false;
    opts.onSeek(Number(slider.value));
  });
  bar.appendChild(slider);

  const setTime = (tick: number, seeking: boolean): void => {
    current = tick;
    if (!dragging) {
      slider.value = String(tick);
      time.textContent = `${fmtClock(tick)} / ${fmtClock(opts.ticks)}`;
    }
    time.classList.toggle('seeking', seeking);
    time.title = seeking ? 'Stepping the match to that time' : '';
  };
  setTime(0, false);
  return { el: bar, setTime };
}

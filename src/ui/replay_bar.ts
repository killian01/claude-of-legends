// The replay control bar (playtest round 3): a REPLAY badge, five seconds
// back or forward, reverse playback at one, two or four times, pause,
// playback up to ten times, the clock, a time to type, the way out, a
// scrub slider over the whole match, and under it the marks: a density
// strip of the kills by side, ticks for the structures and the Warden, the
// followed seat's own deaths in red, each ten-second slice listing its
// moments on hover and seeking on click. J, K and L, the arrows, comma
// and period, and space do the same from the keyboard. Pure DOM;
// src/main.ts owns the clock, the seeking and the checkpoints
// (src/game/replay_cursor.ts) and reports through setTime.
//
// It sits just above the HUD's own bottom block, measured rather than
// guessed (replay_bar_place.ts): a fixed height landed on the champion's
// health and gold. The top center belongs to the team score, the target
// frame and the announcements. Nobody's default fits every screen, so the
// badge is a drag handle, H collapses the bar to that handle, and both
// choices are remembered.

import type { ReplayMark } from '../game/replay_marks';
import { DT } from '../sim/types';
import { creatureName } from './objective_line';
import {
  clampToView,
  dockedBottom,
  type Placement,
  readPrefs,
  writePrefs,
} from './replay_bar_place';

const CSS = `
.replay-bar {
  position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); z-index: 11;
  width: min(760px, 94vw); display: flex; flex-direction: column; gap: 6px;
  background: rgba(10, 15, 7, 0.88); border: 1px solid #6b5a2e; border-radius: 8px;
  padding: 6px 10px; pointer-events: auto; font-family: system-ui, sans-serif;
}
/* Moved by hand: pinned by its top left corner, and the centering
   transform has to go with the centering. */
.replay-bar.moved { left: auto; right: auto; bottom: auto; transform: none; }
/* Collapsed: the handle, the clock and the way back, nothing else. A
   replay you cannot see is not a replay. */
.replay-bar.collapsed { width: auto; }
.replay-bar.collapsed .replay-hideable { display: none; }
.replay-bar.dragging { opacity: 0.85; }
.replay-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.replay-badge {
  color: #c9a84a; font-weight: 800; font-size: 12px; letter-spacing: 2px; margin-right: 4px;
  cursor: grab; touch-action: none; user-select: none;
}
.replay-bar.dragging .replay-badge { cursor: grabbing; }
.replay-btn {
  padding: 5px 9px; border-radius: 6px; border: 1px solid #466030;
  background: #1d2a14; color: #d8e6c0; font-size: 12px; font-weight: 600; cursor: pointer;
}
.replay-btn:hover { border-color: #7ca050; }
.replay-btn.on { background: #2c4a1c; border-color: #a3c96a; color: #e8f5c8; }
.replay-btn.back.on { background: #4a2c1c; border-color: #c9a06a; color: #f5e0c8; }
.replay-sep { width: 1px; height: 18px; background: #466030; margin: 0 2px; }
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
.replay-track { position: relative; height: 22px; width: 100%; }
.replay-covered {
  position: absolute; left: 0; top: 0; height: 2px; background: #6b8a3a; width: 0;
  border-radius: 1px; opacity: 0.8;
}
.replay-slices { position: absolute; left: 0; right: 0; top: 3px; bottom: 0; display: flex; }
.replay-slice { position: relative; flex: 1; height: 100%; cursor: pointer; }
.replay-slice:hover { background: rgba(163, 201, 106, 0.12); }
.replay-heat { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 1px 1px 0 0; }
.replay-heat.blue { background: #4f8fd6; }
.replay-heat.red { background: #d65c4f; }
.replay-heat.mixed { background: linear-gradient(90deg, #4f8fd6 50%, #d65c4f 50%); }
.replay-tick { position: absolute; top: 0; width: 2px; height: 9px; margin-left: -1px; }
.replay-tick.tower { background: #e8dfae; }
.replay-tick.sanctum { background: #ffd94a; height: 14px; }
.replay-tick.warden { background: #b06ae8; height: 12px; }
.replay-tick.creature { background: #e8944a; height: 11px; }
.replay-tick.wrath { background: #f3ecff; height: 14px; width: 3px; }
.replay-tick.own { background: #ff3b3b; height: 16px; width: 3px; }
.replay-tip {
  position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 12;
  background: rgba(10, 15, 7, 0.96); border: 1px solid #6b5a2e; border-radius: 6px;
  padding: 5px 8px; color: #d8e6c0; font-size: 11px; white-space: nowrap; pointer-events: none;
}
.replay-tip .t { color: #c9a84a; font-weight: 700; }
.replay-keys { color: #7f9a68; font-size: 10.5px; margin-left: 6px; }
`;

// Where the bar's own placement is remembered, per browser.
const PREFS_KEY = 'loc.replayBar';

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const TICKS_PER_S = Math.round(1 / DT);
// The step of the buttons and the arrows: a fight's granularity.
export const SEEK_STEP_S = 5;
// The step with shift held.
export const SEEK_LONG_STEP_S = 30;
// The width of one slice of the marks strip.
export const SLICE_S = 10;
// The speeds J and L walk through, backward and forward.
const BACK_SPEEDS = [-1, -2, -4];
const FORWARD_SPEEDS = [1, 2, 4, 10];

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

// Where J or L lands from a speed: the next notch away from zero on that
// side, or the first notch when crossing from the other side or from pause.
export function nextSpeed(current: number, direction: 'back' | 'forward'): number {
  const notches = direction === 'back' ? BACK_SPEEDS : FORWARD_SPEEDS;
  const sameSide = direction === 'back' ? current < 0 : current > 0;
  if (!sameSide) return notches[0]!;
  const i = notches.indexOf(current);
  return notches[Math.min(notches.length - 1, i + 1)] ?? notches[0]!;
}

export interface ReplayBar {
  el: HTMLElement;
  // The clock, every frame: where the sim stands, and whether a seek is
  // still stepping toward its target.
  setTime(tick: number, seeking: boolean): void;
  // The speed as the viewer has it (the keys change it from outside).
  setSpeed(mult: number): void;
  // The marks so far and the tick the checkpoints cover.
  setMarks(marks: readonly ReplayMark[], ownUnitId: number | null): void;
  setCovered(tick: number): void;
  dispose(): void;
}

export function buildReplayBar(opts: {
  ticks: number;
  onSpeed: (mult: number) => void;
  onSeek: (tick: number) => void;
  // One tick, forward or back, while paused.
  onStep: (ticks: number) => void;
  onExit: () => void;
  // A name for a unit, for the slice tooltip.
  nameOf: (unitId: number) => string;
}): ReplayBar {
  ensureCss();
  const bar = document.createElement('div');
  bar.className = 'replay-bar';
  const row = document.createElement('div');
  row.className = 'replay-row';
  const badge = document.createElement('span');
  badge.className = 'replay-badge';
  badge.textContent = 'REPLAY';
  badge.title = 'Drag to move the bar; double-click to put it back. H hides it.';
  row.appendChild(badge);

  let current = 0;
  let speedNow = 1;
  // Where the viewer last put the bar, and whether they folded it.
  const prefs = readPrefs(safeRead(PREFS_KEY));
  let moved: Placement | null = prefs.at ?? null;
  let collapsed = prefs.collapsed ?? false;
  const btn = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'replay-btn replay-hideable';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    row.appendChild(b);
    return b;
  };
  const sep = (): void => {
    const s = document.createElement('span');
    s.className = 'replay-sep replay-hideable';
    row.appendChild(s);
  };
  const speedBtns = new Map<number, HTMLButtonElement>();
  const speed = (label: string, mult: number, title: string): void => {
    const b = btn(label, title, () => setSpeed(mult, true));
    if (mult < 0) b.classList.add('back');
    speedBtns.set(mult, b);
  };
  const setSpeed = (mult: number, tell: boolean): void => {
    speedNow = mult;
    for (const [m, b] of speedBtns) b.classList.toggle('on', m === mult);
    if (tell) opts.onSpeed(mult);
  };

  btn(`-${SEEK_STEP_S}s`, 'Five seconds back (left arrow; shift for thirty)', () =>
    opts.onSeek(current - SEEK_STEP_S * TICKS_PER_S),
  );
  sep();
  speed('4x', -4, 'Play backward at four times (J)');
  speed('2x', -2, 'Play backward at twice (J)');
  speed('1x', -1, 'Play backward (J)');
  speedBtns.get(-4)!.textContent = '◀ 4x';
  speedBtns.get(-2)!.textContent = '◀ 2x';
  speedBtns.get(-1)!.textContent = '◀ 1x';
  speed('‖', 0, 'Pause (K or space)');
  speed('1x', 1, 'Play (L)');
  speed('2x', 2, 'Play at twice (L)');
  speed('4x', 4, 'Play at four times (L)');
  speed('10x', 10, 'Play at ten times (L)');
  sep();
  btn(`+${SEEK_STEP_S}s`, 'Five seconds forward (right arrow; shift for thirty)', () =>
    opts.onSeek(current + SEEK_STEP_S * TICKS_PER_S),
  );
  setSpeed(1, false);

  const time = document.createElement('span');
  time.className = 'replay-time';
  row.appendChild(time);

  const goto = document.createElement('input');
  goto.className = 'replay-goto replay-hideable';
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
  const keys = document.createElement('span');
  keys.className = 'replay-keys replay-hideable';
  keys.textContent = 'J K L, arrows, comma and period, H hides';
  keys.title =
    'J plays backward, K pauses, L plays forward (again for faster); arrows step five ' +
    'seconds (shift: thirty); comma and period step one tick while paused; space pauses; ' +
    'H hides the bar down to its handle';
  row.appendChild(keys);

  const exit = btn('Exit replay', 'Leave the replay', opts.onExit);
  exit.classList.add('replay-exit');
  // The way out stays whatever is folded away: nobody should have to
  // unfold the bar to leave the replay.
  exit.classList.remove('replay-hideable');
  // The one control that stays whatever else is folded away: a hidden
  // bar must be able to come back.
  const fold = btn('', 'Hide the controls (H)', () => setCollapsed(!collapsed));
  fold.classList.remove('replay-hideable');
  bar.appendChild(row);

  const slider = document.createElement('input');
  slider.className = 'replay-slider replay-hideable';
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

  // The marks strip: one slice per ten seconds of match.
  const track = document.createElement('div');
  track.className = 'replay-track replay-hideable';
  const covered = document.createElement('div');
  covered.className = 'replay-covered';
  const slices = document.createElement('div');
  slices.className = 'replay-slices';
  track.append(covered, slices);
  bar.appendChild(track);
  const sliceTicks = SLICE_S * TICKS_PER_S;
  const sliceCount = Math.max(1, Math.ceil(opts.ticks / sliceTicks));
  let tip: HTMLElement | null = null;
  const hideTip = (): void => {
    tip?.remove();
    tip = null;
  };
  const describe = (m: ReplayMark): string => {
    const who = opts.nameOf(m.unitId);
    const by = opts.nameOf(m.killerId);
    switch (m.kind) {
      case 'kill':
        return `${by} killed ${who}`;
      case 'tower':
        return `a tower fell to ${by}`;
      case 'sanctum':
        return `the Sanctum fell to ${by}`;
      case 'warden':
        return `${by} slew the Warden`;
      case 'creature':
        return `${by} slew the ${m.creature ? creatureName(m.creature, m.ascendant === true) : 'ring creature'}`;
      case 'wrath':
        return `${m.team === 0 ? 'Blue' : 'Red'} holds the Wrath${m.creature ? ` (${creatureName(m.creature, true)})` : ''}`;
    }
  };
  const drawMarks = (marks: readonly ReplayMark[], ownUnitId: number | null): void => {
    slices.textContent = '';
    hideTip();
    const bySlice: ReplayMark[][] = Array.from({ length: sliceCount }, () => []);
    for (const m of marks) {
      const i = Math.min(sliceCount - 1, Math.floor(m.tick / sliceTicks));
      bySlice[i]!.push(m);
    }
    const most = Math.max(1, ...bySlice.map((s) => s.filter((m) => m.kind === 'kill').length));
    bySlice.forEach((list, i) => {
      const slice = document.createElement('div');
      slice.className = 'replay-slice';
      const kills = list.filter((m) => m.kind === 'kill');
      if (kills.length > 0) {
        const heat = document.createElement('div');
        const blue = kills.some((m) => m.team === 0);
        const red = kills.some((m) => m.team === 1);
        heat.className = `replay-heat ${blue && red ? 'mixed' : blue ? 'blue' : 'red'}`;
        heat.style.height = `${Math.round((4 + (14 * kills.length) / most) * 10) / 10}px`;
        heat.style.opacity = String(0.45 + (0.55 * kills.length) / most);
        slice.appendChild(heat);
      }
      for (const m of list) {
        const own = m.kind === 'kill' && ownUnitId !== null && m.unitId === ownUnitId;
        if (m.kind === 'kill' && !own) continue;
        const tick = document.createElement('div');
        tick.className = `replay-tick ${own ? 'own' : m.kind}`;
        tick.style.left = `${((m.tick - i * sliceTicks) / sliceTicks) * 100}%`;
        slice.appendChild(tick);
      }
      slice.addEventListener('click', () => opts.onSeek(i * sliceTicks));
      slice.addEventListener('mouseenter', () => {
        hideTip();
        if (list.length === 0) return;
        tip = document.createElement('div');
        tip.className = 'replay-tip';
        const lines = list.slice(0, 8).map((m) => `${fmtClock(m.tick)} ${describe(m)}`);
        if (list.length > 8) lines.push(`and ${list.length - 8} more`);
        tip.innerHTML = '';
        for (const line of lines) {
          const div = document.createElement('div');
          const t = document.createElement('span');
          t.className = 't';
          t.textContent = line.slice(0, line.indexOf(' '));
          div.append(t, document.createTextNode(line.slice(line.indexOf(' '))));
          tip.appendChild(div);
        }
        slice.appendChild(tip);
      });
      slice.addEventListener('mouseleave', hideTip);
      slices.appendChild(slice);
    });
  };

  // --- where the bar sits (replay_bar_place.ts) -------------------------

  // The default: measured against the HUD's own bottom block, so the bar
  // never lands on the champion's health, mana or gold whatever the
  // screen. Re-measured on resize, until the viewer moves it themselves.
  const dock = (): void => {
    if (moved) return;
    const hud = document.querySelector('.hud-bottom');
    const height = hud instanceof HTMLElement ? hud.getBoundingClientRect().height : 0;
    bar.style.bottom = `${dockedBottom(height)}px`;
  };

  const store = (): void => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        writePrefs({ ...(moved ? { at: moved } : {}), ...(collapsed ? { collapsed } : {}) }),
      );
    } catch {
      // A browser that refuses storage still gets the bar, just not the
      // memory of where it was put.
    }
  };

  // Put the bar back where it was left, brought inside the window in case
  // it has shrunk since.
  const applyMoved = (): void => {
    if (!moved) {
      bar.classList.remove('moved');
      dock();
      return;
    }
    const view = bar.parentElement?.getBoundingClientRect();
    const rect = bar.getBoundingClientRect();
    const at = clampToView(
      moved,
      { w: rect.width, h: rect.height },
      { w: view?.width ?? window.innerWidth, h: view?.height ?? window.innerHeight },
    );
    moved = at;
    bar.classList.add('moved');
    // The docked placement is an inline `bottom`, which would fight an
    // inline `top` and stretch the bar between the two: it goes first.
    bar.style.bottom = '';
    bar.style.left = `${at.x}px`;
    bar.style.top = `${at.y}px`;
  };

  const setCollapsed = (on: boolean): void => {
    collapsed = on;
    bar.classList.toggle('collapsed', on);
    fold.textContent = on ? 'Show' : 'Hide';
    fold.title = on ? 'Show the controls (H)' : 'Hide the controls (H)';
    // Folding changes the bar's height, so a docked bar re-measures and a
    // moved one is brought back inside the window.
    applyMoved();
    store();
  };

  // Dragged by its badge, pointer events so a touch screen can do it too.
  badge.addEventListener('pointerdown', (e) => {
    const rect = bar.getBoundingClientRect();
    const view = bar.parentElement?.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const originX = view?.left ?? 0;
    const originY = view?.top ?? 0;
    badge.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    const move = (m: PointerEvent): void => {
      moved = { x: m.clientX - originX - offX, y: m.clientY - originY - offY };
      applyMoved();
    };
    const up = (): void => {
      bar.classList.remove('dragging');
      badge.removeEventListener('pointermove', move);
      badge.removeEventListener('pointerup', up);
      store();
    };
    badge.addEventListener('pointermove', move);
    badge.addEventListener('pointerup', up);
    e.preventDefault();
  });
  // Lost it? Double-click the badge and it goes home.
  badge.addEventListener('dblclick', () => {
    moved = null;
    bar.classList.remove('moved');
    bar.style.left = '';
    bar.style.top = '';
    dock();
    store();
  });
  const onResize = (): void => {
    applyMoved();
  };
  window.addEventListener('resize', onResize);

  // The keys, ahead of the match's own input layer (space recenters the
  // camera there; in a replay it pauses). Typing anywhere is left alone.
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const long = e.shiftKey ? SEEK_LONG_STEP_S : SEEK_STEP_S;
    let handled = true;
    switch (e.key) {
      case 'j':
      case 'J':
        setSpeed(nextSpeed(speedNow, 'back'), true);
        break;
      case 'k':
      case 'K':
      case ' ':
        setSpeed(speedNow === 0 ? 1 : 0, true);
        break;
      case 'l':
      case 'L':
        setSpeed(nextSpeed(speedNow, 'forward'), true);
        break;
      case 'ArrowLeft':
        opts.onSeek(current - long * TICKS_PER_S);
        break;
      case 'ArrowRight':
        opts.onSeek(current + long * TICKS_PER_S);
        break;
      case 'h':
      case 'H':
        setCollapsed(!collapsed);
        break;
      case ',':
        if (speedNow === 0) opts.onStep(-1);
        break;
      case '.':
        if (speedNow === 0) opts.onStep(1);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);

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
  // The bar is measured once it is in the document: the caller appends it
  // right after this returns, so the first placement waits a frame.
  requestAnimationFrame(() => {
    setCollapsed(collapsed);
    applyMoved();
  });
  return {
    el: bar,
    setTime,
    setSpeed: (mult) => setSpeed(mult, false),
    setMarks: drawMarks,
    setCovered: (tick) => {
      covered.style.width = `${Math.min(100, (tick / Math.max(1, opts.ticks)) * 100)}%`;
    },
    dispose: () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      hideTip();
      bar.remove();
    },
  };
}

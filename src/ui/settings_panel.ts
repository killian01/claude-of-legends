// The shared settings panel: two volume sliders, the announcer toggle and
// the interface size, and on a touchscreen the way it plays and what an
// upright phone gets, wired straight to src/game/settings. Mounted by the
// home screen and by the in-match escape menu; both get live-applying
// controls.

import { getSettings, updateSettings } from '../game/settings';
import { UI_SCALE_CHOICES, type UiScaleSetting } from '../game/ui_scale';

const CSS = `
.set-panel { display: flex; flex-direction: column; gap: 10px; margin: 8px 0; text-align: left; }
.set-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #c9d8ae; }
.set-row label { width: 110px; flex: none; }
.set-row input[type='range'] { flex: 1; accent-color: #c9a84a; }
.set-row .set-val { width: 40px; text-align: right; color: #93a87c; font-variant-numeric: tabular-nums; }
.set-row input[type='checkbox'] { width: 16px; height: 16px; accent-color: #c9a84a; }
.set-row select {
  flex: 1; padding: 4px 6px; border-radius: 4px; border: 1px solid #466030;
  background: #101a0c; color: #d8e6c0; font: inherit;
}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function sliderRow(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = String(Math.round(value * 100));
  const val = document.createElement('span');
  val.className = 'set-val';
  val.textContent = `${input.value}%`;
  input.addEventListener('input', () => {
    val.textContent = `${input.value}%`;
    onChange(Number(input.value) / 100);
  });
  row.append(lab, input, val);
  return row;
}

export function buildSettingsPanel(): HTMLElement {
  ensureCss();
  const s = getSettings();
  const panel = document.createElement('div');
  panel.className = 'set-panel';
  panel.appendChild(sliderRow('Sound effects', s.sfx, (v) => updateSettings({ sfx: v })));
  panel.appendChild(sliderRow('Music', s.music, (v) => updateSettings({ music: v })));
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'Announcer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = s.announcer;
  box.addEventListener('change', () => updateSettings({ announcer: box.checked }));
  row.append(lab, box);
  panel.appendChild(row);
  panel.appendChild(scaleRow(s.uiScale));
  // Only a touchscreen has a way to play by thumb, or a phone to hold
  // upright; a mouse never sees the rows.
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    panel.appendChild(touchRow(s.touchScheme));
    panel.appendChild(uprightRow(s.rotatedView));
  } else {
    // A mouse or a trackpad: whether a left click walks and attacks too.
    panel.appendChild(leftClickRow(s.leftClickMoves));
  }
  panel.appendChild(stepsRow(!s.stepsOff));
  return panel;
}

// The first steps (ui/first_steps.ts): hidden from the match with its own
// button, brought back here, from its first step, for a match that starts
// after.
function stepsRow(on: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'First steps guide';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () =>
    updateSettings(box.checked ? { stepsOff: false, stepsDone: [] } : { stepsOff: true }),
  );
  row.append(lab, box);
  return row;
}

function leftClickRow(on: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'Left click moves';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () => updateSettings({ leftClickMoves: box.checked }));
  row.append(lab, box);
  return row;
}

// A phone held upright that the browser will not turn (game/rotated_view.ts):
// the match turned a quarter so it plays sideways, or the wall asking for
// the phone to be turned. Applied at once, the match on screen included.
function uprightRow(rotated: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'Held upright';
  const select = document.createElement('select');
  for (const [v, text] of [
    ['turn', 'Turn the match'],
    ['ask', 'Ask me to turn'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = text;
    select.appendChild(opt);
  }
  select.value = rotated ? 'turn' : 'ask';
  select.addEventListener('change', () => {
    updateSettings({ rotatedView: select.value !== 'ask' });
  });
  row.append(lab, select);
  return row;
}

function touchRow(value: 'thumbs' | 'tap'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'Touch controls';
  const select = document.createElement('select');
  for (const [v, text] of [
    ['thumbs', 'Thumb stick'],
    ['tap', 'Tap to walk'],
  ] as const) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = text;
    select.appendChild(opt);
  }
  select.value = value;
  select.addEventListener('change', () => {
    updateSettings({ touchScheme: select.value === 'tap' ? 'tap' : 'thumbs' });
  });
  row.append(lab, select);
  return row;
}

// The interface size: the rule, or one of a few multipliers. A select
// rather than a slider, because the sizes that read well are few and a
// slider invites setting a HUD too big to see the map behind.
function scaleRow(value: UiScaleSetting): HTMLElement {
  const row = document.createElement('div');
  row.className = 'set-row';
  const lab = document.createElement('label');
  lab.textContent = 'Interface size';
  const select = document.createElement('select');
  const add = (v: string, text: string): void => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = text;
    select.appendChild(opt);
  };
  add('auto', 'Auto (fits the screen)');
  for (const c of UI_SCALE_CHOICES) add(String(c), `${Math.round(c * 100)}%`);
  select.value = value === 'auto' ? 'auto' : String(value);
  select.addEventListener('change', () => {
    updateSettings({ uiScale: select.value === 'auto' ? 'auto' : Number(select.value) });
  });
  row.append(lab, select);
  return row;
}

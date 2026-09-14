// The shared settings panel: two volume sliders, the announcer toggle and
// the interface size, wired straight to src/game/settings. Mounted by the
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
  return panel;
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

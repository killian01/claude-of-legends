// The shared settings panel: two volume sliders and the announcer toggle,
// wired straight to src/game/settings. Mounted by the home screen and by
// the in-match escape menu; both get live-applying controls.

import { getSettings, updateSettings } from '../game/settings';

const CSS = `
.set-panel { display: flex; flex-direction: column; gap: 10px; margin: 8px 0; text-align: left; }
.set-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #c9d8ae; }
.set-row label { width: 110px; flex: none; }
.set-row input[type='range'] { flex: 1; accent-color: #c9a84a; }
.set-row .set-val { width: 40px; text-align: right; color: #93a87c; font-variant-numeric: tabular-nums; }
.set-row input[type='checkbox'] { width: 16px; height: 16px; accent-color: #c9a84a; }
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
  return panel;
}

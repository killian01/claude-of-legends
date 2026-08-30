// One shared tooltip element for the whole UI: attach it to any element with
// a lazy line provider; content is computed at hover time so it always
// reflects live data.
//
// Two pointer worlds: with a mouse the tip follows hover (mouseenter and
// mouseleave). On touchscreens hover does not exist and a tap synthesizes a
// mouseenter with no mouseleave to ever clear it, which left the tip parked
// over the game; there the tip shows only while a finger stays pressed on
// the anchor (a long press), and hides the moment it lifts.

import { setRichLine } from './rich_text';

// How long a finger must rest on an anchor before the tip shows. Shared
// with the HUD so a slot press past this reads the spell instead of arming.
export const LONG_PRESS_MS = 450;

const COARSE_POINTER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

let tip: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.style.cssText =
    'position:fixed;z-index:30;max-width:300px;background:rgba(10,14,6,0.97);' +
    'border:1px solid #7ca050;border-radius:6px;padding:8px 10px;color:#e4efce;' +
    'font-family:system-ui,sans-serif;font-size:12px;line-height:1.45;' +
    'pointer-events:none;display:none;';
  document.body.appendChild(tip);
  return tip;
}

// For screen teardown: a hovered anchor removed from the DOM never fires
// mouseleave, which would leave the shared tip stuck on screen forever.
export function hideTooltip(): void {
  if (tip) tip.style.display = 'none';
}

function showTooltip(el: HTMLElement, lines: () => readonly string[]): void {
  const t = ensureTip();
  t.textContent = '';
  const content = lines();
  content.forEach((line, i) => {
    const row = document.createElement('div');
    // Lines are generated rich text (ui/describe.ts + rich_text.ts):
    // built from the repo's own data records, never from user input.
    setRichLine(row, line);
    if (i === 0) row.style.cssText = 'font-weight:700;color:#f2ffd9;margin-bottom:2px;';
    t.appendChild(row);
  });
  if (content.length === 0) return;
  t.style.display = 'block';
  const rect = el.getBoundingClientRect();
  const tipRect = t.getBoundingClientRect();
  let x = rect.left + rect.width / 2 - tipRect.width / 2;
  x = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, x));
  let y = rect.top - tipRect.height - 8;
  if (y < 8) y = rect.bottom + 8;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}

export function attachTooltip(el: HTMLElement, lines: () => readonly string[]): void {
  if (COARSE_POINTER) {
    // Touch: show while held, hide on lift, and never on the synthesized
    // mouse events a tap produces (no mouse listeners at all).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      hideTooltip();
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => showTooltip(el, lines), LONG_PRESS_MS);
    });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('pointerleave', clear);
    return;
  }
  el.addEventListener('mouseenter', () => showTooltip(el, lines));
  el.addEventListener('mouseleave', hideTooltip);
}

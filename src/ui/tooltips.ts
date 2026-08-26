// One shared tooltip element for the whole UI: attach it to any element with
// a lazy line provider; content is computed at hover time so it always
// reflects live data.

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

export function attachTooltip(el: HTMLElement, lines: () => readonly string[]): void {
  el.addEventListener('mouseenter', () => {
    const t = ensureTip();
    t.textContent = '';
    const content = lines();
    content.forEach((line, i) => {
      const row = document.createElement('div');
      row.textContent = line;
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
  });
  el.addEventListener('mouseleave', () => {
    if (tip) tip.style.display = 'none';
  });
}

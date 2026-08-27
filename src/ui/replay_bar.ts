// The replay control bar: a REPLAY badge, pause, playback speeds, and the
// way out. Pure DOM; src/main.ts reads the chosen speed through onSpeed.

const CSS = `
.replay-bar {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; align-items: center; z-index: 11;
  background: rgba(10, 15, 7, 0.88); border: 1px solid #6b5a2e; border-radius: 8px;
  padding: 6px 10px; pointer-events: auto; font-family: system-ui, sans-serif;
}
.replay-badge { color: #c9a84a; font-weight: 800; font-size: 12px; letter-spacing: 2px; margin-right: 4px; }
.replay-btn {
  padding: 5px 12px; border-radius: 6px; border: 1px solid #466030;
  background: #1d2a14; color: #d8e6c0; font-size: 12px; font-weight: 600; cursor: pointer;
}
.replay-btn:hover { border-color: #7ca050; }
.replay-btn.on { background: #2c4a1c; border-color: #a3c96a; color: #e8f5c8; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function buildReplayBar(opts: {
  onSpeed: (mult: number) => void;
  onExit: () => void;
}): HTMLElement {
  ensureCss();
  const bar = document.createElement('div');
  bar.className = 'replay-bar';
  const badge = document.createElement('span');
  badge.className = 'replay-badge';
  badge.textContent = 'REPLAY';
  bar.appendChild(badge);

  const speedBtns: HTMLButtonElement[] = [];
  const mk = (label: string, mult: number): void => {
    const b = document.createElement('button');
    b.className = 'replay-btn';
    b.textContent = label;
    b.addEventListener('click', () => {
      opts.onSpeed(mult);
      for (const s of speedBtns) s.classList.toggle('on', s === b);
    });
    speedBtns.push(b);
    bar.appendChild(b);
  };
  mk('Pause', 0);
  mk('1x', 1);
  mk('2x', 2);
  mk('4x', 4);
  speedBtns[1]?.classList.add('on');

  const exit = document.createElement('button');
  exit.className = 'replay-btn';
  exit.textContent = 'Exit replay';
  exit.addEventListener('click', opts.onExit);
  bar.appendChild(exit);
  return bar;
}

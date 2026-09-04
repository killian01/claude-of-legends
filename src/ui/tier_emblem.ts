// The tier emblem (CONTEXT.md: Emblem): one image per tier, the same
// everywhere a tier shows. The art lives in public/icons/tiers/ (see
// docs/design/tier-emblem-prompts.md); until a file lands, the banner is
// drawn in CSS with the tier's color and one pip per tier climbed, so the
// page reads the same with or without the art.

import { TIERS, type Tier } from '../net/tiers';

export interface TierStyle {
  // The banner's fill and its edge.
  color: string;
  edge: string;
  // A halo, on the top tier only.
  glow: string | null;
  // Pips drawn inside the CSS banner: the tiers climbed past the Recruit.
  pips: number;
}

const STYLES: Readonly<Record<string, Omit<TierStyle, 'pips'>>> = {
  Recruit: { color: '#5d5346', edge: '#8a7a63', glow: null },
  Regular: { color: '#6f7f8f', edge: '#a7b6c4', glow: null },
  Veteran: { color: '#a0522d', edge: '#d98a5c', glow: null },
  Elite: { color: '#b8912e', edge: '#f2d27a', glow: null },
  Legend: { color: '#d9c47a', edge: '#fff6d2', glow: 'rgba(255, 230, 150, 0.55)' },
};

export function tierIndex(name: string): number {
  const i = TIERS.findIndex((t) => t.name === name);
  return i === -1 ? 0 : i;
}

export function tierStyle(name: string): TierStyle {
  const base = STYLES[name] ?? STYLES.Recruit!;
  return { ...base, pips: tierIndex(name) };
}

export function emblemArtUrl(name: string): string {
  return `/icons/tiers/${name.toLowerCase()}.webp`;
}

const CSS = `
.te { position: relative; display: inline-block; flex: none; vertical-align: middle; }
.te-banner {
  position: absolute; inset: 0;
  clip-path: polygon(0 0, 100% 0, 100% 74%, 50% 100%, 0 74%);
  display: flex; align-items: flex-start; justify-content: center; gap: 8%;
  padding-top: 18%;
}
.te-pip { width: 14%; height: 14%; border-radius: 50%; background: rgba(255, 255, 255, 0.85); }
.te-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: none; }
.te.has-art .te-art { display: block; }
.te.has-art .te-banner { display: none; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The emblem at `size` pixels: the art when the file is there, the CSS
// banner otherwise, the swap happening only once the art has loaded.
export function emblem(tier: Tier | string, size: number): HTMLElement {
  ensureCss();
  const name = typeof tier === 'string' ? tier : tier.name;
  const st = tierStyle(name);
  const box = document.createElement('span');
  box.className = 'te';
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.title = name;
  const banner = document.createElement('span');
  banner.className = 'te-banner';
  banner.style.background = `linear-gradient(180deg, ${st.edge} 0%, ${st.color} 45%, ${st.color} 100%)`;
  banner.style.boxShadow = `inset 0 0 0 ${Math.max(1, Math.round(size / 24))}px ${st.edge}`;
  for (let i = 0; i < st.pips; i++) {
    const pip = document.createElement('span');
    pip.className = 'te-pip';
    banner.appendChild(pip);
  }
  if (st.glow) box.style.filter = `drop-shadow(0 0 ${Math.round(size / 6)}px ${st.glow})`;
  const art = document.createElement('img');
  art.className = 'te-art';
  art.alt = name;
  art.addEventListener('load', () => box.classList.add('has-art'));
  art.src = emblemArtUrl(name);
  box.append(banner, art);
  return box;
}

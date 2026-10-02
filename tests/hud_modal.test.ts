// The pause menu and the end screen take every click (src/ui/hud.ts): the
// settings inside the pause menu took none on a computer, so a click on one
// fell through to the match and walked the champion there (the maintainer,
// 2026-10-02, ticking the first steps back on). The wash over a dead
// champion still lets every click through, to the shop that stays usable.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the HUD overlays', () => {
  const hud = readFileSync(path.join(ROOT, 'src/ui/hud.ts'), 'utf8');
  const rule = (selector: string): string => {
    const at = hud.indexOf(`${selector} {`);
    return at === -1 ? '' : hud.slice(at, hud.indexOf('}', at));
  };

  it('take every click in the pause menu and the end screen', () => {
    expect(rule('.hud-overlay.modal')).toMatch(/pointer-events: auto/);
    expect(hud).toContain("this.escapeOverlay = el('div', 'hud-overlay modal')");
    expect(hud).toContain("this.endOverlay = el('div', 'hud-overlay modal')");
  });

  it('let every click through the wash over a dead champion', () => {
    expect(rule('.hud-overlay')).toMatch(/pointer-events: none/);
    expect(hud).toContain("this.deathOverlay = el('div', 'hud-overlay')");
  });
});

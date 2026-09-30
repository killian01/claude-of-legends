// The card a lost picture puts over the match (src/render/picture_watch.ts
// says what it reads): in the middle of the black canvas, under the HUD
// (z-index 6), so the pause menu and its Leave match stay on top and in
// reach. Its Reload is the player's own choice, so it does not ask again
// on the way out.

import { reloadWithoutAsking } from '../game/nav';
import type { PictureNotice } from '../render/picture_watch';

export interface PictureNoticeView {
  show(notice: PictureNotice | null): void;
  dispose(): void;
}

export function buildPictureNotice(
  container: HTMLElement,
  reload: () => void = () => reloadWithoutAsking(),
): PictureNoticeView {
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'padding:16px;pointer-events:none;z-index:5;';
  const card = document.createElement('div');
  card.setAttribute('role', 'status');
  card.style.cssText =
    'max-width:min(380px,100%);padding:16px 20px;border-radius:10px;text-align:center;' +
    'background:rgba(10,17,32,0.92);border:1px solid rgba(184,155,62,0.6);' +
    'box-shadow:0 18px 50px rgba(0,0,0,0.6);color:#e8e2d0;' +
    'font:14px/1.45 system-ui,sans-serif;pointer-events:auto;';
  const title = document.createElement('div');
  title.style.cssText = "font:600 18px/1.3 'Cinzel',Georgia,serif;color:#f0d890;margin-bottom:6px;";
  const line = document.createElement('div');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Reload';
  button.style.cssText =
    'margin-top:12px;min-height:44px;min-width:120px;padding:0 18px;border-radius:22px;' +
    'border:1px solid #b89b3e;background:linear-gradient(180deg,#e8c862,#b8902e);' +
    'color:#1a1206;font:600 15px system-ui,sans-serif;cursor:pointer;';
  button.addEventListener('click', () => reload());
  card.append(title, line, button);
  root.append(card);
  container.append(root);
  return {
    show: (notice) => {
      root.style.display = notice === null ? 'none' : 'flex';
      if (notice === null) return;
      title.textContent = notice.title;
      line.textContent = notice.line;
      button.style.display = notice.reload ? '' : 'none';
    },
    dispose: () => root.remove(),
  };
}

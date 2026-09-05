// The strip the home wears once, on the page load that just created an
// account through Discord (ADR 0009).
//
// The signal already existed and was thrown away: the callback sends the
// browser back with ?discord=created, discord_entry.ts reads it, and
// nothing but the failure case ever had a screen to land on. This is the
// one moment where offering the server costs the player nothing: they are
// demonstrably a Discord user, they are already signed in, and the invite
// is one click rather than a search.
//
// 'signedin' gets nothing. Somebody coming back for their tenth match has
// already decided about the server, and a strip on every return is how a
// welcome turns into noise.

import type { DiscordResult } from './discord_entry';
import { DISCORD } from './links';
import { el, ensureMenuCss } from './menu';

const CSS = `
.dsw-note {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  border: 1px solid #5a61b8; border-radius: 8px; padding: 8px 14px;
  background: rgba(24, 26, 56, 0.62); backdrop-filter: blur(7px);
  margin: 10px 0 0; font-size: 12px; line-height: 1.4; color: #c3c9ea;
}
.dsw-note b { color: #e6e9ff; }
.dsw-note a {
  font-weight: 700; color: #aeb6f5; text-decoration: underline; text-underline-offset: 3px;
}
.dsw-note a:hover { color: #dfe3ff; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  ensureMenuCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// Only the account that was just created, and only on the load that made
// it. Kept apart from the DOM so the rule can be read and tested on its
// own.
export function welcomesToDiscord(result: DiscordResult | null): boolean {
  return result === 'created' || result === 'joined';
}

// The same strip says two different things. 'joined' means the auto-join
// already put this person in the server, so inviting them again would be
// nonsense: the link becomes a door rather than an invitation.
export function welcomeWords(result: 'created' | 'joined'): {
  lead: string;
  said: string;
  link: string;
} {
  return result === 'joined'
    ? {
        lead: 'Your account is ready, and you are in the Discord.',
        said: 'That is where players find each other for a game, and where the next build gets argued about.',
        link: 'Open the server',
      }
    : {
        lead: 'Your account is ready.',
        said: 'You came in through Discord, so the server is one click away: it is where players find each other for a game.',
        link: 'Join the Discord',
      };
}

export function buildDiscordWelcome(result: DiscordResult | null): HTMLElement | null {
  if (!welcomesToDiscord(result)) return null;
  ensureCss();
  const words = welcomeWords(result as 'created' | 'joined');
  const note = el('div', 'dsw-note');
  const link = document.createElement('a');
  link.href = DISCORD;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = words.link;
  note.append(el('b', '', words.lead), el('span', '', words.said), link);
  return note;
}

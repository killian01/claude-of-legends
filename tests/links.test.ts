// The two links that leave the game, and the one rule about when the
// Discord welcome shows. Small, but the failure mode is expensive: a
// truncated or placeholder invite ships to three screens at once and
// nothing in the client can tell that it is dead.

import { describe, expect, it } from 'vitest';
import { welcomesToDiscord } from '../src/ui/discord_welcome';
import { DISCORD, REPO } from '../src/ui/links';

describe('the outward links', () => {
  it('point at a real invite and a real repository', () => {
    expect(DISCORD).toMatch(/^https:\/\/discord\.gg\/[A-Za-z0-9]{6,}$/);
    expect(REPO).toBe('https://github.com/killian01/claude-of-legends');
  });
});

describe('the Discord welcome', () => {
  it('greets the account that was just created, and nobody else', () => {
    expect(welcomesToDiscord('created')).toBe(true);
    // A player coming back for their tenth match has already decided.
    expect(welcomesToDiscord('signedin')).toBe(false);
    expect(welcomesToDiscord('failed')).toBe(false);
    expect(welcomesToDiscord('off')).toBe(false);
    expect(welcomesToDiscord(null)).toBe(false);
  });
});

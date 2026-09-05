// The two links that leave the game, and the one rule about when the
// Discord welcome shows. Small, but the failure mode is expensive: a
// truncated or placeholder invite ships to three screens at once and
// nothing in the client can tell that it is dead.

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { welcomesToDiscord, welcomeWords } from '../src/ui/discord_welcome';
import { DISCORD, REPO } from '../src/ui/links';

describe('the outward links', () => {
  it('point at a real invite and a real repository', () => {
    expect(DISCORD).toMatch(/^https:\/\/discord\.gg\/[A-Za-z0-9]{6,}$/);
    expect(REPO).toBe('https://github.com/killian01/claude-of-legends');
  });

  // The invite is written in four places the client cannot see: the README
  // badge and its nav, the closing invitation, and the issue chooser. An
  // invite that gets revoked and reissued is exactly the change that
  // updates the one the tests read and leaves the other four dead.
  it('spell the same invite everywhere the repository says Discord', () => {
    const out = execFileSync('git', ['grep', '-hoI', 'https://discord\\.gg/[A-Za-z0-9]*'], {
      encoding: 'utf8',
    });
    const found = [...new Set(out.split('\n').filter(Boolean))];
    expect(found).toEqual([DISCORD]);
  });
});

describe('the Discord welcome', () => {
  it('greets the account that was just created, and nobody else', () => {
    expect(welcomesToDiscord('created')).toBe(true);
    expect(welcomesToDiscord('joined')).toBe(true);
    // A player coming back for their tenth match has already decided.
    expect(welcomesToDiscord('signedin')).toBe(false);
    expect(welcomesToDiscord('failed')).toBe(false);
    expect(welcomesToDiscord('off')).toBe(false);
    expect(welcomesToDiscord(null)).toBe(false);
  });

  it('stops inviting somebody the auto-join already let in', () => {
    // Being asked to join a server you are standing in reads as a bug.
    expect(welcomeWords('created').link).toBe('Join the Discord');
    expect(welcomeWords('joined').link).toBe('Open the server');
    expect(welcomeWords('joined').lead).toContain('you are in the Discord');
  });
});

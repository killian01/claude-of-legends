// Structural gate for the announcer's clips (public/voice/ over the table
// in src/game/voice_lines.ts). The bank degrades silently in both
// directions: a line without a clip reads through speech synthesis
// forever, and a clip without a line ships for nothing. Both are caught
// here, along with the script's view of the table (scripts/build_voice.mjs
// --list), the git-lfs tracking (a clone without it holds pointer text
// that decodes to nothing) and the size budget.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PENDING_VOICE_LINES,
  RECORDED_VOICE_LINE_IDS,
  VOICE_LINE_IDS,
  VOICE_LINES,
  type VoiceLineId,
  voiceClipUrl,
} from '../src/game/voice_lines';

const DIR = join(process.cwd(), 'public', 'voice');
const FILE_MAX_KB = 120;
const BANK_MAX_KB = 1200;

// An mp3 opens with an ID3 tag or a frame sync; a git-lfs pointer is text.
function looksLikeMp3(head: Buffer): boolean {
  if (head.subarray(0, 3).toString('latin1') === 'ID3') return true;
  return head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0;
}

function isLfsPointer(head: Buffer): boolean {
  return head.toString('latin1').startsWith('version https://git-lfs.github.com/spec/');
}

describe('the announcer clips', () => {
  it('has exactly one clip on disk per recorded line', () => {
    const expected = RECORDED_VOICE_LINE_IDS.map((id) => `${id}.mp3`).sort();
    const onDisk = readdirSync(DIR)
      .filter((f) => f.endsWith('.mp3'))
      .sort();
    expect(onDisk).toEqual(expected);
  });

  it('lists a line as pending only while its clip is missing, and few of them', () => {
    // The speech synthesis reads a pending line; a clip that has landed
    // must leave the list the same commit, so nobody ships a recording the
    // bank never plays.
    for (const id of PENDING_VOICE_LINES) {
      expect(VOICE_LINE_IDS, id).toContain(id);
      expect(existsSync(join(DIR, `${id}.mp3`)), `${id}.mp3 exists: drop it from pending`).toBe(
        false,
      );
    }
    expect(PENDING_VOICE_LINES.length).toBeLessThanOrEqual(6);
  });

  it('holds real audio, not git-lfs pointers', () => {
    for (const id of RECORDED_VOICE_LINE_IDS) {
      const head = readFileSync(join(DIR, `${id}.mp3`)).subarray(0, 64);
      expect(isLfsPointer(head), `${id}.mp3 is a git-lfs pointer: run git lfs pull`).toBe(false);
      expect(looksLikeMp3(head), `${id}.mp3 does not open like an mp3`).toBe(true);
    }
  });

  it('stays inside the size budget', () => {
    let total = 0;
    for (const id of RECORDED_VOICE_LINE_IDS) {
      const size = statSync(join(DIR, `${id}.mp3`)).size;
      expect(size, id).toBeLessThan(FILE_MAX_KB * 1024);
      total += size;
    }
    expect(total).toBeLessThan(BANK_MAX_KB * 1024);
  });

  it('is tracked with git-lfs', () => {
    const attrs = readFileSync(join(process.cwd(), '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^public\/voice\/\*\.mp3 filter=lfs diff=lfs merge=lfs -text$/m);
  });

  it('is served from the path the bank fetches', () => {
    expect(voiceClipUrl('victory')).toBe('/voice/victory.mp3');
  });

  it('is exactly what the render script renders', () => {
    const run = spawnSync(process.execPath, ['scripts/build_voice.mjs', '--list'], {
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const listed = run.stdout
      .trim()
      .split('\n')
      .map((l) => l.split('\t'));
    expect(listed.map(([id]) => id)).toEqual([...VOICE_LINE_IDS]);
    for (const [id, text] of listed) expect(text).toBe(VOICE_LINES[id as VoiceLineId]);
  });

  it('never has to say a champion or a player name', () => {
    // Every line is fixed text: nothing is spliced in at play time.
    for (const text of Object.values(VOICE_LINES)) expect(text).not.toMatch(/[{}$]/);
  });
});

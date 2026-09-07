// The model reference read by machine before a build spends on it
// (server/reference_check.ts, run at the build's classify stage): it
// refuses only what makes a model nobody can use, says what it saw, and
// never stops a build when it is the check itself that is broken.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import {
  checkReference,
  REFERENCE_REFUSAL,
  readVerdict,
  refusalMessage,
} from '../server/reference_check';
import type { SuggestDeps } from '../server/suggest';

function answer(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

// A one-pixel PNG: the bytes only have to be a real image header, since
// the model is a stub here.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

function deps(store: ForgeStore, fetchFn: typeof fetch, apiKey: string | null = 'k'): SuggestDeps {
  return { store, apiKey, assetsDir: 'A', fetchFn };
}

describe('readVerdict', () => {
  it('passes a single full-body figure, whatever else it noticed', () => {
    const v = readVerdict({
      figures: 1,
      fullBody: true,
      front: false,
      plainBackground: false,
      note: 'The background is busy and it is a three-quarter view.',
    });
    // A busy background and a turned pose cost quality, not usability:
    // they ride in the note and never refuse.
    expect(v.usable).toBe(true);
    expect(v.plainBackground).toBe(false);
    expect(v.note).toContain('background');
  });

  it('refuses more than one figure and a cropped body', () => {
    expect(readVerdict({ figures: 3, fullBody: true }).usable).toBe(false);
    expect(readVerdict({ figures: 1, fullBody: false }).usable).toBe(false);
  });

  it('passes when it could not tell: a doubt is not a refusal', () => {
    expect(readVerdict({}).usable).toBe(true);
    expect(readVerdict({ figures: 'two' }).usable).toBe(true);
    expect(readVerdict({ figures: null }).figures).toBe(null);
  });
});

describe('refusalMessage', () => {
  it('names what it saw, the marker the editor reads, and the way past', () => {
    const many = refusalMessage(readVerdict({ figures: 2, fullBody: true, note: 'Two views.' }));
    expect(many.startsWith(REFERENCE_REFUSAL)).toBe(true);
    expect(many).toContain('2 figures');
    expect(many).toContain('Two views.');
    // What to do about it belongs to the panel with the buttons, not
    // here: two voices saying it reads as a stutter.
    expect(many).not.toContain('build anyway');
    const cropped = refusalMessage(readVerdict({ figures: 1, fullBody: false }));
    expect(cropped).toContain('cut off');
  });
});

describe('checkReference', () => {
  it('reads the model answer and sends the image up', async () => {
    const store = new ForgeStore(':memory:');
    let sent: { role: string; content: unknown }[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      sent = (JSON.parse(String(init?.body)) as { messages: typeof sent }).messages;
      return answer(
        '{"figures":2,"fullBody":true,"front":true,"plainBackground":true,"note":"A sheet."}',
      );
    };
    const v = await checkReference(deps(store, fetchFn), PNG);
    expect(v).toMatchObject({ usable: false, figures: 2, note: 'A sheet.' });
    const parts = sent[0]?.content as { type: string }[];
    expect(parts[0]?.type).toBe('image');
    expect(parts[1]?.type).toBe('text');
    store.close();
  });

  it('answers null without a key, on a broken call, and on a non-JSON answer', async () => {
    const store = new ForgeStore(':memory:');
    expect(
      await checkReference(
        deps(store, async () => answer('{}'), null),
        PNG,
      ),
    ).toBe(null);
    expect(
      await checkReference(
        deps(store, async () => {
          throw new Error('down');
        }),
        PNG,
      ),
    ).toBe(null);
    expect(
      await checkReference(
        deps(store, async () => answer('sure, looks fine')),
        PNG,
      ),
    ).toBe(null);
    store.close();
  });
});

// The coach (plan-bots phase 4): the answer streams, the comment is
// forwarded as it is written, every operation is validated here before it
// is forwarded, a refused one is reported and never retried behind the
// owner's back, and the outcome carries what applied.

import { describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import { type BotDeps, createBot } from '../server/bots';
import { type CoachDeps, type CoachProgress, coachPlaybook } from '../server/playbook_suggest';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';

// A Messages API stub answering with server-sent events, the text cut
// into pieces the way a real stream arrives, and recording the request.
function sseFetch(answer: string, pieces = 7): { fetchFn: typeof fetch; requests: unknown[] } {
  const requests: unknown[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const encoder = new TextEncoder();
    const size = Math.max(1, Math.ceil(answer.length / pieces));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < answer.length; i += size) {
          const ev = {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: answer.slice(i, i + size) },
          };
          controller.enqueue(
            encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(ev)}\n\n`),
          );
        }
        controller.enqueue(
          encoder.encode(
            `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetchFn, requests };
}

function rig(answer: string): { deps: CoachDeps; botId: string; requests: unknown[] } {
  const store = new BotStore(':memory:');
  const botDeps: BotDeps = { store, newId: () => 'bot_00000000000000aa', now: () => 1 };
  const made = createBot(botDeps, 1, { name: 'Nightfall', championId: 'vesk' });
  if (!made.ok) throw new Error(made.error);
  const { fetchFn, requests } = sseFetch(answer);
  return { deps: { store, apiKey: 'test-key', fetchFn }, botId: made.bot.id, requests };
}

const ANSWER = [
  '# Plus prudent sous les tours, et le Warden compte davantage.',
  JSON.stringify({
    op: 'set',
    id: 'avoid-tower',
    play: { do: { kind: 'avoidTower', hpBelow: 0.8 } },
  }),
  JSON.stringify({ op: 'move', id: 'warden', before: 'fight' }),
  JSON.stringify({ op: 'remove', id: 'nope' }),
  'not json at all',
  JSON.stringify({
    op: 'add',
    play: { id: 'safe-farm', when: { kind: 'hp', below: 0.5 }, do: { kind: 'farm' } },
    before: 'fight',
  }),
].join('\n');

describe('the coach', () => {
  it('streams the comment, applies valid operations as they arrive, refuses the rest', async () => {
    const { deps, botId } = rig(ANSWER);
    const progress: CoachProgress[] = [];
    const out = await coachPlaybook(deps, 1, {
      id: botId,
      messages: [{ role: 'user', text: 'sois plus prudent' }],
      onProgress: (p) => progress.push(p),
    });
    if (!out.ok) throw new Error(out.error);
    expect(out.comment).toBe('Plus prudent sous les tours, et le Warden compte davantage.');
    expect(out.ops.map((o) => o.op)).toEqual(['set', 'move', 'add']);
    expect(out.refused.map((r) => r.error)).toEqual([
      expect.stringMatching(/no play named "nope"/),
      'not a patch operation',
    ]);
    const ids = out.playbook.plays.map((p) => p.id);
    expect(ids.indexOf('warden')).toBe(ids.indexOf('fight') - 2);
    expect(ids.indexOf('safe-farm')).toBe(ids.indexOf('fight') - 1);
    expect(out.playbook.plays.find((p) => p.id === 'avoid-tower')?.do).toEqual({
      kind: 'avoidTower',
      hpBelow: 0.8,
    });
    // The comment came in pieces, before any operation, and never with the
    // leading marker.
    const text = progress.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text);
    expect(text.length).toBeGreaterThan(1);
    expect(text.join('')).toBe(out.comment);
    expect(text.join('')).not.toMatch(/^#/);
    const kinds = progress.map((p) => p.kind);
    expect(kinds.indexOf('op')).toBeGreaterThan(kinds.lastIndexOf('text'));
    expect(kinds.filter((k) => k === 'refused').length).toBe(2);
    expect(out.raw).toBe(ANSWER);
  });

  it('asks once, at low effort for a patch and high for a rework, with the form state last', async () => {
    const { deps, botId, requests } = rig('# ok\n');
    await coachPlaybook(deps, 1, { id: botId, messages: [{ role: 'user', text: 'hi' }] });
    await coachPlaybook(deps, 1, {
      id: botId,
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: '# ok' },
        { role: 'user', text: 'rewrite it all' },
      ],
      depth: 'deep',
      playbook: {
        version: 1,
        plays: [{ id: 'push', when: { kind: 'always' }, do: { kind: 'push' } }],
      },
    });
    expect(requests).toHaveLength(2);
    const [quick, deep] = requests as {
      model: string;
      stream: boolean;
      output_config: { effort: string };
      messages: { role: string; content: string }[];
    }[];
    expect(quick!.model).toBe('claude-opus-5');
    expect(quick!.stream).toBe(true);
    expect(quick!.output_config.effort).toBe('low');
    expect(deep!.output_config.effort).toBe('high');
    expect(deep!.messages).toHaveLength(3);
    expect(deep!.messages[2]!.content).toMatch(/"id":"push"/);
    expect(deep!.messages[0]!.content).not.toMatch(/playbook on the form/);
  });

  it('answers honestly without a key, off the account, or with a broken form', async () => {
    const { deps, botId } = rig('# ok\n');
    const noKey = await coachPlaybook({ ...deps, apiKey: null }, 1, {
      id: botId,
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(!noKey.ok && noKey.error).toMatch(/not configured/);
    const stranger = await coachPlaybook(deps, 2, {
      id: botId,
      messages: [{ role: 'user', text: 'hi' }],
    });
    expect(!stranger.ok && stranger.error).toMatch(/no such bot/);
    const broken = await coachPlaybook(deps, 1, {
      id: botId,
      messages: [{ role: 'user', text: 'hi' }],
      playbook: { version: 1, plays: [] },
    });
    expect(!broken.ok && broken.error).toMatch(/not valid/);
    const badThread = await coachPlaybook(deps, 1, { id: botId, messages: [] });
    expect(badThread.ok).toBe(false);
  });

  it('keeps the stored playbook untouched: applying is the owner’s click', async () => {
    const { deps, botId } = rig(ANSWER);
    const out = await coachPlaybook(deps, 1, {
      id: botId,
      messages: [{ role: 'user', text: 'x' }],
    });
    expect(out.ok).toBe(true);
    expect(deps.store.getBot(botId)?.playbook).toEqual(LANER_PLAYBOOK);
  });
});

// The Forge's conversation panel, shared by the kit conversation (Spells
// tab) and the stat conversation (Tuning tab): a session-lived thread the
// client keeps and replays whole each turn, an answer that streams as
// NDJSON (the model's words as they come, the server's stages between
// calls) into a bubble that counts the wait out loud, and one input row
// with a way to start over. What a proposal IS and what applying it does
// belong to the caller: the panel owns the thread, the wait, and the
// wire. Nothing here touches the form.

export interface ChatTurnView {
  role: 'user' | 'assistant';
  // The wire text: the creator's words, or the model's raw answer,
  // replayed so it can iterate on its own proposals.
  text: string;
  // The short text the bubble shows.
  bubble: string;
}

export interface ChatState {
  turns: ChatTurnView[];
  // The unsent input, preserved across re-renders.
  draft: string;
  // True while a request is in flight, since when (wall clock: this is
  // presentation, not sim), what has streamed in so far (the raw answer
  // of the current call, the server's current stage), and the ticker
  // that keeps the wait bubble honest.
  inflight: boolean;
  startedAt: number;
  streamed: string;
  stage: string;
  timer: number | null;
  tick: (() => void) | null;
}

// A conversation as the server keeps it beside the draft: the turns and
// the latest proposal, per kind (server/forge_chats.ts).
export interface SavedChat {
  turns: ChatTurnView[];
  proposal: unknown;
}
export type SavedChats = Partial<Record<'kit' | 'stats', SavedChat>>;

export function newChatState(): ChatState {
  return {
    turns: [],
    draft: '',
    inflight: false,
    startedAt: 0,
    streamed: '',
    stage: '',
    timer: null,
    tick: null,
  };
}

// One line of a streamed answer: the model's own words as they arrive,
// or a stage the server announces between calls.
export interface ChatLine {
  progress?: 'text' | 'stage';
  text?: string;
}

// A POST whose answer streams as NDJSON, progress lines first and the
// outcome last. A plain JSON answer still lands as the outcome; a broken
// wire resolves null.
export async function chatStream<T>(
  url: string,
  body: unknown,
  onLine: (line: ChatLine) => void,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.body) return (await res.json()) as T;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let last: T | null = null;
    const take = (line: string): void => {
      if (line.trim() === '') return;
      const parsed = JSON.parse(line) as ChatLine;
      if (parsed.progress) onLine(parsed);
      else last = parsed as unknown as T;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let cut = pending.indexOf('\n');
      while (cut >= 0) {
        take(pending.slice(0, cut));
        pending = pending.slice(cut + 1);
        cut = pending.indexOf('\n');
      }
    }
    if (pending.trim() !== '') take(pending);
    return last;
  } catch {
    return null;
  }
}

// The comment as far as the model has written it: the first string of
// the answer, read out of the raw JSON while it is still incomplete.
export function commentSoFar(raw: string): string {
  const m = /"comment"\s*:\s*"/.exec(raw);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) break;
      out += next === 'n' ? ' ' : next;
      i += 1;
      continue;
    }
    if (ch === '"') break;
    out += ch;
  }
  return out;
}

// Which parts of the answer the model has reached so far, by their keys.
export function partsSoFar(raw: string, parts: readonly string[]): string[] {
  return parts.filter((key) => raw.includes(`"${key}":`));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface ChatPanelOpts<T> {
  title: string;
  lead: string;
  placeholder: string;
  // Why sending is off right now, shown under the row; null when live.
  locked: string | null;
  // The answer's parts the wait bubble announces as they arrive.
  parts: readonly string[];
  // Sends the thread; resolves with the outcome line, null on a broken wire.
  request(
    messages: readonly { role: 'user' | 'assistant'; text: string }[],
    onLine: (line: ChatLine) => void,
  ): Promise<T | null>;
  // Reads the outcome: the assistant turn to keep, or the error to report.
  // A rejected answer takes the creator's message back into the input,
  // so the thread matches what was actually answered.
  accept(result: T | null): { raw: string; bubble: string } | { error: string };
  report(message: string): void;
  rerender(): void;
  // The thread changed (an answer landed, or it was started over): the
  // caller persists it.
  changed?(): void;
}

export function chatPanel<T>(state: ChatState, opts: ChatPanelOpts<T>): HTMLElement {
  const panel = el('div', 'fe-panel');
  panel.append(el('h3', '', opts.title));
  panel.append(el('p', 'fe-lead', opts.lead));
  const log = el('div', 'fe-chatlog');
  if (state.turns.length === 0 && !state.inflight) {
    log.append(el('div', 'fe-step-text', 'No messages yet.'));
  }
  for (const turn of state.turns) {
    log.append(el('div', `fe-bubble ${turn.role === 'user' ? 'user' : 'ai'}`, turn.bubble));
  }
  if (state.inflight) {
    // The wait, counted out loud: a silent bubble reads as a hang.
    const bubble = el('div', 'fe-bubble ai', '');
    const tick = (): void => {
      const secs = Math.round((Date.now() - state.startedAt) / 1000);
      const comment = commentSoFar(state.streamed);
      const parts = partsSoFar(state.streamed, opts.parts);
      const writing = parts.length > 0 ? ` Writing: ${parts.join(', ')}.` : '';
      bubble.textContent =
        comment !== '' ? `${comment}${writing}` : `${state.stage || 'Thinking'}... ${secs} s`;
    };
    tick();
    state.tick = tick;
    if (state.timer !== null) window.clearInterval(state.timer);
    state.timer = window.setInterval(tick, 1000);
    log.append(bubble);
  }
  panel.append(log);
  const row = el('div', 'fe-chatrow');
  const input = el('input', 'fe-input') as HTMLInputElement;
  input.placeholder = opts.placeholder;
  input.maxLength = 2000;
  input.value = state.draft;
  input.addEventListener('input', () => {
    state.draft = input.value;
  });
  const send = el(
    'button',
    'fe-gen small',
    state.inflight ? 'Asking...' : 'Send',
  ) as HTMLButtonElement;
  send.disabled = opts.locked !== null || state.inflight;
  const submit = (): void => {
    const text = input.value.trim();
    if (text === '' || send.disabled) return;
    state.draft = '';
    state.turns.push({ role: 'user', text, bubble: text });
    state.inflight = true;
    state.startedAt = Date.now();
    state.streamed = '';
    state.stage = '';
    opts.rerender();
    void opts
      .request(
        state.turns.map((t) => ({ role: t.role, text: t.text })),
        (line) => {
          if (line.progress === 'stage') {
            state.stage = line.text ?? '';
            state.streamed = '';
          } else if (line.progress === 'text') {
            state.streamed += line.text ?? '';
          }
          state.tick?.();
        },
      )
      .then((r) => {
        state.inflight = false;
        state.streamed = '';
        state.stage = '';
        state.tick = null;
        if (state.timer !== null) {
          window.clearInterval(state.timer);
          state.timer = null;
        }
        const read = opts.accept(r);
        if ('error' in read) {
          state.turns.pop();
          state.draft = text;
          opts.report(read.error);
        } else {
          state.turns.push({ role: 'assistant', text: read.raw, bubble: read.bubble });
          opts.changed?.();
        }
        opts.rerender();
      });
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  row.append(input, send);
  if (state.turns.length > 0 && !state.inflight) {
    const clear = el('button', 'fe-mini', 'Start over') as HTMLButtonElement;
    clear.title = 'Forget this conversation (the proposal below stays)';
    clear.addEventListener('click', () => {
      state.turns.length = 0;
      opts.changed?.();
      opts.rerender();
    });
    row.append(clear);
  }
  panel.append(row);
  if (opts.locked !== null) panel.append(el('p', 'fe-desc', opts.locked));
  return panel;
}

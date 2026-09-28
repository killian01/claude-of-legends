// The feedback box: the one place a player is asked what to improve, at
// the two moments they are about to stop playing, the end screen and the
// pause menu. It says who is asking, because that is the whole reason it
// works: one person makes this, and a line from a stranger is what the
// counter cannot give. Nothing is required, and nothing blocks the way out.
//
// What is sent is what they typed and the shape of the match they typed it
// in (ui/hud.ts fills that in): no name, no account, nothing that points at
// anybody. PRIVACY.md says so. The words and the decisions are pure so a
// test reads them without a browser.

export const FEEDBACK_ROUTE = '/api/feedback';
export const FEEDBACK_VERSION = 1;
// Long enough for a paragraph, short enough that the route's body cap is
// never the thing a player meets.
export const FEEDBACK_MAX = 1000;

export const FEEDBACK_ASK = 'One person makes this game.';
export const FEEDBACK_CALL = 'What should I improve?';
export const FEEDBACK_PLACEHOLDER = 'What felt wrong, what is missing, what you would change.';
export const FEEDBACK_SEND = 'Send';
export const FEEDBACK_THANKS = 'Thank you. I read every one of these.';

// Where the box stood when it was written.
export type FeedbackWhere = 'end' | 'pause';

export interface FeedbackContext {
  where: FeedbackWhere;
  // The match it was written in: practice or online, how many minutes it
  // had run, and whether it had a winner by then.
  mode: 'practice' | 'online';
  minutes: number;
  finished: boolean;
  signedIn: boolean;
}

export interface Feedback extends FeedbackContext {
  v: number;
  text: string;
}

// Control characters, which a pasted terminal line carries and which
// nothing typed by hand needs. Walked rather than matched: a regular
// expression over control characters is a lint rule of its own, and for
// good reason, since the escapes read as noise.
function stripControl(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const typed = code === 9 || code === 10 || (code >= 32 && code !== 127);
    if (typed) out += ch;
  }
  return out;
}

// What is worth sending, or null. Control characters go, runs of blank
// lines collapse, the ends are trimmed and the length is capped. Emptiness
// is null rather than an empty message: the box is skipped by leaving it
// alone, and a player who presses Send on nothing has said nothing.
export function cleanFeedback(raw: string): string | null {
  const text = stripControl(raw.replace(/\r\n?/g, '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, FEEDBACK_MAX);
  return text.length > 0 ? text : null;
}

export function buildFeedback(raw: string, context: FeedbackContext): Feedback | null {
  const text = cleanFeedback(raw);
  if (text === null) return null;
  return {
    v: FEEDBACK_VERSION,
    text,
    where: context.where,
    mode: context.mode,
    minutes: Math.max(0, Math.round(context.minutes)),
    finished: context.finished,
    signedIn: context.signedIn,
  };
}

// Fire and forget, with keepalive: this is written at the moment a player
// is leaving, and the answer changes nothing on screen.
export function sendFeedback(
  feedback: Feedback,
  post: typeof fetch = (input, init) => fetch(input, init),
): void {
  try {
    void post(FEEDBACK_ROUTE, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(feedback),
    }).catch(() => undefined);
  } catch {
    // No fetch, no line; the player said it anyway.
  }
}

export interface FeedbackBox {
  root: HTMLElement;
  // The other box on screen says thank you too: one line per match is what
  // is asked for, not one per place it was asked.
  markSent(): void;
}

export interface FeedbackBoxOptions {
  where: FeedbackWhere;
  // Read when Send is pressed, since the match has been running while the
  // box stood there.
  context: () => Omit<FeedbackContext, 'where'>;
  onSent: () => void;
  send?: (feedback: Feedback) => void;
}

// The block itself: a line, a field, and a button that turns into a thank
// you. Built with the caller's element maker so the HUD's classes stay in
// the HUD.
export function buildFeedbackBox(
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    text?: string,
  ) => HTMLElementTagNameMap[K],
  opts: FeedbackBoxOptions,
): FeedbackBox {
  const root = el('div', 'hud-feedback');
  const words = el('div', 'hud-feedback-words');
  words.append(el('b', '', FEEDBACK_ASK), el('span', '', FEEDBACK_CALL));
  const field = el('textarea', 'hud-feedback-field');
  field.placeholder = FEEDBACK_PLACEHOLDER;
  field.maxLength = FEEDBACK_MAX;
  field.rows = 2;
  const send = el('button', 'hud-menu-btn', FEEDBACK_SEND) as HTMLButtonElement;
  const row = el('div', 'hud-feedback-row');
  row.append(field, send);
  const thanks = el('div', 'hud-feedback-thanks', FEEDBACK_THANKS);
  thanks.hidden = true;
  root.append(words, row, thanks);

  const markSent = (): void => {
    words.hidden = true;
    row.hidden = true;
    thanks.hidden = false;
  };
  send.addEventListener('click', () => {
    const feedback = buildFeedback(field.value, { ...opts.context(), where: opts.where });
    if (!feedback) {
      field.focus();
      return;
    }
    (opts.send ?? sendFeedback)(feedback);
    markSent();
    opts.onSent();
  });
  // A field inside the match must not fire the game's keys.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    field.addEventListener(type, (e) => e.stopPropagation());
  }
  return { root, markSent };
}

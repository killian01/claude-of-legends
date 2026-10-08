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

// The line at the start of a match that says the box exists. A match can
// end without its end screen or the pause menu, so a player who is only
// asked there may never be asked at all. It
// comes up once the opening shop is out of the way, stays a moment, and a
// click on it opens the menu where the box is.
export const NUDGE_CALL_MOUSE = 'Tell me what to improve: click here, or press Esc at any time.';
export const NUDGE_CALL_TOUCH = 'Tell me what to improve: tap here, or Menu at any time.';
// Seconds of match time: when it may first show, and how long it stays.
export const NUDGE_FROM = 3;
export const NUDGE_HOLD = 16;

export interface NudgeState {
  // Match time it first showed at, null while it has not.
  shownAt: number | null;
  done: boolean;
}

export const NUDGE_START: NudgeState = { shownAt: null, done: false };

// One step of the line's life. `blocked` is anything covering the middle
// of the screen (the shop, a menu): the line waits for it rather than
// spending its moment under it, and hides while it is up.
export function stepNudge(state: NudgeState, time: number, blocked: boolean): NudgeState {
  if (state.done) return state;
  if (state.shownAt === null) {
    return !blocked && time >= NUDGE_FROM ? { shownAt: time, done: false } : state;
  }
  return time - state.shownAt >= NUDGE_HOLD ? { ...state, done: true } : state;
}

export function nudgeVisible(state: NudgeState, blocked: boolean): boolean {
  return state.shownAt !== null && !state.done && !blocked;
}

export function nudgeCall(touch: boolean): string {
  return touch ? NUDGE_CALL_TOUCH : NUDGE_CALL_MOUSE;
}

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
  // Brings the box into view, and on a keyboard puts the cursor in it.
  reveal(focus: boolean): void;
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
  const reveal = (focus: boolean): void => {
    root.scrollIntoView({ block: 'center' });
    if (focus && !row.hidden) field.focus();
  };
  return { root, markSent, reveal };
}

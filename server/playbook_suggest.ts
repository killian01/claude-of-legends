// The Academy's conversation, the coach (docs/design/bots.md): the owner
// says how the bot should play, the model answers with one comment line
// and a patch, one operation per line, and every operation is applied to
// the working playbook and validated HERE before it is forwarded, so the
// client only ever applies what the engine accepts. No hidden retries: a
// refused operation is reported as such, the rest applies, and the model
// hears about it on the next turn. One streamed model call per message,
// so the owner reads the comment as it is written and sees the list move
// as the operations arrive. Raw HTTP like server/suggest.ts: the repo
// keeps its dependency set tiny.

import { hintsFor } from '../src/sim/content/bots/hints';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
import { ITEM_LIST } from '../src/sim/content/items';
import { STAR_ORCHARD_SIZE } from '../src/sim/content/star_orchard';
import { MAX_BUILD, roleBuild } from '../src/sim/playbook/kit';
import { RANGED_MIN_RANGE } from '../src/sim/playbook/micro';
import { applyPatchOp, isPatchOp, type PatchOp } from '../src/sim/playbook/patch';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { MAX_PLAYS, MAX_VARIANTS, validatePlaybook } from '../src/sim/playbook/validate';
import type { BotStore } from './bot_store';
import type { BotOutcome } from './bots';
import { EMBER_PRICES } from './embers';
import { type ModelUsage, type SpendSample, usageSample } from './spend';
import { CHAT_RAW_TEXT_MAX, type ChatTurn, threadError } from './suggest';

export interface CoachDeps {
  store: BotStore;
  // Absent key: the surface answers honestly instead of pretending.
  apiKey: string | null;
  // One model behind every answer; depth is effort, never a model swap.
  model?: string;
  // Injectable for tests; production uses global fetch.
  fetchFn?: typeof fetch;
  // Where a calibration sample goes (server/spend.ts, ADR 0017). The
  // coach's own store is the bots database and the ledger lives in the
  // Forge one, so the sink is injected rather than reached for.
  spend?: (sample: SpendSample) => void;
  // Which act the samples belong to: an owner watching the Academy, or
  // the night writing to nobody.
  spendDetail?: 'coach' | 'night';
  // The ledger debit for a turn, injected for the same reason the sample
  // sink is: the ledger lives in the Forge store, not this one.
  charge?: (accountId: number, embers: number, ref: string) => void;
  // What the account holds, so a turn can be refused before it is asked
  // for rather than after it has been paid for. Absent means unmetered,
  // which is what a test wants.
  balance?: (accountId: number) => number;
  now?: () => number;
}

export const COACH_MODEL_DEFAULT = 'claude-sonnet-5';

// The server-side refusal fallback is an Opus and Fable feature: sending
// it to any other model is a 400 (measured 2026-09-05 on claude-sonnet-5,
// "does not support the `fallbacks` parameter"). The coach runs on Sonnet
// by default, so the parameter rides only when the configured model takes
// it; without it a policy decline surfaces as the refusal the stream
// reader already reports.
export function supportsFallbacks(model: string): boolean {
  return model.startsWith('claude-opus-') || model.startsWith('claude-fable-');
}
export const COACH_CALL_TIMEOUT_MS = 120_000;
export const COACH_MAX_TOKENS = 8000;

// quick: a patch, low effort, the reactive default. deep: a rework, high
// effort, when the owner asks for one.
export type CoachDepth = 'quick' | 'deep';

export type CoachProgress =
  | { kind: 'stage'; text: string }
  // A piece of the comment line, as the model writes it.
  | { kind: 'text'; text: string }
  // An operation that applied to the working playbook.
  | { kind: 'op'; op: PatchOp }
  // An operation the validator refused, with the reason.
  | { kind: 'refused'; op: unknown; error: string };

export interface CoachRequest {
  id: string;
  messages: readonly ChatTurn[];
  // The playbook as it stands on the form, unsaved edits included; absent
  // falls back to the stored one.
  playbook?: unknown;
  depth?: CoachDepth;
  onProgress?: (p: CoachProgress) => void;
}

export interface CoachAnswer {
  comment: string;
  ops: PatchOp[];
  refused: { op: unknown; error: string }[];
  // The working playbook after the applied operations.
  playbook: PlaybookDef;
  // The model's raw answer, for the client to replay as the assistant
  // turn next time.
  raw: string;
}

// The shop, for the kit: every item with its price and what it gives.
function catalog(): string {
  const stat = (s: Record<string, number | undefined>): string =>
    Object.entries(s)
      .filter((e): e is [string, number] => e[1] !== undefined)
      .map(([k, v]) => `${k} ${v < 1 && v > 0 ? `${Math.round(v * 100)}%` : v}`)
      .join(' ');
  return ITEM_LIST.map(
    (i) =>
      `${i.id} (${i.name}, ${i.cost}g, tier ${i.tier}${i.buildsFrom ? `, from ${i.buildsFrom.join('+')}` : ''}): ${stat(i.stats as Record<string, number | undefined>)}`,
  ).join('\n ');
}

// The playbook grammar, told compactly. Kept by hand beside
// src/sim/playbook/types.ts and validate.ts; the validator catches drift.
const GRAMMAR = `
A playbook is {"version":3,"plays":[Play...],"kit"?:Kit,"lanes"?:["top"|"mid"|"bot"...]}, at most ${MAX_PLAYS} plays. lanes: the lanes the bot asks for, in order, one to three, seated ahead of its champion's home lane (the first with a seat open); "bottom" and "bot lane" both mean "bot", and in your comment always say "bot lane" or "top lane", never "bot" alone (a bare "bot" is the bot itself). Each decision
slot (four per second) the bot walks the list top down; the first play whose trigger holds AND
whose behavior can act this slot is the one that acts. A behavior that cannot act (nothing to
farm, nothing affordable) passes to the next play. Reflexes run before the list and are not yours
to write: dodging skillshots and zones, the banked recast home, spending skill points, holding a
recall channel. The micro (last hits, aim, which key is the escape, the steps of a kite) is the
engine's too.
The kit is what the bot works toward, as opposed to what it does now:
Kit: {"build"?:[itemId...],"skills"?:["Q"|"W"|"E" x3],"variants"?:[{"when":Trigger,"build"?:[...],"skills"?:[...]}...]}
 build: FINISHED items in order, 1 to ${MAX_BUILD}; an item listed twice is owned twice; the engine
 buys the components in recipe order and an item consumed into a later one still counts as owned. Absent: the champion's
 role build. Past a full bag the next target replaces the cheapest item once the gold covers it, and
 a leftover the build no longer wants is sold first (the bot sells at the fountain for 70%).
 skills: the order of Q, W, E to max; R goes at levels 6, 11, 16. Absent: Q, W, E.
 variants: at most ${MAX_VARIANTS}; the first whose trigger holds is the kit in force, decided again
 at every purchase and skill point; each needs a build or a skill order.
Items:
 ${catalog()}
Play: {"id":"lowercase-kebab","when":Trigger,"do":Behavior,"enabled"?:bool}
Trigger is ONE of (numeric fields: "below" strictly less, "atLeast" greater or equal; give at
least one of the two):
 {"kind":"always"}
 {"kind":"hp","below"?:0..1,"atLeast"?:0..1} own health as a fraction; {"kind":"mana",...} same
 {"kind":"level","below"?:1..18,"atLeast"?:1..18} {"kind":"gold",0..1000000} {"kind":"time",seconds 0..36000}
 {"kind":"enemies","within":0..200,"atLeast"?:0..10,"atMost"?:0..10} enemy champions in sight within the radius; {"kind":"allies",...} same for allies
 {"kind":"enemyVisible"} {"kind":"atFountain"} {"kind":"underTower"}
 {"kind":"warden","state":"up"|"spawning"|"down","within"?:seconds,"hpAtMost"?:0..1,"near"?:units} (spawning: due within the seconds, default 20; up narrows to a live Warden at or under hpAtMost of its health and within near units of the bot, what a finish play reads: every new bot has "finish-warden" and "finish-creature" right above "fight", the last strikes on a body in reach whatever is in sight, and they are VALID)
 {"kind":"creature","which"?:"pyrefang"|"voidmaul"|"ascendant"|"any","state":"up"|"spawning"|"down","within"?:seconds,"hpAtMost"?:0..1,"near"?:units} a ring creature (the Pyrefang on the bot ring, the Voidmaul on the top ring, ascendant for either ring's Ascendant, the fourth rise and every later one, a team's fight; any by default): up while one is alive, spawning when due within the seconds (default 20), down when none is
 {"kind":"abilityReady","key":"Q"|"W"|"E"|"R"} {"kind":"sigilReady","id":"riftstep"|"zephyr"|"mend"|"sear"} {"kind":"lane","is":"top"|"mid"|"bot"}
 {"kind":"allyFighting","within":0..200} an allied champion within the radius has an enemy champion within 10 of it
 {"kind":"numbers","within":0..200,"atLeast"?:-10..10,"atMost"?:-10..10} allied champions within the radius (the bot itself counted) minus enemy champions in sight there: atLeast 0 is an even fight or better, atLeast 1 an advantage, atMost -1 outnumbered
 {"kind":"odds","within"?:0..200 (20),"below"?:0..1,"atLeast"?:0..1} the fight's odds: the strength of the allied champions within the radius (the bot itself counted, each weighed by health and level) over both sides' together; 0.5 is an even fight, above it an advantage, below it a losing one
 {"kind":"minions","side":"own"|"enemy","within":0..200,"atLeast"?:0..30,"atMost"?:0..30} minions of that side within the radius: the size of the wave here
 {"kind":"towerThreatened","within"?:0..200 (200)} a live allied tower within the radius has an enemy champion in sight near it (within 16): the map is being lost there
 {"kind":"order","is"?:"goto"|"warden"|"creature"|"focus"|"back"|"group"|"hold"} the owner gave the bot a live coach order (any kind, or that one); every new bot has the play "coach" (this trigger, behavior obeyOrder) right under retreat, and it is VALID: keep it unless the owner asks otherwise
 The lineup, public from champion select ("own" is the bot's team, itself included):
 {"kind":"champion","side":"own"|"enemy","is":championId} that champion is in the match on that side
 {"kind":"roles","side":"own"|"enemy","role":Role,"atLeast"?:0..5,"atMost"?:0..5} how many of a role that side fields
 {"kind":"enemyDamage","mostly":"magic"|"physical"} by roles: mages and battlemages deal magic, supports count on neither side; a strict majority
 {"kind":"enemyItem","item":itemId} a visible enemy champion wears the item right now
 {"kind":"laneOpponent","is":championId} the enemy seen the most in the bot's lane over the last three minutes is that champion
 {"kind":"lanePartner","is":championId} an ally assigned to the bot's lane is that champion
 Champions (id, role): ${CHAMPION_LIST.map((c) => `${c.id} ${c.role}`).join(', ')}
 {"kind":"not","of":Trigger} {"kind":"all","of":[Trigger...]} {"kind":"any","of":[Trigger...]} (nested at most 4 deep)
Behavior is ONE of (every parameter optional, default in parentheses):
 {"kind":"retreat"} run home by the fastest means; always acts.
 {"kind":"hold"} do nothing this slot; always acts.
 {"kind":"obeyOrder"} do what the owner's live coach order says (go somewhere, take the Warden, take the ring's creature, focus, back off, group, hold); passes the turn with no order standing.
 {"kind":"shop"} the kit's next step at the fountain: buy the next item or component, sell what the build no longer wants, replace the cheapest past a full bag.
 {"kind":"goShop"} go home to spend when the next step is affordable and the spot is clear.
 {"kind":"sell","item":itemId} sell the named item at the fountain when the bag holds it.
 {"kind":"avoidTower","escortMin"?:int 0..10 (3),"hpBelow"?:0..1 (0.65)} step out of an enemy tower's reach unless escorted and healthy, or securing a kill.
 {"kind":"finishSanctum"} hit a vulnerable enemy Sanctum in reach when it is low or escorted.
 {"kind":"fight","stance"?:"auto"|"kite"|"front"|"poke" ("auto"),"target"?:"nearest"|"lowest"|"squishiest"|"order" ("nearest"),"alone"?:"engage"|"hold" ("engage")} Sear in kill range, the kit by its hints, then attacks, holding distance by the stance: kite attacks from the edge of its own range and steps away from whoever closes; front walks in and chases a little; poke casts and steps back, never trading attacks; auto is kite on a ranged champion, front on a melee one. Target: the nearest, the lowest in health, the squishiest by role (carries first), or the coach's focus. Alone: what a walk-in does with no allied champion beside it (within 8): engage anyway, or hold and strike only what is already in reach. "commitAt"?:0..1: the odds (as the odds trigger reads them, within 20) under which the bot never walks in: it strikes what reaches it, kites, holds its engage spell, and passes the turn once nothing is in reach; absent, it commits whatever the odds. Acts only with an enemy champion in sight.
 {"kind":"hunt","hpAbove"?:0..1 (0.5)} walk to where a nearly dead enemy was last seen.
 {"kind":"answerVanish","hpAtLeast"?:0..1 (0.55)} an enemy just vanished nearby: walk its spot when healthy, give ground when hurt.
 {"kind":"contestWarden","hpAtLeast"?:0..1 (0.5),"prepSeconds"?:0..300 (20),"partyAtLeast"?:1..5 (3)} attack a live Warden in reach, walk to it healthy and only with that many allied champions near it (self included: the Warden is a team fight), pre-position at the pit before it spawns.
 {"kind":"contestCreature","which"?:"pyrefang"|"voidmaul"|"ascendant"|"any" ("any"),"hpAtLeast"?:0..1 (0.5),"prepSeconds"?:0..300 (20),"within"?:0..200 (40),"partyAtLeast"?:1..5 (2, 3 for the Ascendant)} attack a live ring creature in reach, walk to it healthy and within the range, only with that many allied champions near it (self included: a lone bot pokes a creature for nothing), pre-position at its ring before it rises; its death gives the whole team a permanent favor and gold; an Ascendant's death gives the Wrath instead (150 s: enemies under 20 percent health die to any hit, hits burn), and it wants the whole team.
 {"kind":"farm","mode"?:"shove"|"lastHit" ("shove")} attack the nearest enemy minion in reach; lastHit strikes only a minion the next attack kills, so the wave is not pushed.
 {"kind":"manageWave","intent":"freeze"|"shove"} freeze: hold the enemy wave in front of the bot's own lane tower, last hits only, standing just ahead of the tower and holding still between them, so the wave dies to the tower and the enemy laner must come deep for its farm; always acts while a live allied tower stands on the bot's lane, passes without one. shove: hit the wave to send it at the enemy tower.
 {"kind":"takeCamp"} attack a visible jungle camp in reach, with no enemy champion in sight.
 {"kind":"siege","escortMin"?:int 0..10 (3)} attack a vulnerable structure in reach with a minion escort.
 {"kind":"push","lane"?:"assigned"|"top"|"mid"|"bot" ("assigned"),"regroupAt"?:seconds|null (720)} follow the wave down the lane, else walk it, else walk at the enemy Sanctum; always acts. Past regroupAt every assigned bot pushes mid as one group; null disables the bell.
 {"kind":"followAlly","keep"?:0..50 (3)} walk to the nearest allied champion and stay within keep.
 {"kind":"joinAlly","within"?:0..200 (40)} walk to the nearest ally in a fight within the radius; passes the turn beside it or when nobody is fighting.
 {"kind":"fallBack"} walk back under the nearest live allied tower; passes the turn once under it, so the plays below go on there.
 {"kind":"defendTower","within"?:0..200 (200)} collapse on the allied tower enemy champions are at (the most of them, the nearest on a tie) within the radius; passes the turn beside it or with no tower threatened, so a fight play below takes over on arrival. How a spread pusher is caught with the numbers.
 {"kind":"splitPush"} push the lane enemies were seen in the least over the last minute (the farthest from the enemies in sight on a tie): takes towers while the enemy groups elsewhere; pair it with a fallBack or a retreat when outnumbered.
 {"kind":"holdPosition","x":0..${STAR_ORCHARD_SIZE},"z":0..${STAR_ORCHARD_SIZE},"within"?:0..50 (2)} walk to a point and hold; always acts.
Patch operations, ONE compact JSON object per line:
 {"op":"add","play":Play,"before"?:id|null} insert before the named play, append when absent
 {"op":"remove","id":id}
 {"op":"move","id":id,"before":id|null} (null: to the end)
 {"op":"set","id":id,"play":{"when"?:Trigger,"do"?:Behavior,"enabled"?:bool}} change parts of a play in place
 {"op":"kit","kit":{"build"?:[...]|null,"skills"?:[...]|null,"variants"?:[...]|null}} change parts of the kit; a part given replaces it, null clears it back to the default, absent leaves it
 {"op":"lanes","lanes":["top"|"mid"|"bot"...]|null} set the lane preference, null for none
 {"op":"replace","playbook":Playbook} a whole rewrite, ONLY when the owner asks for one
`;

function preamble(): string {
  const intro =
    "You coach a bot in a small deterministic MOBA, in conversation with the bot's owner. The " +
    "bot's whole brain is its playbook: an ordered list of plays, the first one that can act " +
    'winning each slot, so ORDER is everything and earlier plays win. The owner tells you how ' +
    'they want the bot to play; you answer with the smallest set of patch operations that gets ' +
    'there, keeping what already works.';
  const format =
    'Answer format, and nothing else: the first line starts with "# " followed by one or two ' +
    'plain sentences to the owner, in the language the owner wrote their latest message in ' +
    '(English for an English message), saying what you changed and ' +
    'why; then one patch operation per line as compact JSON (no indentation, no line breaks ' +
    'inside an operation). No prose after the first line, no code fences, no numbering, no ' +
    'trailing commentary. Play ids are short lowercase English (letters, digits, hyphens). ' +
    'Prefer set, add, move and remove over replace.';
  return [intro, GRAMMAR, format].join('\n\n');
}

// The bot and its playbook as they stand right now, restated every turn
// on the last message: the owner may have applied or hand-edited since
// the conversation started.
function formState(championId: string, playbook: PlaybookDef): string {
  const def = CHAMPIONS[championId];
  const hints = hintsFor(championId);
  const keys = (['Q', 'W', 'E'] as const).map((k) => `${k} ${hints.keys[k]}`).join(', ');
  const range = def?.base.attackRange;
  const reach =
    range === undefined
      ? ''
      : ` Attack range ${range} (${range >= RANGED_MIN_RANGE ? 'ranged, kites by default' : 'melee, walks in by default'}).`;
  return [
    `The bot plays ${def?.name ?? championId} (${def?.role ?? 'unknown role'}); its keys by role: ${keys}; R is its ultimate.${reach}`,
    `Its role build, used when the kit names none: ${roleBuild(championId).join(', ')}.`,
    `The playbook on the form right now: ${JSON.stringify(playbook)}`,
  ].join(' ');
}

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

function toApiMessages(turns: readonly ChatTurn[], state: string): ApiMessage[] {
  return turns.map((t, i) => {
    if (t.role === 'assistant') return { role: 'assistant', content: t.text };
    const text = i === turns.length - 1 ? `${t.text}\n\n${state}` : t.text;
    return { role: 'user', content: i === 0 ? `The owner says: ${text}` : text };
  });
}

// The Messages API's server-sent events, text deltas only: the answer
// grows as the model writes it and the caller hears every piece. A
// refusal stop is an error the owner can read.
async function readEventStream(
  res: Response,
  onText: (delta: string) => void,
  // The input side rides message_start and the output side the closing
  // message_delta; the two fold into one usage for the calibration log.
  onUsage?: (usage: ModelUsage) => void,
): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const usage: ModelUsage = {};
  const fold = (u: ModelUsage | undefined): void => {
    if (!u) return;
    for (const k of [
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
    ] as const) {
      if (typeof u[k] === 'number') usage[k] = u[k];
    }
  };
  let pending = '';
  let text = '';
  const take = (frame: string): void => {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let event: {
        type?: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
        error?: { message?: string };
        message?: { usage?: ModelUsage };
        usage?: ModelUsage;
      };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'error') throw new Error(event.error?.message ?? 'the stream broke');
      if (event.type === 'message_start') fold(event.message?.usage);
      if (event.type === 'message_delta') fold(event.usage);
      if (event.type === 'message_delta' && event.delta?.stop_reason === 'refusal') {
        throw new Error('the model declined to answer this one');
      }
      if (event.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') continue;
      if (typeof event.delta.text !== 'string') continue;
      text += event.delta.text;
      onText(event.delta.text);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let cut = pending.indexOf('\n\n');
    while (cut >= 0) {
      take(pending.slice(0, cut));
      pending = pending.slice(cut + 2);
      cut = pending.indexOf('\n\n');
    }
  }
  if (pending.trim() !== '') take(pending);
  onUsage?.(usage);
  return text;
}

async function askModel(
  deps: CoachDeps,
  messages: readonly ApiMessage[],
  depth: CoachDepth,
  onText: (delta: string) => void,
  onUsage?: (usage: ModelUsage) => void,
): Promise<string> {
  const doFetch = deps.fetchFn ?? fetch;
  const model = deps.model ?? COACH_MODEL_DEFAULT;
  const fallbacks = supportsFallbacks(model);
  const res = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': deps.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      // The refusal fallback: a policy decline re-runs on a fallback
      // model inside the same call instead of ending the conversation.
      ...(fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: COACH_MAX_TOKENS,
      stream: true,
      // The grammar never changes between turns: cached as a prefix.
      system: [{ type: 'text', text: preamble(), cache_control: { type: 'ephemeral' } }],
      // Depth is effort, not a model swap: a patch is a small answer at
      // low effort, a rework earns the full think.
      output_config: { effort: depth === 'deep' ? 'high' : 'low' },
      ...(fallbacks ? { fallbacks: 'default' } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(COACH_CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`the coach service answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) return readEventStream(res, onText, onUsage);
  // A whole message at once: a stub, or a service that ignored the stream.
  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: ModelUsage;
  };
  if (body.usage) onUsage?.(body.usage);
  const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
  onText(text);
  return text;
}

// Reads the answer as it streams: the first line is the comment (its
// pieces forwarded as they come), every later complete line is an
// operation applied at once and forwarded or refused. The model never
// sees a retry; the owner sees everything.
class AnswerReader {
  comment = '';
  readonly ops: PatchOp[] = [];
  readonly refused: { op: unknown; error: string }[] = [];
  private commentDone = false;
  private commentStarted = false;
  private lineBuf = '';

  constructor(
    public playbook: PlaybookDef,
    private readonly progress: (p: CoachProgress) => void,
  ) {}

  feed(delta: string): void {
    let rest = delta;
    if (!this.commentDone) {
      const nl = rest.indexOf('\n');
      let piece = nl < 0 ? rest : rest.slice(0, nl);
      if (!this.commentStarted) {
        const trimmed = piece.replace(/^\s*#+\s*/, '');
        if (piece.trim() !== '') this.commentStarted = true;
        piece = trimmed;
      }
      if (piece !== '') {
        this.comment += piece;
        this.progress({ kind: 'text', text: piece });
      }
      if (nl < 0) return;
      this.commentDone = true;
      rest = rest.slice(nl + 1);
    }
    this.lineBuf += rest;
    let cut = this.lineBuf.indexOf('\n');
    while (cut >= 0) {
      this.takeLine(this.lineBuf.slice(0, cut));
      this.lineBuf = this.lineBuf.slice(cut + 1);
      cut = this.lineBuf.indexOf('\n');
    }
  }

  finish(): void {
    if (this.lineBuf.trim() !== '') this.takeLine(this.lineBuf);
    this.lineBuf = '';
    this.comment = this.comment.trim().slice(0, 600);
  }

  private takeLine(line: string): void {
    const text = line.trim();
    if (text === '' || text.startsWith('#') || text.startsWith('```')) return;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.refuse(text, 'not a patch operation');
      return;
    }
    if (!isPatchOp(raw)) {
      this.refuse(raw, 'not a patch operation');
      return;
    }
    const r = applyPatchOp(this.playbook, raw);
    if (!r.ok) {
      this.refuse(raw, r.error);
      return;
    }
    this.playbook = r.def;
    this.ops.push(raw);
    this.progress({ kind: 'op', op: raw });
  }

  private refuse(op: unknown, error: string): void {
    this.refused.push({ op, error });
    this.progress({ kind: 'refused', op, error });
  }
}

export async function coachPlaybook(
  deps: CoachDeps,
  accountId: number,
  req: CoachRequest,
): Promise<BotOutcome<CoachAnswer>> {
  if (!deps.apiKey) {
    return { ok: false, error: 'the coach is not configured on this server yet' };
  }
  const bot = deps.store.getBot(req.id);
  if (!bot || bot.accountId !== accountId) {
    return { ok: false, error: 'no such bot on this account' };
  }
  const badThread = threadError(req.messages);
  if (badThread !== null) return { ok: false, error: badThread };
  let playbook = bot.playbook;
  if (req.playbook !== undefined) {
    const v = validatePlaybook(req.playbook);
    if (!v.ok) return { ok: false, error: `the playbook on the form is not valid: ${v.errors[0]}` };
    playbook = v.def;
  }
  const price = EMBER_PRICES.coachTurn;
  const held = deps.balance?.(accountId);
  if (held !== undefined && held < price) {
    return { ok: false, error: `this costs ${price} embers a turn and you have ${held}` };
  }
  const progress = req.onProgress ?? (() => {});
  const reader = new AnswerReader(playbook, progress);
  progress({ kind: 'stage', text: 'Reading the playbook' });
  let text: string;
  try {
    text = await askModel(
      deps,
      toApiMessages(req.messages, formState(bot.championId, playbook)),
      req.depth ?? 'quick',
      (delta) => reader.feed(delta),
      (usage) => {
        const at = (deps.now ?? Date.now)();
        deps.spend?.(usageSample('agent', deps.spendDetail ?? 'coach', accountId, at, usage));
        // The Academy spends the same embers as the Forge (ADR 0017), and
        // so does the night on the owner's behalf. Debited on the answer.
        deps.charge?.(accountId, EMBER_PRICES.coachTurn, bot.id);
      },
    );
  } catch (err) {
    const e = err as Error;
    const why =
      e.name === 'TimeoutError' ? 'the coach took too long to answer; try again' : e.message;
    return { ok: false, error: `the coach call failed: ${why}` };
  }
  reader.finish();
  return {
    ok: true,
    comment: reader.comment,
    ops: reader.ops,
    refused: reader.refused,
    playbook: reader.playbook,
    raw: text.slice(0, CHAT_RAW_TEXT_MAX),
  };
}

// Client entry: home menu, then either the offline practice sim or the
// online flow (queue or lobby, champion select, then the mirror world fed by
// server snapshots). Both paths run the exact same presentation over IWorld,
// and both come BACK: every exit routes through src/game/flow on the same
// page. No reload between matches; the menu and a rematch are one click.

import { type Presentation, startPresentation } from './game/boot';
import { nextStep, type PostMatchAction } from './game/flow';
import { registerForgedAssets } from './game/forged_visuals';
import { requestGameFullscreen } from './game/fullscreen';
import { parseJoinCode } from './game/invite';
import { ReplayWorld } from './game/replay_world';
import { getSettings } from './game/settings';
import { type SpectatorView, startSpectator } from './game/spectate';
import { ClientWorld } from './net/client_world';
import type { ForgedMatchAssets, ServerMsg } from './net/protocol';
import { applyReplayEvent, buildMatchSim, type ReplayRecord } from './net/replay';
import { BOTS, DEFAULT_BOT_ID } from './sim/content/bots';
import { fillTeam } from './sim/fill';
import type { ForgedChampionDef } from './sim/forge/forged_def';
import { Rng } from './sim/rng';
import { Sim } from './sim/sim';
import { type AbilityKey, DT, type TeamId } from './sim/types';
import { type AuthedAccount, currentAccount } from './ui/auth';
import { buildCoachBar, type CoachBar } from './ui/coach_bar';
import { takeDiscordResult } from './ui/discord_entry';
import { takeConfirmResult } from './ui/email_status';
import { preloadBackdrop } from './ui/home_backdrop';
import { type HomeChoice, showHome } from './ui/home_screen';
import { showLanding } from './ui/landing';
import {
  type BotPick,
  type CommunityPick,
  type ForgedPick,
  type LobbyController,
  type QueueController,
  type SelectController,
  showLobby,
  showNotice,
  showQueue,
  showSelect,
} from './ui/menu';
import { pendingResetToken, showPasswordReset } from './ui/password_reset';
import { buildReplayBar, type ReplayBar } from './ui/replay_bar';
import type { IWorld } from './world_api';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app root element');
const container = app;

function registerForgedFromMatch(assets: Record<string, ForgedMatchAssets> | undefined): void {
  for (const [id, a] of Object.entries(assets ?? {})) registerForgedAssets(id, a);
}

interface OfflinePick {
  championId: string;
  sigils: [string, string];
  skin: number;
  // A Forge test drive: the draft to register in the offline sim before
  // picking it (the stylized figure carries the render).
  forged?: ForgedChampionDef;
}

function pickForPractice(): Promise<OfflinePick> {
  return new Promise((resolve) => {
    const picker = showSelect(container, null, 0, null, (championId, sigils, skin) => {
      // Inside the lock-in click gesture, so the browser grants it.
      requestGameFullscreen();
      picker.remove();
      resolve({ championId, sigils, skin });
    });
  });
}

// The account's bots for the classic select (ADR 0013); none when the
// server is unreachable or the account has none.
async function fetchBots(): Promise<BotPick[]> {
  try {
    const res = await fetch('/api/bots', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const body = (await res.json()) as { ok?: boolean; bots?: BotPick[] };
    return body.ok && Array.isArray(body.bots) ? body.bots : [];
  } catch {
    return [];
  }
}

// One offline practice match; resolves with the exit the player chose.
function runOffline(pick: OfflinePick): Promise<PostMatchAction> {
  return new Promise((resolve) => {
    const sim = new Sim(42);
    if (pick.forged) sim.addForgedChampion(pick.forged);
    const world: IWorld = sim;
    const self = sim.addChampion(0, undefined, pick.championId, pick.skin);
    self.sigils = [...pick.sigils];
    // A full 5v5: your four allies and all five opponents are Policy bots
    // on the fill (src/sim/fill.ts), the roster's lanes completed around
    // your pick, with deterministic skin variety (the sim clamps
    // out-of-range picks).
    const rng = new Rng(42);
    const allies = fillTeam([{ championId: pick.championId, role: pick.forged?.role }], rng);
    for (const [i, id] of allies.entries()) {
      const ally = sim.addChampion(0, undefined, id, i % 3);
      sim.attachPolicy(ally.id, BOTS[DEFAULT_BOT_ID]!.policy);
    }
    for (const [i, id] of fillTeam([], rng).entries()) {
      const enemy = sim.addChampion(1, undefined, id, i % 3);
      sim.attachPolicy(enemy.id, BOTS[DEFAULT_BOT_ID]!.policy);
    }

    let stopped = false;
    const pres = startPresentation(container, world, self.id, self.team, (action) => {
      stopped = true;
      pres.dispose();
      resolve(action);
    });
    const TICK_MS = DT * 1000;
    let last = performance.now();
    let acc = 0;
    function frame(now: number): void {
      if (stopped) return;
      acc += Math.min(now - last, 250);
      last = now;
      while (acc >= TICK_MS) {
        const kills: { unitId: number; killerId: number }[] = [];
        const golds: number[] = [];
        const casts: { unitId: number; key?: AbilityKey }[] = [];
        const hits: { targetId: number; amount: number }[] = [];
        const attacks: { unitId: number; targetId: number }[] = [];
        for (const ev of sim.tick()) {
          if (ev.type === 'death') kills.push({ unitId: ev.unitId, killerId: ev.killerId });
          else if (ev.type === 'gold' && ev.unitId === self.id) golds.push(ev.amount);
          else if (ev.type === 'cast') casts.push({ unitId: ev.unitId, key: ev.key });
          else if (ev.type === 'sigil') casts.push({ unitId: ev.unitId });
          else if (ev.type === 'attack') attacks.push({ unitId: ev.unitId, targetId: ev.targetId });
          else if (ev.type === 'damage' && ev.sourceId === self.id && ev.targetId !== self.id)
            hits.push({ targetId: ev.targetId, amount: ev.amount });
        }
        pres.onWorldTick({ kills, golds, casts, hits, attacks });
        acc -= TICK_MS;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// Watch a saved match: rebuild the sim from the record (deterministic, so
// the whole match is seed plus commands) and run it through the normal
// presentation behind a read-only world, with a control bar on top.
// Seeking rides the same determinism: forward steps the sim silently to
// the tick, backward rebuilds it from the record first. A seek is chunked
// over frames so the page stays responsive while it steps.
// A record handed over directly (a local sparring match from the Academy)
// skips the fetch: the same viewer, the same rules.
// Ticks a replay steps per animation frame while seeking or at top speed.
const REPLAY_TICKS_PER_FRAME = 400;

async function runReplay(source: number | ReplayRecord): Promise<PostMatchAction> {
  let record: ReplayRecord | null = null;
  if (typeof source !== 'number') record = source;
  else {
    try {
      const res = await fetch(`/api/replay/${source}`);
      if (res.ok) record = (await res.json()) as ReplayRecord;
    } catch {
      // handled below
    }
  }
  if (!record || record.version !== 1 || !Array.isArray(record.picks)) {
    await showNotice(
      container,
      'Replay unavailable',
      'This replay is gone: the server keeps only the most recent matches.',
    );
    return 'menu';
  }
  const rec = record;
  return new Promise((resolve) => {
    const build = (): Sim => buildMatchSim(rec.seed, rec.picks, rec.forged ?? []).sim;
    // Unit ids are deterministic too: the first build names the seats and
    // every rebuild lands the same ids.
    const { sim: first, unitIds } = buildMatchSim(rec.seed, rec.picks, rec.forged ?? []);
    let sim = first;
    const unitTeams = new Map<number, TeamId>();
    rec.picks.forEach((p, i) => {
      unitTeams.set(unitIds[i]!, p.team);
    });
    // Follow the first human seat: their team, their fog, their story.
    const viewerIdx = Math.max(
      0,
      rec.picks.findIndex((p) => !p.bot),
    );
    const world = new ReplayWorld(sim);
    let stopped = false;
    let bar: ReplayBar | null = null;
    const finish = (action: PostMatchAction): void => {
      if (stopped) return;
      stopped = true;
      bar?.el.remove();
      pres.dispose();
      resolve(action);
    };
    const pres = startPresentation(
      container,
      world,
      unitIds[viewerIdx]!,
      rec.picks[viewerIdx]!.team,
      finish,
    );
    let speed = 1;
    let next = 0;
    // A seek in progress: the tick to reach, stepped silently.
    let target: number | null = null;
    const seekTo = (tick: number): void => {
      const t = Math.max(0, Math.min(rec.ticks, Math.round(tick)));
      if (t < sim.tickCount) {
        sim = build();
        next = 0;
        world.rebind(sim);
      }
      target = t;
    };
    bar = buildReplayBar({
      ticks: rec.ticks,
      onSpeed: (m) => {
        speed = m;
      },
      onSeek: seekTo,
      onExit: () => finish('menu'),
    });
    container.appendChild(bar.el);

    // One recorded tick: the commands due, then the sim; the presentation
    // hears the events only while playing, never while seeking.
    const stepOnce = (silent: boolean): void => {
      while (next < rec.events.length && rec.events[next]!.k <= sim.tickCount) {
        applyReplayEvent(sim, unitTeams, rec.events[next]!);
        next++;
      }
      const kills: { unitId: number; killerId: number }[] = [];
      const casts: { unitId: number; key?: AbilityKey }[] = [];
      const attacks: { unitId: number; targetId: number }[] = [];
      for (const ev of sim.tick()) {
        if (silent) continue;
        if (ev.type === 'death') kills.push({ unitId: ev.unitId, killerId: ev.killerId });
        else if (ev.type === 'cast') casts.push({ unitId: ev.unitId, key: ev.key });
        else if (ev.type === 'sigil') casts.push({ unitId: ev.unitId });
        else if (ev.type === 'attack') attacks.push({ unitId: ev.unitId, targetId: ev.targetId });
      }
      if (!silent) pres.onWorldTick({ kills, golds: [], casts, hits: [], attacks });
    };

    const TICK_MS = DT * 1000;
    let last = performance.now();
    let acc = 0;
    function frame(now: number): void {
      if (stopped) return;
      if (target !== null) {
        // Seeking: a slice of ticks per frame, the clock frozen meanwhile.
        for (let i = 0; i < REPLAY_TICKS_PER_FRAME && sim.tickCount < target; i++) stepOnce(true);
        if (sim.tickCount >= target) target = null;
        last = now;
        acc = 0;
        bar?.setTime(sim.tickCount, target !== null);
        requestAnimationFrame(frame);
        return;
      }
      acc += Math.min(now - last, 250) * speed;
      last = now;
      // Ten times speed is two hundred ticks a second: bounded per frame
      // so a slow frame cannot snowball into a stall.
      let budget = REPLAY_TICKS_PER_FRAME;
      while (acc >= TICK_MS && sim.tickCount < rec.ticks && budget > 0) {
        stepOnce(false);
        acc -= TICK_MS;
        budget--;
      }
      if (budget === 0) acc = 0;
      // The record's end: freeze (the end overlay is already up if a
      // winner landed; a truncated record simply stops).
      if (sim.tickCount >= rec.ticks) acc = 0;
      bar?.setTime(sim.tickCount, false);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

// Watch a live match: a seatless mirror world on one team's fog, driven
// by the server's spectator snapshot stream.
function runSpectate(matchId: number, team: TeamId): Promise<PostMatchAction> {
  return new Promise((resolve) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    // Spectators send no orders; the world's sender goes nowhere.
    const world = new ClientWorld(() => undefined);
    let view: SpectatorView | null = null;
    let finished = false;
    const finish = (action: PostMatchAction): void => {
      if (finished) return;
      finished = true;
      view?.dispose();
      view = null;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ t: 'leave' }));
        ws.close();
      }
      resolve(action);
    };
    ws.addEventListener('open', () => {
      // No token on purpose: watching needs no identity, and presenting
      // one could pull a reserved seat back instead of spectating.
      ws.send(JSON.stringify({ t: 'hello', name: 'spectator' }));
      ws.send(JSON.stringify({ t: 'spectate', matchId, team }));
    });
    ws.addEventListener('message', (event) => {
      if (finished) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'match_start':
          registerForgedFromMatch(msg.forgedAssets);
          world.applyServer(msg);
          break;
        case 'score':
          world.applyServer(msg);
          break;
        case 'snap': {
          const changed = world.applyServer(msg);
          if (!view && world.units.size > 0) {
            view = startSpectator(container, world, team, () => finish('menu'));
          }
          if (changed && view) {
            const kills: { unitId: number; killerId: number }[] = [];
            const casts: { unitId: number; key?: AbilityKey }[] = [];
            const attacks: { unitId: number; targetId: number }[] = [];
            for (const e of msg.events) {
              if (e.e === 'death') kills.push({ unitId: e.unitId, killerId: e.killerId });
              else if (e.e === 'cast') casts.push({ unitId: e.unitId, key: e.k });
              else if (e.e === 'atk') attacks.push({ unitId: e.unitId, targetId: e.targetId });
            }
            view.onWorldTick({ kills, golds: [], casts, hits: [], attacks });
          }
          break;
        }
        case 'match_end':
          finish('menu');
          break;
        case 'error':
          void showNotice(container, 'Notice', msg.message).then(() => finish('menu'));
          break;
        default:
          break;
      }
    });
    ws.addEventListener('close', () => {
      if (finished) return;
      void showNotice(container, 'Disconnected', 'Lost the connection to the match.').then(() =>
        finish('menu'),
      );
    });
  });
}

// One online session (queue or lobby, select, match); resolves with the
// exit the player chose, or 'menu' when the connection story ends it.
function runOnline(choice: HomeChoice): Promise<PostMatchAction> {
  return new Promise((resolve) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    const world = new ClientWorld((msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    });

    let queueUi: QueueController | null = null;
    let lobbyUi: LobbyController | null = null;
    let selectUi: SelectController | null = null;
    let pres: Presentation | null = null;
    let coachBar: CoachBar | null = null;
    let opened = false;
    let matchEnded = false;
    let finished = false;

    const clearMenus = (): void => {
      queueUi?.remove();
      queueUi = null;
      lobbyUi?.remove();
      lobbyUi = null;
    };

    // The one way out, whatever the path in: menus down, presentation
    // disposed, and the seat given up FOR GOOD. The explicit 'leave' tells
    // the server this is a walk-out, not a dropped connection, so no rejoin
    // reservation is held; an accidental close keeps the reservation and
    // the player reconnects through "Play online".
    const finish = (action: PostMatchAction): void => {
      if (finished) return;
      finished = true;
      clearMenus();
      selectUi?.remove();
      selectUi = null;
      pres?.dispose();
      pres = null;
      coachBar?.remove();
      coachBar = null;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ t: 'leave' }));
        ws.close();
      }
      resolve(action);
    };

    // The Forge queue's select offers the account's finalized creations
    // and the community's shared ones: both fetched the moment the session
    // opens so the lists are ready (or nearly) when select_start lands;
    // the handler awaits them either way.
    const forgedRoster: Promise<ForgedPick[]> =
      choice.mode === 'forge-queue'
        ? fetch('/api/forge/drafts', { credentials: 'same-origin' })
            .then((res) => (res.ok ? res.json() : { drafts: [] }))
            .then(
              (body: {
                drafts?: {
                  def: ForgedChampionDef;
                  status: string;
                  splash?: string | null;
                  model?: string | null;
                  family?: string | null;
                  display?: import('./sim/forge/display').ForgedDisplay | null;
                }[];
              }) =>
                (body.drafts ?? [])
                  .filter((d) => d.status === 'finalized')
                  .map((d) => {
                    registerForgedAssets(d.def.id, d);
                    return { def: d.def, splash: d.splash ?? null };
                  }),
            )
            .catch(() => [])
        : Promise.resolve([]);
    const communityList: Promise<CommunityPick[]> =
      choice.mode === 'forge-queue'
        ? fetch('/api/gallery?playable=1&sort=popular', { credentials: 'same-origin' })
            .then((res) => (res.ok ? res.json() : { entries: [] }))
            .then((body: { entries?: (CommunityPick & { mine?: boolean })[] }) => {
              for (const e of body.entries ?? []) registerForgedAssets(e.def.id, e);
              // Own champions already sit in their own section.
              return (body.entries ?? []).filter((e) => e.mine !== true);
            })
            .catch(() => [])
        : Promise.resolve([]);

    ws.addEventListener('open', () => {
      opened = true;
      // No identity to send: the session cookie rode the upgrade, and the
      // server refused it outright if there was none (ADR 0006). hello only
      // asks whether a live match is still holding our seat.
      ws.send(JSON.stringify({ t: 'hello' }));
      if (choice.mode === 'queue' || choice.mode === 'forge-queue') {
        ws.send(
          JSON.stringify({ t: 'queue', ...(choice.mode === 'forge-queue' ? { forge: true } : {}) }),
        );
        queueUi = showQueue(
          container,
          () => ws.send(JSON.stringify({ t: 'start_now' })),
          () => finish('menu'),
        );
      } else if (choice.mode === 'create') {
        ws.send(JSON.stringify({ t: 'create_lobby' }));
        lobbyUi = showLobby(
          container,
          () => ws.send(JSON.stringify({ t: 'start_lobby' })),
          () => finish('menu'),
          (team) => ws.send(JSON.stringify({ t: 'lobby_team', team })),
          () => ws.send(JSON.stringify({ t: 'queue_party' })),
        );
      } else if (choice.mode === 'join' && choice.code) {
        ws.send(JSON.stringify({ t: 'join_lobby', code: choice.code }));
        lobbyUi = showLobby(
          container,
          () => undefined,
          () => finish('menu'),
          (team) => ws.send(JSON.stringify({ t: 'lobby_team', team })),
          () => undefined,
        );
      }
    });

    ws.addEventListener('message', (event) => {
      if (finished) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'queue_status':
          // A lobby that queued as a party gets queue updates: swap the
          // lobby screen for the queue screen the first time one lands.
          if (lobbyUi && !queueUi) {
            lobbyUi.remove();
            lobbyUi = null;
            queueUi = showQueue(
              container,
              () => ws.send(JSON.stringify({ t: 'start_now' })),
              () => finish('menu'),
            );
          }
          queueUi?.setStatus(msg.count, msg.needed, msg.startsIn, msg.ready);
          break;
        case 'lobby':
          lobbyUi?.update(msg.code, msg.host, msg.team, msg.players);
          break;
        case 'select_start': {
          clearMenus();
          const openSelect = (
            forgedList: readonly ForgedPick[],
            community: readonly CommunityPick[],
            botsList: readonly BotPick[] = [],
          ): void => {
            if (finished || selectUi) return;
            selectUi = showSelect(
              container,
              msg.players,
              msg.team,
              msg.deadline,
              (champ, sigils, skin, botId) => {
                // Inside the lock-in click gesture, so the browser grants it.
                requestGameFullscreen();
                ws.send(
                  JSON.stringify({
                    t: 'pick',
                    championId: champ,
                    sigils,
                    skin,
                    ...(botId ? { bot: botId } : {}),
                  }),
                );
              },
              forgedList,
              community,
              botsList,
            );
          };
          // A Forge select waits for the forged lists (already in flight
          // since the session opened); a classic select opens on the spot.
          if (msg.forge) {
            void Promise.all([forgedRoster, communityList]).then(([own, community]) =>
              openSelect(own, community),
            );
          } else {
            // The classic select offers the account's bots (ADR 0013).
            void fetchBots().then((bots) => openSelect([], [], bots));
          }
          break;
        }
        case 'select_update':
          selectUi?.setLocked(msg.locked, msg.total, msg.taken);
          break;
        case 'chat':
          pres?.pushChat(msg.from, msg.team, msg.text);
          break;
        case 'player_left':
          pres?.pushChat('System', msg.team, `${msg.name} disconnected; a bot takes over.`);
          break;
        case 'player_back':
          pres?.pushChat('System', msg.team, `${msg.name} reconnected.`);
          break;
        case 'ping':
          pres?.showPing(msg.x, msg.z, msg.from, msg.team);
          break;
        case 'welcome':
          // The server names the account this socket belongs to; nothing to
          // store, the cookie is the identity.
          break;
        case 'match_start':
          registerForgedFromMatch(msg.forgedAssets);
          world.applyServer(msg);
          // A rejoin can arrive while the queue or lobby screen is still up.
          clearMenus();
          selectUi?.remove();
          selectUi = null;
          break;
        case 'snap': {
          const changed = world.applyServer(msg);
          if (!pres && world.selfUnitId !== 0 && world.units.has(world.selfUnitId)) {
            pres = startPresentation(container, world, world.selfUnitId, world.selfTeam, finish);
            // A coach seat (ADR 0013): the bar for the orders with no place to
            // click; right-click already goes and focuses through the mirror.
            if (world.coach) {
              coachBar = buildCoachBar(container, (kind) =>
                ws.send(JSON.stringify({ t: 'order', kind })),
              );
            }
            pres.setNetHooks({
              sendChat: (text) => ws.send(JSON.stringify({ t: 'chat', text })),
              sendPing: (x, z) => ws.send(JSON.stringify({ t: 'ping', x, z })),
            });
          }
          if (changed) {
            // The coached bot answers through its snapshot: the order it holds
            // and the play it is running.
            const me = world.units.get(world.selfUnitId);
            if (me) coachBar?.update(me.coachOrder, me.play);
            const kills: { unitId: number; killerId: number }[] = [];
            const golds: number[] = [];
            const casts: { unitId: number; key?: AbilityKey }[] = [];
            const hits: { targetId: number; amount: number }[] = [];
            const attacks: { unitId: number; targetId: number }[] = [];
            for (const e of msg.events) {
              if (e.e === 'death') kills.push({ unitId: e.unitId, killerId: e.killerId });
              else if (e.e === 'gold') golds.push(e.amount);
              else if (e.e === 'cast') casts.push({ unitId: e.unitId, key: e.k });
              else if (e.e === 'atk') attacks.push({ unitId: e.unitId, targetId: e.targetId });
              else if (e.e === 'dmg') hits.push({ targetId: e.targetId, amount: e.amount });
            }
            pres?.onWorldTick({ kills, golds, casts, hits, attacks });
          }
          break;
        }
        case 'score':
          world.applyServer(msg);
          break;
        case 'match_result':
          pres?.setMatchResult(msg.rated, msg.delta, msg.rating, msg.queue, msg.way);
          break;
        case 'match_end':
          // The end overlay (stats, Play again, Return to menu) owns the way
          // out; without a presentation there is nothing to look at, go home.
          matchEnded = true;
          if (!pres) finish('menu');
          break;
        case 'error': {
          // Pre-game refusals (bad lobby code, closed lobby) must reach the
          // player, not the console: clear whichever menu is up and say it.
          // Mid-match, a server verdict (removed for inactivity) ends the
          // session: tear down first, then explain over the home screen.
          console.warn('server:', msg.message);
          const message = msg.message;
          if (!pres) {
            clearMenus();
            selectUi?.remove();
            selectUi = null;
            void showNotice(container, 'Notice', message).then(() => finish('menu'));
          } else {
            finish('menu');
            void showNotice(container, 'Notice', message);
          }
          break;
        }
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      // A close after the match ended is the server reaping the room, not a
      // failure; the end screen is already up. A close after finish() is
      // this client hanging up on purpose.
      if (finished || matchEnded) return;
      if (!opened) {
        void showNotice(
          container,
          'Server unreachable',
          'Could not reach the game server. Start it in another terminal with "pnpm server" ' +
            '(keep it running), restart "pnpm dev" if it predates vite.config.ts, then try again.',
        ).then(() => finish('menu'));
      } else {
        void showNotice(
          container,
          'Disconnected',
          'Lost the connection to the server. If you were in a match, hit "Play online" from ' +
            'the menu: your champion is waiting.',
        ).then(() => finish('menu'));
      }
    });
  });
}

async function boot(): Promise<void> {
  // Load and apply the stored player settings before any audio plays.
  getSettings();
  // An invite link (?join=CODE) deep-links into the friend's lobby: with a
  // stored name we go straight in; a first-time visitor gets the home
  // screen with the code prefilled. Consumed once, so reloads stay home.
  let joinCode = parseJoinCode(window.location.search);
  if (joinCode !== null) window.history.replaceState(null, '', window.location.pathname);
  // The landing art is the first thing on screen; ask for it before the
  // session check so the two requests fly together.
  preloadBackdrop();
  // A reset link stands in front of everything, session or not: the whole
  // premise is that this person cannot sign in. Completing one revokes
  // every session the account had, so the check below then finds none.
  const resetToken = pendingResetToken();
  if (resetToken !== null) await showPasswordReset(container, resetToken);
  // What a confirmation link redirected back with, if this load came from
  // one. Read once, shown once, on the first home screen of the session.
  // A round trip through Discord reports itself the same way (ADR 0009),
  // and is read first only because both of them rewrite the address bar.
  // A successful one arrives with a session already open, so only the
  // failures ever have a screen to land on: the entry page shows them.
  let discordResult = takeDiscordResult();
  let confirmed = takeConfirmResult();
  // The app loop: home, one match, back, forever on the same page. 'again'
  // replays the same offline pick or re-enters the public queue (flow.ts).
  let next: HomeChoice | null = null;
  // A replay opened from the Academy returns there, on the same bot.
  let reopenAcademy: { botId: string } | null = null;
  let lastPick: OfflinePick | null = null;
  // Who is signed in, or null while only the offline match is reachable.
  // A live session cookie from a previous visit skips the sign-in screen.
  let account: AuthedAccount | null = await currentAccount();

  for (;;) {
    // The way in (ADR 0006): everything but the offline practice match
    // needs an account, so the sign-in screen stands in front of the home
    // screen rather than beside it. An invite code survives the detour and
    // lands in the join field on the other side.
    if (account === null) {
      const entry = await showLanding(container, discordResult);
      if (entry.kind === 'account') {
        account = entry.account;
      } else {
        // Offline: one match against bots, then back to the way in.
        const pick: OfflinePick = lastPick ?? (await pickForPractice());
        lastPick = pick;
        await runOffline(pick);
        continue;
      }
    }
    if (joinCode !== null) next = { name: account.name, mode: 'join', code: joinCode };
    const choice: HomeChoice =
      next ?? (await showHome(container, account, joinCode ?? undefined, confirmed, reopenAcademy));
    reopenAcademy = null;
    confirmed = null;
    discordResult = null;
    joinCode = null;
    next = null;
    let action: PostMatchAction;
    if (choice.mode === 'practice') {
      // A Forge test drive arrives with its draft; a plain practice run
      // goes through champion select as always.
      const pick: OfflinePick = choice.forged
        ? {
            championId: choice.forged.id,
            sigils: ['riftstep', 'mend'],
            skin: 0,
            forged: choice.forged,
          }
        : (lastPick ?? (await pickForPractice()));
      lastPick = pick;
      action = await runOffline(pick);
    } else if (choice.mode === 'replay' && choice.replay !== undefined) {
      action = await runReplay(choice.replay);
    } else if (choice.mode === 'replay' && choice.replayId !== undefined) {
      action = await runReplay(choice.replayId);
    } else if (choice.mode === 'spectate' && choice.matchId !== undefined) {
      action = await runSpectate(choice.matchId, choice.team === 1 ? 1 : 0);
    } else {
      action = await runOnline(choice);
    }
    reopenAcademy = choice.academy ?? null;
    const step = nextStep(action, choice.mode);
    if (step === 'replay') {
      next = choice;
    } else if (step === 'requeue') {
      // Play again re-enters the queue the match came from.
      next = {
        name: choice.name,
        mode: choice.mode === 'forge-queue' ? 'forge-queue' : 'queue',
      };
    } else {
      lastPick = null;
    }
  }
}

void boot();

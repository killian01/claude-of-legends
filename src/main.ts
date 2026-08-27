// Client entry: home menu, then either the offline practice sim or the
// online flow (queue or lobby, champion select, then the mirror world fed by
// server snapshots). Both paths run the exact same presentation over IWorld,
// and both come BACK: every exit routes through src/game/flow on the same
// page. No reload between matches; the menu and a rematch are one click.

import { type Presentation, startPresentation } from './game/boot';
import { nextStep, type PostMatchAction } from './game/flow';
import { requestGameFullscreen } from './game/fullscreen';
import { parseJoinCode } from './game/invite';
import { getSettings } from './game/settings';
import { ClientWorld } from './net/client_world';
import type { ServerMsg } from './net/protocol';
import { BOTS, DEFAULT_BOT_ID } from './sim/content/bots';
import { CHAMPION_LIST } from './sim/content/champions';
import { Sim } from './sim/sim';
import { type AbilityKey, DT } from './sim/types';
import {
  type HomeChoice,
  type LobbyController,
  type QueueController,
  type SelectController,
  showHome,
  showLobby,
  showNotice,
  showQueue,
  showSelect,
} from './ui/menu';
import type { IWorld } from './world_api';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('missing #app root element');
const container = app;

interface OfflinePick {
  championId: string;
  sigils: [string, string];
  skin: number;
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

// One offline practice match; resolves with the exit the player chose.
function runOffline(pick: OfflinePick): Promise<PostMatchAction> {
  return new Promise((resolve) => {
    const sim = new Sim(42);
    const world: IWorld = sim;
    const self = sim.addChampion(0, undefined, pick.championId, pick.skin);
    self.sigils = [...pick.sigils];
    // A full 5v5: your four allies and all five opponents are Policy bots,
    // with deterministic skin variety (the sim clamps out-of-range picks).
    const roster = CHAMPION_LIST.filter((c) => c.id !== pick.championId).map((c) => c.id);
    for (let i = 0; i < 4; i++) {
      const ally = sim.addChampion(0, undefined, roster[i]!, i % 3);
      sim.attachPolicy(ally.id, BOTS[DEFAULT_BOT_ID]!.policy);
    }
    for (let i = 0; i < 5; i++) {
      const enemy = sim.addChampion(1, undefined, roster[(i + 4) % roster.length]!, i % 3);
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
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ t: 'leave' }));
        ws.close();
      }
      resolve(action);
    };

    ws.addEventListener('open', () => {
      opened = true;
      // The stored session token lets the server hand back a seat we lost to
      // a disconnect or a reload; absent or expired it is simply ignored.
      let token: string | null = null;
      try {
        token = localStorage.getItem('loc-token');
      } catch {
        // storage may be unavailable
      }
      ws.send(JSON.stringify({ t: 'hello', name: choice.name, token: token ?? undefined }));
      if (choice.mode === 'queue') {
        ws.send(JSON.stringify({ t: 'queue' }));
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
        );
      } else if (choice.mode === 'join' && choice.code) {
        ws.send(JSON.stringify({ t: 'join_lobby', code: choice.code }));
        lobbyUi = showLobby(
          container,
          () => undefined,
          () => finish('menu'),
          (team) => ws.send(JSON.stringify({ t: 'lobby_team', team })),
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
          queueUi?.setStatus(msg.count, msg.needed, msg.startsIn, msg.ready);
          break;
        case 'lobby':
          lobbyUi?.update(msg.code, msg.host, msg.team, msg.players);
          break;
        case 'select_start':
          clearMenus();
          selectUi = showSelect(
            container,
            msg.players,
            msg.team,
            msg.deadline,
            (champ, sigils, skin) => {
              // Inside the lock-in click gesture, so the browser grants it.
              requestGameFullscreen();
              ws.send(JSON.stringify({ t: 'pick', championId: champ, sigils, skin }));
            },
          );
          break;
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
          // Keep the browser's existing token: the server adopts a presented
          // token, so overwriting it with the fresh one would orphan the next
          // reconnect. Only a first-time browser stores the issued token.
          try {
            if (!localStorage.getItem('loc-token')) localStorage.setItem('loc-token', msg.token);
          } catch {
            // ignore
          }
          break;
        case 'match_start':
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
            pres.setNetHooks({
              sendChat: (text) => ws.send(JSON.stringify({ t: 'chat', text })),
              sendPing: (x, z) => ws.send(JSON.stringify({ t: 'ping', x, z })),
            });
          }
          if (changed) {
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
          pres?.setMatchResult(msg.rated, msg.delta, msg.rating);
          break;
        case 'match_end':
          // The end overlay (stats, Play again, Return to menu) owns the way
          // out; without a presentation there is nothing to look at, go home.
          matchEnded = true;
          if (!pres) finish('menu');
          break;
        case 'error':
          // Pre-game refusals (bad lobby code, closed lobby) must reach the
          // player, not the console: clear whichever menu is up and say it.
          console.warn('server:', msg.message);
          if (!pres) {
            clearMenus();
            selectUi?.remove();
            selectUi = null;
            void showNotice(container, 'Notice', msg.message).then(() => finish('menu'));
          }
          break;
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
  // The app loop: home, one match, back, forever on the same page. 'again'
  // replays the same offline pick or re-enters the public queue (flow.ts).
  let next: HomeChoice | null = null;
  let lastPick: OfflinePick | null = null;
  if (joinCode !== null) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('loc-name');
    } catch {
      // storage may be unavailable
    }
    if (stored) next = { name: stored, mode: 'join', code: joinCode };
  }
  for (;;) {
    const choice: HomeChoice = next ?? (await showHome(container, joinCode ?? undefined));
    joinCode = null;
    next = null;
    let action: PostMatchAction;
    if (choice.mode === 'practice') {
      const pick: OfflinePick = lastPick ?? (await pickForPractice());
      lastPick = pick;
      action = await runOffline(pick);
    } else {
      action = await runOnline(choice);
    }
    const step = nextStep(action, choice.mode);
    if (step === 'replay') {
      next = choice;
    } else if (step === 'requeue') {
      next = { name: choice.name, mode: 'queue' };
    } else {
      lastPick = null;
    }
  }
}

void boot();

// Client entry: home menu, then either the offline practice sim or the
// online flow (queue or lobby, champion select, then the mirror world fed by
// server snapshots). Both paths run the exact same presentation over IWorld.

import { startPresentation } from './game/boot';
import { ClientWorld } from './net/client_world';
import type { ServerMsg } from './net/protocol';
import { BOTS, DEFAULT_BOT_ID } from './sim/content/bots';
import { CHAMPION_LIST } from './sim/content/champions';
import { Sim } from './sim/sim';
import { DT } from './sim/types';
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

function startOffline(championId: string, sigils: [string, string], skin: number): void {
  const sim = new Sim(42);
  const world: IWorld = sim;
  const self = sim.addChampion(0, undefined, championId, skin);
  self.sigils = [...sigils];
  // A full 5v5: your four allies and all five opponents are Policy bots,
  // with deterministic skin variety (the sim clamps out-of-range picks).
  const roster = CHAMPION_LIST.filter((c) => c.id !== championId).map((c) => c.id);
  for (let i = 0; i < 4; i++) {
    const ally = sim.addChampion(0, undefined, roster[i]!, i % 3);
    sim.attachPolicy(ally.id, BOTS[DEFAULT_BOT_ID]!.policy);
  }
  for (let i = 0; i < 5; i++) {
    const enemy = sim.addChampion(1, undefined, roster[(i + 4) % roster.length]!, i % 3);
    sim.attachPolicy(enemy.id, BOTS[DEFAULT_BOT_ID]!.policy);
  }

  const pres = startPresentation(container, world, self.id, self.team);
  const TICK_MS = DT * 1000;
  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= TICK_MS) {
      const kills: { unitId: number; killerId: number }[] = [];
      const golds: number[] = [];
      const casts: number[] = [];
      const hits: { targetId: number; amount: number }[] = [];
      const attacks: { unitId: number; targetId: number }[] = [];
      for (const ev of sim.tick()) {
        if (ev.type === 'death') kills.push({ unitId: ev.unitId, killerId: ev.killerId });
        else if (ev.type === 'gold' && ev.unitId === self.id) golds.push(ev.amount);
        else if (ev.type === 'cast' || ev.type === 'sigil') casts.push(ev.unitId);
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
}

function startOnline(choice: HomeChoice): void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  const world = new ClientWorld((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });

  let queueUi: QueueController | null = null;
  let lobbyUi: LobbyController | null = null;
  let selectUi: SelectController | null = null;
  let pres: ReturnType<typeof startPresentation> | null = null;
  let opened = false;
  let matchEnded = false;

  const clearMenus = (): void => {
    queueUi?.remove();
    queueUi = null;
    lobbyUi?.remove();
    lobbyUi = null;
  };

  ws.addEventListener('open', () => {
    opened = true;
    ws.send(JSON.stringify({ t: 'hello', name: choice.name }));
    if (choice.mode === 'queue') {
      ws.send(JSON.stringify({ t: 'queue' }));
      queueUi = showQueue(
        container,
        () => ws.send(JSON.stringify({ t: 'start_now' })),
        () => {
          ws.send(JSON.stringify({ t: 'leave' }));
          window.location.reload();
        },
      );
    } else if (choice.mode === 'create') {
      ws.send(JSON.stringify({ t: 'create_lobby' }));
      lobbyUi = showLobby(
        container,
        () => ws.send(JSON.stringify({ t: 'start_lobby' })),
        () => {
          ws.send(JSON.stringify({ t: 'leave' }));
          window.location.reload();
        },
      );
    } else if (choice.mode === 'join' && choice.code) {
      ws.send(JSON.stringify({ t: 'join_lobby', code: choice.code }));
      lobbyUi = showLobby(
        container,
        () => undefined,
        () => {
          ws.send(JSON.stringify({ t: 'leave' }));
          window.location.reload();
        },
      );
    }
  });

  ws.addEventListener('message', (event) => {
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
        lobbyUi?.update(msg.code, msg.host, msg.players);
        break;
      case 'select_start':
        clearMenus();
        selectUi = showSelect(
          container,
          msg.players,
          msg.team,
          msg.deadline,
          (champ, sigils, skin) => {
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
      case 'ping':
        pres?.showPing(msg.x, msg.z, msg.from, msg.team);
        break;
      case 'match_start':
        world.applyServer(msg);
        selectUi?.remove();
        selectUi = null;
        break;
      case 'snap': {
        const changed = world.applyServer(msg);
        if (!pres && world.selfUnitId !== 0 && world.units.has(world.selfUnitId)) {
          pres = startPresentation(container, world, world.selfUnitId, world.selfTeam);
          pres.setNetHooks({
            sendChat: (text) => ws.send(JSON.stringify({ t: 'chat', text })),
            sendPing: (x, z) => ws.send(JSON.stringify({ t: 'ping', x, z })),
          });
        }
        if (changed) {
          const kills: { unitId: number; killerId: number }[] = [];
          const golds: number[] = [];
          const casts: number[] = [];
          const hits: { targetId: number; amount: number }[] = [];
          const attacks: { unitId: number; targetId: number }[] = [];
          for (const e of msg.events) {
            if (e.e === 'death') kills.push({ unitId: e.unitId, killerId: e.killerId });
            else if (e.e === 'gold') golds.push(e.amount);
            else if (e.e === 'cast') casts.push(e.unitId);
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
      case 'match_end':
        // The end overlay (stats + Return to menu) owns the way out; only
        // fall back to a reload when no presentation ever started.
        matchEnded = true;
        if (!pres) window.location.reload();
        break;
      case 'error':
        console.warn('server:', msg.message);
        break;
      default:
        break;
    }
  });

  ws.addEventListener('close', () => {
    // A close after the match ended is the server reaping the room, not a
    // failure; the end screen is already up.
    if (matchEnded) return;
    if (!opened) {
      showNotice(
        container,
        'Server unreachable',
        'Could not reach the game server. Start it in another terminal with "pnpm server" ' +
          '(keep it running), restart "pnpm dev" if it predates vite.config.ts, then try again.',
      );
    } else {
      showNotice(container, 'Disconnected', 'Lost the connection to the server.');
    }
  });
}

async function boot(): Promise<void> {
  const choice = await showHome(container);
  if (choice.mode === 'practice') {
    const picker = showSelect(container, null, 0, null, (championId, sigils, skin) => {
      picker.remove();
      startOffline(championId, sigils, skin);
    });
    return;
  }
  startOnline(choice);
}

void boot();

// Client entry: home menu, then either the offline practice sim or the
// online flow (queue or lobby, champion select, then the mirror world fed by
// server snapshots). Both paths run the exact same presentation over IWorld.

import { startPresentation } from './game/boot';
import { ClientWorld } from './net/client_world';
import type { ServerMsg } from './net/protocol';
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

function startOffline(championId: string, sigils: [string, string]): void {
  const sim = new Sim(42);
  const world: IWorld = sim;
  const self = sim.addChampion(0, undefined, championId);
  self.sigils = [...sigils];
  // Practice dummies until Policy bots land in phase 7.
  sim.addChampion(1, { x: 66, z: 66 }, 'korrath');
  sim.addChampion(1, { x: 80, z: 80 }, 'vesk');

  const pres = startPresentation(container, world, self.id, self.team);
  const TICK_MS = DT * 1000;
  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    acc += Math.min(now - last, 250);
    last = now;
    while (acc >= TICK_MS) {
      sim.tick();
      pres.onWorldTick();
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
        queueUi?.setStatus(msg.count, msg.needed);
        break;
      case 'lobby':
        lobbyUi?.update(msg.code, msg.host, msg.players);
        break;
      case 'select_start':
        clearMenus();
        selectUi = showSelect(container, msg.players, msg.team, msg.deadline, (champ, sigils) => {
          ws.send(JSON.stringify({ t: 'pick', championId: champ, sigils }));
        });
        break;
      case 'select_update':
        selectUi?.setLocked(msg.locked, msg.total);
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
        }
        if (changed) pres?.onWorldTick();
        break;
      }
      case 'match_end':
        window.location.reload();
        break;
      case 'error':
        console.warn('server:', msg.message);
        break;
      default:
        break;
    }
  });

  ws.addEventListener('close', () => {
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
    const picker = showSelect(container, null, 0, null, (championId, sigils) => {
      picker.remove();
      startOffline(championId, sigils);
    });
    return;
  }
  startOnline(choice);
}

void boot();

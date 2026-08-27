// The live matches panel on the home screen: running matches from
// /api/live, one Watch button per side (spectating is one team's fog).
// The home screen listens for the event and routes into spectate mode.

const CSS = `
.live-panel { margin: 8px 0; font-size: 12px; color: #c9d8ae; text-align: left; }
.live-row {
  border: 1px solid #3a4f28; border-radius: 6px; margin-top: 4px;
  background: #17210f; padding: 6px 8px;
}
.live-head { display: flex; justify-content: space-between; color: #93a87c; font-size: 11px; }
.live-teams { display: flex; gap: 10px; margin-top: 4px; align-items: center; }
.live-side { flex: 1; min-width: 0; }
.live-side.blue { color: #9dbcf5; }
.live-side.red { color: #f5a3a3; }
.live-watch {
  padding: 2px 8px; border-radius: 4px; border: 1px solid #466030; margin-top: 2px;
  background: #1d2a14; color: #c9d8ae; font-size: 10px; font-weight: 700; cursor: pointer;
}
.live-watch:hover { border-color: #7ca050; }
.live-sub { color: #93a87c; margin: 4px 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

interface LiveMatch {
  id: number;
  durationS: number;
  spectators: number;
  players: { name: string; team: 0 | 1 }[];
}

export function buildLivePanel(): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'live-panel';
  box.textContent = 'Looking for live matches...';
  fetch('/api/live')
    .then((r) => (r.ok ? (r.json() as Promise<LiveMatch[]>) : null))
    .then((list) => {
      box.textContent = '';
      if (!list || list.length === 0) {
        const sub = document.createElement('div');
        sub.className = 'live-sub';
        sub.textContent = 'No live match right now. Start one and it shows up here.';
        box.appendChild(sub);
        return;
      }
      for (const m of list) {
        const row = document.createElement('div');
        row.className = 'live-row';
        const head = document.createElement('div');
        head.className = 'live-head';
        const mins = Math.floor(m.durationS / 60);
        const secs = String(m.durationS % 60).padStart(2, '0');
        const left = document.createElement('span');
        left.textContent = `Match ${m.id}, ${mins}:${secs}`;
        const right = document.createElement('span');
        right.textContent = m.spectators > 0 ? `${m.spectators} watching` : '';
        head.append(left, right);
        const teams = document.createElement('div');
        teams.className = 'live-teams';
        for (const team of [0, 1] as const) {
          const side = document.createElement('div');
          side.className = `live-side ${team === 0 ? 'blue' : 'red'}`;
          const names = m.players.filter((p) => p.team === team).map((p) => p.name);
          side.textContent = names.length > 0 ? names.join(', ') : 'Bots';
          const watch = document.createElement('button');
          watch.className = 'live-watch';
          watch.textContent = `Watch team ${team + 1}`;
          watch.addEventListener('click', () => {
            window.dispatchEvent(
              new CustomEvent('loc:spectate', { detail: { matchId: m.id, team } }),
            );
          });
          side.append(document.createElement('br'), watch);
          teams.appendChild(side);
        }
        row.append(head, teams);
        box.appendChild(row);
      }
    })
    .catch(() => {
      box.textContent = 'Live list unavailable: the game server is not reachable.';
    });
  return box;
}

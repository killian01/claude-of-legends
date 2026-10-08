// A dev harness for the battle royale's screens, on the dev server only
// (src/main.ts loads it behind import.meta.env.DEV and ?royale-ui-demo,
// so a build never carries it): the quick pick, the home's row, and the
// HUD and the end screens over an offline match on the Star Orchard fed
// mock royale state, for the browser checks to look at before the server
// and the planet exist. Nothing here is reachable from the production UI.
//
// ?royale-ui-demo=<scene>: pick, pick-one, home, drop (with a Graft
// offer), calm (with the status chips and a Heartwood offer), closing, out, end-one, end-respawn, moments (the loud
// moments: the Seedfalls' edge arrows, the Clamors, the feed folding, the
// run's spotlight, the cache's ritual and the loot's words, the Dusk's
// pill, every new block faked).

import { orchardSim } from '../net/replay';
import type { RoyaleNote } from '../net/royale_client';
import type {
  RoyaleResult,
  SnapClamor,
  SnapGraftOffer,
  SnapRoyale,
  SnapSeedfall,
} from '../net/royale_wire';
import { whenChampionModelsReady } from '../render/champions';
import { setRoyaleProjector } from '../render/royale_cues';
import { attachBot } from '../sim/content/bots';
import { ITEM_LIST } from '../sim/content/items';
import type { RoyaleVariant } from '../sim/royale/types';
import type { ScoreRow } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { AuthedAccount } from '../ui/auth';
import { showHome } from '../ui/home_screen';
import { showRoyalePick } from '../ui/royale_pick';
import { DEFAULT_SIGILS } from '../ui/royale_pick_rules';
import type { IWorld } from '../world_api';
import { startPresentation } from './boot';
import { installNav } from './nav';
import { loadStarOrchardTerrain } from './star_orchard';
import { loadStarOrchard } from './star_orchard_records';

// Invented names for the mock seats, every other one a bot.
const NAMES = [
  'Kestrel',
  'Ashgrove',
  'Morrow',
  'Tamsin',
  'Vireo',
  'Halden',
  'Quill',
  'Sorrel',
  'Bramwell',
];

const ROSTER = ['torv', 'vesk', 'sylra', 'dain', 'maera', 'fenn', 'korrath', 'elowen', 'rhoka'];

function result(v: RoyaleVariant, place: number, score: number): RoyaleResult {
  return {
    t: 'royale_result',
    v,
    place,
    of: 50,
    score,
    winner: 'Kestrel',
    top: [14, 12, 10, 8, 6, 5, 4, 3, 2, 1].slice(0, v === 'one_life' ? 5 : 10).map((s, i) => ({
      name: i + 1 === place ? 'Wanderer 4821' : (NAMES[i % NAMES.length] ?? 'Seat'),
      championId: i + 1 === place ? 'ashvyn' : (ROSTER[i % ROSTER.length] ?? 'torv'),
      score: i + 1 === place ? score : s,
      bot: i + 1 !== place && i % 2 === 0,
    })),
    grafts: ['thornhide', 'keen_edge', 'keen_edge', 'chainsap'],
  };
}

export async function runRoyaleDemo(container: HTMLElement): Promise<void> {
  installNav();
  const scene = new URLSearchParams(window.location.search).get('royale-ui-demo') || 'calm';
  if (scene === 'pick' || scene === 'pick-one') {
    showRoyalePick(container, {
      variant: scene === 'pick' ? 'respawn' : 'one_life',
      initial: { championId: 'ashvyn', skin: 1, sigils: [...DEFAULT_SIGILS] },
      onPlay: (pick) => console.log('play', JSON.stringify(pick)),
      onBack: () => console.log('back'),
    });
    return;
  }
  if (scene === 'home') {
    const account: AuthedAccount = {
      id: 1,
      name: 'Demo',
      rating: 1000,
      ratedGames: 0,
      email: null,
      emailConfirmed: false,
      discord: null,
    };
    const choice = await showHome(container, account);
    console.log('home', JSON.stringify(choice));
    return;
  }

  const orchard = await loadStarOrchard();
  const terrain = await loadStarOrchardTerrain(orchard, () => undefined);
  await whenChampionModelsReady([], () => undefined);
  const sim = orchardSim(orchard, 7);
  const self = sim.addChampion(0, undefined, 'ashvyn', 1);
  self.sigils = [...DEFAULT_SIGILS];
  sim.setLevel(self.id, 3);
  for (const key of ['Q', 'W', 'E'] as const) sim.levelAbility(self.id, key);
  const others: Unit[] = [];
  for (const [i, championId] of ROSTER.entries()) {
    const near = { x: self.pos.x + 4 + (i % 3) * 2, z: self.pos.z + 3 + Math.floor(i / 3) * 2 };
    const u = sim.addChampion(i < 2 ? 1 : ((i % 2) as 0 | 1), i < 2 ? near : undefined, championId);
    attachBot(sim, u.id, 'laner');
    others.push(u);
  }
  const names = new Map<number, { name: string; bot: boolean }>();
  names.set(self.id, { name: 'Wanderer 4821', bot: false });
  for (const [i, u] of others.entries()) {
    names.set(u.id, { name: NAMES[i] ?? 'Seat', bot: i % 2 === 0 });
  }

  const variant: RoyaleVariant =
    scene === 'closing' || scene === 'out' || scene === 'end-one' || scene === 'moments'
      ? 'one_life'
      : 'respawn';
  const moments = scene === 'moments';
  // The loud moments' blocks, faked: two Seedfalls (one called and one
  // landed), a Clamor every two seconds, a Lodestar's mark.
  const seedfalls = (t: number): SnapSeedfall[] => [
    [1, -60, 50, 10, t + 12, 0],
    [2, 50, 60, -20, t - 3, 1],
  ];
  let clamors: SnapClamor[] = [];
  if (moments) {
    // The two Seedfalls off the screen: one to the left, one behind the
    // camera; the screen is the stage's.
    setRoyaleProjector({
      project: (p) => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        return p.x < 0
          ? { x: -0.4 * w, y: 0.35 * h, behind: false }
          : { x: 0.62 * w, y: 0.2 * h, behind: true };
      },
      bearing: () => 0.8,
      self: () => ({ x: 0, y: 80, z: 0 }),
      view: () => ({ width: window.innerWidth, height: window.innerHeight }),
    });
  }
  const leader = others[0]!;
  // A Graft offer open for ten seconds out of every twelve (CONTEXT.md:
  // Graft); a pick hides it until the next.
  const offer = (g: SnapGraftOffer['g'], c: SnapGraftOffer['c'], t: number) =>
    t % 12 < 10 ? { offer: { g, c, u: Math.floor(t / 12) * 12 + 10 } } : {};
  const state = (): SnapRoyale & { caches: [] } => {
    const t = sim.time;
    const base = {
      v: variant,
      de: 0,
      end: 600,
      alive: 37,
      people: 2,
      caches: [] as [],
    };
    if (scene === 'drop') {
      return {
        ...base,
        st: 'drop',
        de: 9.5,
        alive: 50,
        dusk: { p: 0, c: [0, 80, 0], r: 160, pe: 99.5, sh: 0, b: 0 },
        ...offer('bough', ['second_breath', 'stoneblood', 'thornhide'], t),
      };
    }
    if (scene === 'calm' || scene === 'end-respawn') {
      return {
        ...base,
        st: 'play',
        dusk: { p: 0, c: [0, 80, 0], r: 160, pe: 65, sh: 0, b: 0 },
        score: 4,
        leader: { i: leader.id, s: 9, ...(Math.floor(t / 4) % 2 === 0 ? { at: [0, 80, 0] } : {}) },
        opening: { c: 3, since: Math.floor(t / 2.5) * 2.5 },
        gr: ['hunters_eye', 'keen_edge'],
        ...offer('heartwood', ['reaping_graft', 'chainsap', 'overgrowth'], t),
      };
    }
    if (moments) {
      return {
        ...base,
        st: 'play',
        dusk: { p: 3, c: [0, 80, 0], r: 40, pe: t + 18, sh: 1, b: 0.03 },
        opening: { c: 3, since: Math.floor(t / 3) * 3, d: 2 },
        sf: seedfalls(t),
        cl: clamors,
        mk: [[leader.id, 'lodestar', 0, 80, 0, t]],
        ...offer('sprout', ['keen_edge', 'quick_sap', 'deep_roots'], t),
      };
    }
    return {
      ...base,
      st: 'play',
      dusk: { p: 3, c: [0, 80, 0], r: 40, pe: 18, sh: 1, b: 0.04 },
      place: scene === 'out' ? 37 : undefined,
    };
  };
  const world = new Proxy(sim, {
    get(target, key) {
      if (key === 'royaleView') return state;
      if (key === 'scoreboard') {
        return (): ScoreRow[] =>
          target.scoreboard().map((row) => {
            const n = names.get(row.unitId);
            return n ? { ...row, player: n.name, bot: n.bot } : row;
          });
      }
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as IWorld;

  const pres = startPresentation(
    container,
    world,
    self.id,
    self.team,
    (action) => console.log('exit', action),
    { terrain, mode: 'online', guest: true, guide: 'play', royale: variant },
  );
  (window as unknown as { __royaleDemo?: unknown }).__royaleDemo = { pres, sim, self };
  if (scene === 'end-one') {
    window.setTimeout(() => pres.showRoyaleResult(result('one_life', 7, 3)), 600);
  } else if (scene === 'end-respawn') {
    window.setTimeout(() => {
      // What the seat banked, for the goal across matches on the card
      // (ui/royale_goal.ts): nine takedowns, four assists, three caches.
      for (let i = 0; i < 9; i++) pres.showPoints(10, 10 * (i + 1), 'kill');
      for (let i = 0; i < 4; i++) pres.showPoints(5, 90 + 5 * (i + 1), 'assist');
      for (let i = 0; i < 3; i++) pres.showPoints(1, 110 + i + 1, 'cache');
      pres.showRoyaleResult(result('respawn', 3, 9));
    }, 600);
  }
  const items = ITEM_LIST.filter((i) => i.tier === 2);
  // The notices run on the wall clock: a software renderer steps the sim
  // slower than real time, and the screenshots are taken on the clock.
  const start = performance.now();
  const wall = (): number => (performance.now() - start) / 1000;
  let nextKill = 0.8;
  let nextLoot = 1.5;
  let nextLevel = 3;
  let k = 0;
  window.setInterval(() => {
    const events = sim.tick();
    const t = sim.time;
    const w = wall();
    if (scene === 'closing' || moments) (self.pos as { y?: number }).y = -80;
    if (moments && Math.floor(t * 10) % 40 === 0) clamors = [[3, 79, 4, t]];
    if (scene === 'out') {
      self.dead = true;
      self.hp = 0;
      self.respawnAt = t + 999;
    }
    const kills: { unitId: number; killerId: number }[] = [];
    for (const ev of events) {
      if (ev.type === 'death') kills.push({ unitId: ev.unitId, killerId: ev.killerId });
    }
    const royale: RoyaleNote[] = [];
    if (w >= nextKill) {
      nextKill = w + 1.2;
      k++;
      const a = others[k % others.length]!;
      const b = others[(k + 3) % others.length]!;
      // The moments: the viewer on a run (a takedown every other one), and
      // the rest of the planet folding away.
      const own = moments ? k % 2 === 0 : k % 4 === 0;
      kills.push(own ? { unitId: b.id, killerId: self.id } : { unitId: b.id, killerId: a.id });
    }
    if ((scene === 'calm' || moments) && w >= nextLoot) {
      nextLoot = w + 2.4;
      const itemId = moments
        ? (['iron_blade', 'doombrand', 'heart_gem', 'warbrand'][k % 4] ?? 'iron_blade')
        : items[k % items.length]!.id;
      // The loot lands in the bag, as the sim equips it.
      if (self.items.length < 6) self.items.push(itemId);
      royale.push({ kind: 'loot', unitId: self.id, itemId, source: 'cache' });
    }
    // The status chips the playtest could not read ("BO", "MA x1", "AI
    // 0.1"): a camp's boost, a mark and a short lift, kept up.
    if (scene === 'calm') {
      const has = (kind: string): boolean => self.statuses.some((s) => s.kind === kind);
      if (!has('buff')) {
        self.statuses.push({ kind: 'buff', until: t + 6, msPct: 0, asPct: 0.2, armor: 0, mr: 0 });
      }
      if (!has('mark')) {
        self.statuses.push({ kind: 'mark', until: t + 4, stacks: 1, sourceId: others[0]!.id });
      }
      if (!has('airborne')) self.statuses.push({ kind: 'airborne', until: t + 0.9 });
    }
    if (scene === 'calm' && w >= nextLevel && self.level < 7) {
      nextLevel = w + 4;
      sim.setLevel(self.id, self.level + 1);
    }
    pres.onWorldTick({ kills, golds: [], casts: [], hits: [], attacks: [], royale });
  }, 50);
}

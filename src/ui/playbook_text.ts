// Playbooks in words: the one-line reading of a trigger and of a behavior
// the Academy's play list shows, and the field tables its small forms are
// built from. Pure functions over the data; the validator stays the
// authority on what is legal, these only make it readable and editable.

import { CHAMPION_LIST, CHAMPIONS } from '../sim/content/champions';
import { ITEM_LIST, ITEMS } from '../sim/content/items';
import type { PatchOp } from '../sim/playbook/patch';
import type { Behavior, KitDef, LaneId, SkillKey, Trigger } from '../sim/playbook/types';

export const itemName = (id: string): string => ITEMS[id]?.name ?? id;
export const championName = (id: string): string => CHAMPIONS[id]?.name.split(',')[0] ?? id;
const sideName = (side: 'own' | 'enemy'): string => (side === 'own' ? 'my team' : 'the enemy');
const roleCount = (t: { atLeast?: number; atMost?: number }): string => {
  const parts: string[] = [];
  if (t.atLeast !== undefined) parts.push(`at least ${t.atLeast}`);
  if (t.atMost !== undefined) parts.push(`at most ${t.atMost}`);
  return parts.join(' and ');
};

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function range(t: { below?: number; atLeast?: number }, fmt: (v: number) => string): string {
  const parts: string[] = [];
  if (t.atLeast !== undefined) parts.push(`at least ${fmt(t.atLeast)}`);
  if (t.below !== undefined) parts.push(`below ${fmt(t.below)}`);
  return parts.join(' and ');
}

function count(t: { within: number; atLeast?: number; atMost?: number }, what: string): string {
  const parts: string[] = [];
  if (t.atLeast !== undefined) parts.push(`at least ${t.atLeast}`);
  if (t.atMost !== undefined) parts.push(`at most ${t.atMost}`);
  return `${parts.join(' and ') || 'any number of'} ${what} within ${t.within}`;
}

export function describeTrigger(t: Trigger): string {
  switch (t.kind) {
    case 'always':
      return 'always';
    case 'hp':
      return `health ${range(t, pct)}`;
    case 'mana':
      return `mana ${range(t, pct)}`;
    case 'level':
      return `level ${range(t, String)}`;
    case 'gold':
      return `gold ${range(t, String)}`;
    case 'time':
      return `time ${range(t, (v) => `${Math.round(v)} s`)}`;
    case 'enemies':
      return count(t, 'enemy champions');
    case 'allies':
      return count(t, 'allied champions');
    case 'enemyVisible':
      return 'an enemy champion is in sight';
    case 'atFountain':
      return 'at the fountain';
    case 'underTower':
      return 'under an enemy tower';
    case 'warden':
      if (t.state === 'up') return 'the Warden is up';
      if (t.state === 'down') return 'no Warden is up';
      return `the Warden spawns within ${t.within ?? 20} s`;
    case 'abilityReady':
      return `${t.key} is ready`;
    case 'sigilReady':
      return `${t.id} is ready`;
    case 'lane':
      return `assigned to ${t.is}`;
    case 'order':
      return t.is === undefined ? 'the coach gave an order' : `the coach ordered ${t.is}`;
    case 'allyFighting':
      return `an ally within ${t.within} is fighting`;
    case 'champion':
      return `${sideName(t.side)} has ${championName(t.is)}`;
    case 'roles':
      return `${sideName(t.side)} fields ${roleCount(t)} ${t.role.toLowerCase()}`;
    case 'enemyDamage':
      return `the enemy deals mostly ${t.mostly} damage`;
    case 'enemyItem':
      return `a visible enemy wears ${itemName(t.item)}`;
    case 'laneOpponent':
      return `the lane opponent is ${championName(t.is)}`;
    case 'lanePartner':
      return `the lane partner is ${championName(t.is)}`;
    case 'not':
      return `not (${describeTrigger(t.of)})`;
    case 'all':
      return t.of.map(describeTrigger).join(' and ');
    case 'any':
      return t.of.map(describeTrigger).join(' or ');
  }
}

export function describeBehavior(b: Behavior): string {
  switch (b.kind) {
    case 'retreat':
      return 'run home';
    case 'hold':
      return 'hold still';
    case 'shop':
      return 'buy the next item';
    case 'goShop':
      return 'go home to shop';
    case 'avoidTower':
      return `step out of tower reach (escort under ${b.escortMin ?? 3} or health below ${pct(
        b.hpBelow ?? 0.65,
      )})`;
    case 'finishSanctum':
      return 'finish the Sanctum';
    case 'fight': {
      const whom =
        b.target === 'lowest'
          ? 'the lowest enemy champion'
          : b.target === 'squishiest'
            ? 'the squishiest enemy champion'
            : b.target === 'order'
              ? "the coach's focus, else the nearest enemy"
              : 'the nearest enemy champion';
      const how =
        b.stance === 'kite'
          ? ', kiting'
          : b.stance === 'front'
            ? ', walking in'
            : b.stance === 'poke'
              ? ', poking'
              : '';
      const alone = b.alone === 'hold' ? ', holding when alone' : '';
      return `fight ${whom}${how}${alone}`;
    }
    case 'sell':
      return `sell ${itemName(b.item)}`;
    case 'hunt':
      return `hunt a dying enemy out of sight (health above ${pct(b.hpAbove ?? 0.5)})`;
    case 'answerVanish':
      return `answer a vanished enemy (walk in when health at least ${pct(b.hpAtLeast ?? 0.55)})`;
    case 'contestWarden':
      return `contest the Warden (health at least ${pct(b.hpAtLeast ?? 0.5)}, prepare ${
        b.prepSeconds ?? 20
      } s early)`;
    case 'farm':
      return 'farm the nearest minion';
    case 'takeCamp':
      return 'take a jungle camp';
    case 'siege':
      return `siege a structure with ${b.escortMin ?? 3} minions`;
    case 'obeyOrder':
      return 'do what the coach ordered';
    case 'push': {
      const lane = b.lane === undefined || b.lane === 'assigned' ? 'the assigned lane' : b.lane;
      const regroup =
        b.regroupAt === null ? ', never regrouping' : `, regrouping mid at ${b.regroupAt ?? 720} s`;
      return `push ${lane}${regroup}`;
    }
    case 'followAlly':
      return `follow the nearest ally within ${b.keep ?? 3}`;
    case 'joinAlly':
      return `join an ally fighting within ${b.within ?? 40}`;
    case 'fallBack':
      return 'fall back under the nearest tower';
    case 'holdPosition':
      return `hold position at ${Math.round(b.x)}, ${Math.round(b.z)}`;
  }
}

// --- the forms ------------------------------------------------------------

export interface NumSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  // Shown as a percentage of 1 (health fractions).
  pct?: boolean;
}

export interface ChoiceSpec {
  key: string;
  label: string;
  options: readonly string[];
  // What each option reads as, when the value itself is not readable.
  labels?: readonly string[];
}

export interface KindForm {
  label: string;
  nums?: readonly NumSpec[];
  choices?: readonly ChoiceSpec[];
}

const HP: NumSpec[] = [
  { key: 'below', label: 'below', min: 0, max: 1, step: 0.05, pct: true },
  { key: 'atLeast', label: 'at least', min: 0, max: 1, step: 0.05, pct: true },
];

const SIDE_CHOICE: ChoiceSpec = {
  key: 'side',
  label: 'side',
  options: ['own', 'enemy'],
  labels: ['my team', 'the enemy'],
};
const CHAMPION_CHOICE: ChoiceSpec = {
  key: 'is',
  label: 'champion',
  options: CHAMPION_LIST.map((c) => c.id),
  labels: CHAMPION_LIST.map((c) => championName(c.id)),
};

export const TRIGGER_FORMS: Readonly<Record<Trigger['kind'], KindForm>> = {
  always: { label: 'always' },
  hp: { label: 'health', nums: HP },
  mana: { label: 'mana', nums: HP },
  level: {
    label: 'level',
    nums: [
      { key: 'below', label: 'below', min: 1, max: 18, step: 1 },
      { key: 'atLeast', label: 'at least', min: 1, max: 18, step: 1 },
    ],
  },
  gold: {
    label: 'gold',
    nums: [
      { key: 'below', label: 'below', min: 0, max: 20000, step: 50 },
      { key: 'atLeast', label: 'at least', min: 0, max: 20000, step: 50 },
    ],
  },
  time: {
    label: 'match time (s)',
    nums: [
      { key: 'below', label: 'before', min: 0, max: 3600, step: 30 },
      { key: 'atLeast', label: 'after', min: 0, max: 3600, step: 30 },
    ],
  },
  enemies: {
    label: 'enemy champions near',
    nums: [
      { key: 'within', label: 'within', min: 0, max: 200, step: 1 },
      { key: 'atLeast', label: 'at least', min: 0, max: 10, step: 1 },
      { key: 'atMost', label: 'at most', min: 0, max: 10, step: 1 },
    ],
  },
  allies: {
    label: 'allied champions near',
    nums: [
      { key: 'within', label: 'within', min: 0, max: 200, step: 1 },
      { key: 'atLeast', label: 'at least', min: 0, max: 10, step: 1 },
      { key: 'atMost', label: 'at most', min: 0, max: 10, step: 1 },
    ],
  },
  enemyVisible: { label: 'an enemy champion is in sight' },
  atFountain: { label: 'at the fountain' },
  underTower: { label: 'under an enemy tower' },
  warden: {
    label: 'the Warden',
    choices: [{ key: 'state', label: 'is', options: ['up', 'spawning', 'down'] }],
    nums: [{ key: 'within', label: 'spawning within (s)', min: 0, max: 600, step: 5 }],
  },
  abilityReady: {
    label: 'an ability is ready',
    choices: [{ key: 'key', label: 'key', options: ['Q', 'W', 'E', 'R'] }],
  },
  sigilReady: {
    label: 'a sigil is ready',
    choices: [{ key: 'id', label: 'sigil', options: ['riftstep', 'zephyr', 'mend', 'sear'] }],
  },
  lane: {
    label: 'assigned lane',
    choices: [{ key: 'is', label: 'is', options: ['top', 'mid', 'bot'] }],
  },
  order: {
    label: 'the coach gave an order',
    choices: [
      {
        key: 'is',
        label: 'of kind',
        options: ['goto', 'warden', 'focus', 'back', 'group', 'hold'],
      },
    ],
  },
  allyFighting: {
    label: 'an ally is fighting',
    nums: [{ key: 'within', label: 'within', min: 0, max: 200, step: 1 }],
  },
  champion: {
    label: 'a champion is in the match',
    choices: [SIDE_CHOICE, CHAMPION_CHOICE],
  },
  roles: {
    label: 'a side fields a role',
    choices: [
      SIDE_CHOICE,
      {
        key: 'role',
        label: 'role',
        options: [
          'Tank',
          'Fighter',
          'Mage',
          'Battlemage',
          'Assassin',
          'Marksman',
          'Support',
          'Skirmisher',
        ],
      },
    ],
    nums: [
      { key: 'atLeast', label: 'at least', min: 0, max: 5, step: 1 },
      { key: 'atMost', label: 'at most', min: 0, max: 5, step: 1 },
    ],
  },
  enemyDamage: {
    label: 'the enemy deals mostly',
    choices: [{ key: 'mostly', label: 'damage', options: ['magic', 'physical'] }],
  },
  enemyItem: {
    label: 'a visible enemy wears',
    choices: [
      {
        key: 'item',
        label: 'item',
        options: ITEM_LIST.map((i) => i.id),
        labels: ITEM_LIST.map((i) => i.name),
      },
    ],
  },
  laneOpponent: { label: 'the lane opponent is', choices: [CHAMPION_CHOICE] },
  lanePartner: { label: 'the lane partner is', choices: [CHAMPION_CHOICE] },
  not: { label: 'not' },
  all: { label: 'all of' },
  any: { label: 'any of' },
};

export const BEHAVIOR_FORMS: Readonly<Record<Behavior['kind'], KindForm>> = {
  retreat: { label: 'run home' },
  hold: { label: 'hold still' },
  shop: { label: 'buy the next item' },
  goShop: { label: 'go home to shop' },
  avoidTower: {
    label: 'step out of tower reach',
    nums: [
      { key: 'escortMin', label: 'unless escorted by', min: 0, max: 10, step: 1 },
      { key: 'hpBelow', label: 'or health below', min: 0, max: 1, step: 0.05, pct: true },
    ],
  },
  finishSanctum: { label: 'finish the Sanctum' },
  fight: {
    label: 'fight an enemy champion',
    choices: [
      {
        key: 'stance',
        label: 'stance',
        options: ['auto', 'kite', 'front', 'poke'],
        labels: ['auto (kite when ranged)', 'kite', 'walk in', 'poke'],
      },
      {
        key: 'target',
        label: 'target',
        options: ['nearest', 'lowest', 'squishiest', 'order'],
        labels: ['the nearest', 'the lowest', 'the squishiest', "the coach's focus"],
      },
      {
        key: 'alone',
        label: 'alone',
        options: ['engage', 'hold'],
        labels: ['engage anyway', 'hold, strike only in reach'],
      },
    ],
  },
  sell: {
    label: 'sell an item',
    choices: [
      {
        key: 'item',
        label: 'item',
        options: ITEM_LIST.map((i) => i.id),
        labels: ITEM_LIST.map((i) => `${i.name} (${i.cost})`),
      },
    ],
  },
  hunt: {
    label: 'hunt a dying enemy out of sight',
    nums: [{ key: 'hpAbove', label: 'when health above', min: 0, max: 1, step: 0.05, pct: true }],
  },
  answerVanish: {
    label: 'answer a vanished enemy',
    nums: [
      {
        key: 'hpAtLeast',
        label: 'walk in when health at least',
        min: 0,
        max: 1,
        step: 0.05,
        pct: true,
      },
    ],
  },
  contestWarden: {
    label: 'contest the Warden',
    nums: [
      { key: 'hpAtLeast', label: 'when health at least', min: 0, max: 1, step: 0.05, pct: true },
      { key: 'prepSeconds', label: 'prepare (s) before spawn', min: 0, max: 300, step: 5 },
    ],
  },
  farm: { label: 'farm the nearest minion' },
  takeCamp: { label: 'take a jungle camp' },
  siege: {
    label: 'siege a structure',
    nums: [{ key: 'escortMin', label: 'with minions', min: 0, max: 10, step: 1 }],
  },
  obeyOrder: { label: 'do what the coach ordered' },
  push: {
    label: 'push a lane',
    choices: [{ key: 'lane', label: 'lane', options: ['assigned', 'top', 'mid', 'bot'] }],
    nums: [{ key: 'regroupAt', label: 'regroup mid after (s)', min: 0, max: 7200, step: 30 }],
  },
  followAlly: {
    label: 'follow the nearest ally',
    nums: [{ key: 'keep', label: 'stay within', min: 0, max: 50, step: 1 }],
  },
  joinAlly: {
    label: 'join an ally in a fight',
    nums: [{ key: 'within', label: 'within', min: 0, max: 200, step: 5 }],
  },
  fallBack: { label: 'fall back under the nearest tower' },
  holdPosition: {
    label: 'hold a position',
    nums: [
      { key: 'x', label: 'x', min: 0, max: 400, step: 1 },
      { key: 'z', label: 'z', min: 0, max: 400, step: 1 },
      { key: 'within', label: 'within', min: 0, max: 50, step: 1 },
    ],
  },
};

// A fresh, valid instance of each kind, for the "add" menus.
export function freshTrigger(kind: Trigger['kind']): Trigger {
  switch (kind) {
    case 'hp':
    case 'mana':
      return { kind, below: 0.5 };
    case 'level':
      return { kind, atLeast: 6 };
    case 'gold':
      return { kind, atLeast: 1000 };
    case 'time':
      return { kind, atLeast: 600 };
    case 'enemies':
      return { kind, within: 15, atLeast: 1 };
    case 'allies':
      return { kind, within: 15, atLeast: 1 };
    case 'warden':
      return { kind, state: 'up' };
    case 'abilityReady':
      return { kind, key: 'R' };
    case 'sigilReady':
      return { kind, id: 'mend' };
    case 'lane':
      return { kind, is: 'mid' };
    case 'allyFighting':
      return { kind, within: 40 };
    case 'champion':
      return { kind, side: 'enemy', is: 'vesk' };
    case 'roles':
      return { kind, side: 'enemy', role: 'Mage', atLeast: 1 };
    case 'enemyDamage':
      return { kind, mostly: 'magic' };
    case 'enemyItem':
      return { kind, item: 'warbrand' };
    case 'laneOpponent':
    case 'lanePartner':
      return { kind, is: 'vesk' };
    case 'not':
      return { kind, of: { kind: 'enemyVisible' } };
    case 'all':
    case 'any':
      return { kind, of: [{ kind: 'enemyVisible' }] };
    default:
      return { kind };
  }
}

export function freshBehavior(kind: Behavior['kind']): Behavior {
  switch (kind) {
    case 'holdPosition':
      return { kind, x: 100, z: 100 };
    case 'sell':
      return { kind, item: 'heart_gem' };
    case 'push':
      return { kind, lane: 'assigned' as LaneId | 'assigned' };
    default:
      return { kind } as Behavior;
  }
}

export const TRIGGER_KINDS = Object.keys(TRIGGER_FORMS) as Trigger['kind'][];
export const BEHAVIOR_KINDS = Object.keys(BEHAVIOR_FORMS) as Behavior['kind'][];

// A patch operation in words, for the Briefing's proposal.
export function describeOp(op: PatchOp): string {
  switch (op.op) {
    case 'add': {
      const where = op.before ? ` before "${op.before}"` : ' at the end';
      return `add "${op.play.id}"${where}: when ${describeTrigger(op.play.when)}, ${describeBehavior(op.play.do)}`;
    }
    case 'remove':
      return `remove "${op.id}"`;
    case 'move':
      return op.before === null
        ? `move "${op.id}" to the end`
        : `move "${op.id}" before "${op.before}"`;
    case 'set': {
      const parts: string[] = [];
      if (op.play.when) parts.push(`when ${describeTrigger(op.play.when)}`);
      if (op.play.do) parts.push(describeBehavior(op.play.do));
      if (op.play.enabled !== undefined) parts.push(op.play.enabled ? 'enabled' : 'disabled');
      return `change "${op.id}": ${parts.join(', ') || 'nothing'}`;
    }
    case 'kit': {
      const parts: string[] = [];
      const k = op.kit;
      if (k.build === null) parts.push('build back to the role build');
      else if (k.build) parts.push(`build ${k.build.map(itemName).join(', ')}`);
      if (k.skills === null) parts.push('max order back to Q, W, E');
      else if (k.skills) parts.push(`max ${k.skills.join(' then ')}`);
      if (k.variants === null) parts.push('no variants');
      else if (k.variants) parts.push(`${k.variants.length} variant(s)`);
      return `kit: ${parts.join('; ') || 'nothing'}`;
    }
    case 'lanes':
      return op.lanes && op.lanes.length > 0
        ? `lane preference: ${op.lanes.join(', then ')}`
        : 'lane preference: none, the home lane';
    case 'replace':
      return `replace the whole playbook (${op.playbook.plays.length} plays)`;
  }
}

// The kit in words: what the bot works toward, for the Briefing and the
// rail. Absent parts read as the engine's defaults.
export function describeKit(kit: KitDef | undefined, roleBuild: readonly string[]): string {
  const build = kit?.build ?? roleBuild;
  const skills: readonly SkillKey[] = kit?.skills ?? ['Q', 'W', 'E'];
  const parts = [
    `build ${build.map(itemName).join(', ')}${kit?.build ? '' : ' (the role build)'}`,
    `max ${skills.join(' then ')}`,
  ];
  const n = kit?.variants?.length ?? 0;
  if (n > 0) parts.push(`${n} variant${n > 1 ? 's' : ''}`);
  return parts.join('; ');
}

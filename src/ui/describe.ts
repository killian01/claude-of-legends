// Generates ability, sigil, and item descriptions from the data-as-code
// records THEMSELVES, so a tooltip can never drift from the live mechanics
// (the world-of-claudecraft tooltip rule). kits-v2 raised the bar from
// keyword dumps to full sentences with the genre's color language: values
// are wrapped in the classes of ui/rich_text.ts (physical red, magic blue,
// true white, healing green, shields teal, crowd control gold). The lines
// are trusted generated HTML, rendered via setRichLine / the tooltip layer.

import type { AbilityDef, CastSpec } from '../sim/combat/casting';
import type { EffectPredicate, EffectSpec } from '../sim/combat/effects';
import { ITEM_PASSIVES } from '../sim/content/item_passives';
import { ITEMS, type ItemDef, type ItemStats } from '../sim/content/items';
import type { SigilDef } from '../sim/content/sigils';
import type { AbilityKey } from '../sim/types';

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const span = (cls: string, text: string): string => `<span class="${cls}">${text}</span>`;

// Authored strings (a forged champion's names and flavor lines) are the
// one user input these lines carry; everything else is the repo's own
// data. They are escaped here, once, so every renderer that sets these
// lines as HTML stays safe.
export function escapeAuthored(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DTYPE_CLS: Record<string, string> = {
  physical: 'tt-phys',
  magic: 'tt-magic',
  true: 'tt-true',
};

// A value with its scaling ratios, each colored by the stat it scales on.
function amount(base: number, adRatio: number, apRatio: number, cls: string): string {
  let s = span(cls, `${Math.round(base)}`);
  if (adRatio) s += ` ${span('tt-phys', `(+${pct(adRatio)} AD)`)}`;
  if (apRatio) s += ` ${span('tt-magic', `(+${pct(apRatio)} AP)`)}`;
  return s;
}

// "a, b and c": clauses joined the way a sentence would.
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' };

function predicatePhrase(p: EffectPredicate): string {
  switch (p.kind) {
    case 'distanceAtLeast':
      return `after flying at least ${p.distance}`;
    case 'targetHpBelow':
      return `against targets under ${span('tt-cc', pct(p.frac))} health`;
    case 'targetDying':
      return 'if the blow kills';
    case 'targetIsolated':
      return `against a target with no ally within ${p.radius}`;
    case 'targetSlowed':
      return 'against an already impaired target';
    case 'targetNearTerrain':
      return 'against a target caught at a wall';
    case 'targetIsChampion':
      return 'if a champion is hit';
    case 'targetHasSourceDot':
      return 'against prey you set bleeding';
    case 'withinCenter':
      return `at the epicenter (within ${p.radius})`;
  }
}

// One effect as a verb-led clause, lowercase, no trailing period.
function clause(e: EffectSpec): string {
  switch (e.kind) {
    case 'damage':
      return `deals ${amount(e.base, e.adRatio ?? 0, e.apRatio ?? 0, DTYPE_CLS[e.dtype] ?? 'tt-true')} ${e.dtype} damage`;
    case 'heal': {
      let s = `restores ${amount(e.base, 0, e.apRatio ?? 0, 'tt-heal')}`;
      if (e.maxHpPct) s += ` plus ${span('tt-heal', `${pct(e.maxHpPct)} of max health`)}`;
      return `${s} health`;
    }
    case 'shield': {
      let s = `grants a ${amount(e.base, 0, e.apRatio ?? 0, 'tt-shield')} shield for ${e.duration}s`;
      if (e.burst) {
        const onBreak = e.burst.onBreak ?? [];
        const onExpire = e.burst.onExpire ?? [];
        const when =
          onBreak.length > 0 && onExpire.length > 0
            ? 'breaks or expires'
            : onBreak.length > 0
              ? 'is broken'
              : 'expires';
        const payload = joinAnd((onBreak.length > 0 ? onBreak : onExpire).map(clause));
        s += `; when it ${when}, it detonates (radius ${e.burst.radius}): ${payload}`;
      }
      return s;
    }
    case 'slow':
      return `slows by ${span('tt-cc', pct(e.pct))} for ${e.duration}s`;
    case 'root':
      return `roots for ${span('tt-cc', `${e.duration}s`)}`;
    case 'stun':
      return `stuns for ${span('tt-cc', `${e.duration}s`)}`;
    case 'taunt':
      return `taunts for ${span('tt-cc', `${e.duration}s`)}`;
    case 'stealth':
      return `grants ${span('tt-util', 'stealth')} for ${e.duration}s`;
    case 'blind':
      return `dims their sight to ${span('tt-cc', pct(e.factor))} for ${e.duration}s`;
    case 'knockback':
      if (e.direction === 'aside') return `sweeps them ${span('tt-cc', `${e.distance}`)} aside`;
      if (e.direction === 'toCenter') {
        return `hurls them ${span('tt-cc', `${e.distance}`)} back toward the center`;
      }
      return `knocks them back ${span('tt-cc', `${e.distance}`)}`;
    case 'pull':
      return `drags them ${span('tt-cc', `${e.distance}`)} closer`;
    case 'knockup':
      return `knocks airborne for ${span('tt-cc', `${e.duration}s`)}`;
    case 'untargetable':
      return `becomes ${span('tt-util', 'untargetable')} for ${e.duration}s`;
    case 'dot':
      return `deals ${span(DTYPE_CLS[e.dtype] ?? 'tt-true', `${e.perSecond}/s`)} ${e.dtype} damage over ${e.duration}s`;
    case 'grievous':
      return `cuts their healing by ${span('tt-cc', pct(e.factor))} for ${e.duration}s`;
    case 'buff': {
      const parts: string[] = [];
      if (e.msPct) parts.push(span('tt-util', `+${pct(e.msPct)} move speed`));
      if (e.asPct) parts.push(span('tt-util', `+${pct(e.asPct)} attack speed`));
      if (e.armor) parts.push(span('tt-util', `+${e.armor} armor`));
      if (e.mr) parts.push(span('tt-util', `+${e.mr} magic resist`));
      return `grants ${joinAnd(parts)} for ${e.duration}s`;
    }
    case 'mark': {
      const trigger = joinAnd(e.onTrigger.map(clause));
      const nth = ORDINALS[e.stacksToTrigger] ?? `${e.stacksToTrigger}th`;
      return `applies a ${span('tt-util', 'mark')} for ${e.duration}s; the ${nth} mark ${trigger}`;
    }
    case 'conditional': {
      let s = `${predicatePhrase(e.when)}, ${joinAnd(e.effects.map(clause))}`;
      if (e.otherwise?.length) s += `; otherwise ${joinAnd(e.otherwise.map(clause))}`;
      return s;
    }
    case 'cooldownRefund':
      return `refunds ${span('tt-util', pct(e.pctOfRemaining))} of ${e.key}'s remaining cooldown`;
    case 'empower': {
      let s = `empowers your next attack within ${e.duration}s: ${joinAnd(e.bonus.map(clause))}`;
      if (e.splash?.length) {
        s += `; it splashes to enemies around the victim (radius ${e.splashRadius ?? 0}): ${joinAnd(
          e.splash.map(clause),
        )}`;
      }
      return s;
    }
    default:
      return '';
  }
}

const sentence = (list: readonly EffectSpec[] | undefined): string =>
  joinAnd((list ?? []).map(clause));

function describeCast(spec: CastSpec, castRange: number): string[] {
  switch (spec.kind) {
    case 'skillshot': {
      const flight = spec.pierce
        ? 'piercing every enemy in its path'
        : 'stopping on the first enemy hit';
      const lines = [`Hurls a bolt up to ${spec.range} away, ${flight}: ${sentence(spec.onHit)}.`];
      if (spec.allyEffects?.length) {
        lines.push(`Allies it washes over: ${sentence(spec.allyEffects)}.`);
      }
      if (spec.chain) {
        lines.push(
          `The bolt then leaps to the nearest other enemy (within ${spec.chain.radius}): ` +
            `${sentence(spec.chain.onHit)}.`,
        );
      }
      if (spec.leaveWall) {
        lines.push(`The scarred line stays impassable for ${spec.leaveWall.duration}s.`);
      }
      if (spec.aftershock) {
        lines.push(
          `The whole line stays cracked and erupts again after ${spec.aftershock.delay}s: ` +
            `${sentence(spec.aftershock.effects)}.`,
        );
      }
      return lines;
    }
    case 'zone': {
      const lines = [
        `Marks the ground (radius ${spec.radius}, range ${castRange})` +
          `${spec.detonateDelay === undefined ? ` for ${spec.duration}s` : ''}.`,
      ];
      if (spec.detonateDelay !== undefined) {
        lines.push(`After ${spec.detonateDelay}s the area erupts: ${sentence(spec.onDetonate)}.`);
      }
      if (spec.onEnter?.length) lines.push(`Enemies entering it: ${sentence(spec.onEnter)}.`);
      if (spec.onTick?.length) {
        lines.push(`Enemies inside, every ${spec.tickEvery ?? 0.5}s: ${sentence(spec.onTick)}.`);
      }
      if (spec.allyOnTick?.length) {
        lines.push(`Allies inside, every ${spec.tickEvery ?? 0.5}s: ${sentence(spec.allyOnTick)}.`);
      }
      if (spec.reveal) lines.push('Its area is revealed, brush and stealth included.');
      if (spec.boundary) {
        lines.push(
          `Enemies walking out through the rim: ${sentence(spec.boundary.effects)} ` +
            `(each at most once per ${spec.boundary.perUnitEvery}s; dashes and blinks pass free).`,
        );
      }
      if (spec.leaveZone) {
        const inner = spec.leaveZone.onTick?.length ? `: ${sentence(spec.leaveZone.onTick)}` : '';
        lines.push(
          `The blast leaves a field behind (radius ${spec.leaveZone.radius}, ` +
            `${spec.leaveZone.duration}s)${inner}.`,
        );
      }
      return lines;
    }
    case 'cone':
      return [`Sweeps an arc in front of you (reach ${spec.range}): ${sentence(spec.onHit)}.`];
    case 'burst': {
      const lines = [`Erupts around you (radius ${spec.radius}): ${sentence(spec.effects)}.`];
      if (spec.selfEffects?.length) lines.push(`On yourself: ${sentence(spec.selfEffects)}.`);
      return lines;
    }
    case 'dash': {
      const lines = [
        spec.speed
          ? `Dashes up to ${spec.range}; the flight is real, and walls stop it.`
          : `Blinks up to ${spec.range} instantly.`,
      ];
      if (spec.toAlly) lines.push('Jumps to an ally in reach and lands against them.');
      if (spec.untargetableDuringTravel) lines.push('You cannot be touched while traveling.');
      if (spec.passThrough?.length) {
        lines.push(`Everyone you pass through: ${sentence(spec.passThrough)}.`);
      }
      if (spec.onLand?.length) {
        lines.push(`On landing (radius ${spec.landRadius ?? 0}): ${sentence(spec.onLand)}.`);
      }
      if (spec.selfEffects?.length) lines.push(`On yourself: ${sentence(spec.selfEffects)}.`);
      return lines;
    }
    case 'wall':
      return [
        `Raises a stone rampart (length ${spec.length}) across your aim for ${spec.duration}s.`,
        'It blocks walking and dashes; shots pass over it.',
      ];
    case 'enemy_target': {
      const lines = [`Strikes an enemy within ${castRange}: ${sentence(spec.effects)}.`];
      if (spec.selfEffects?.length) lines.push(`On yourself: ${sentence(spec.selfEffects)}.`);
      return lines;
    }
    case 'self_or_ally':
      return [
        spec.searchRadius > 0
          ? `Blesses yourself or the ally nearest your aim (range ${castRange}): ` +
            `${sentence(spec.effects)}.`
          : `On yourself: ${sentence(spec.effects)}.`,
      ];
    default:
      return [];
  }
}

export function describeAbility(key: AbilityKey, def: AbilityDef): string[] {
  const lines = [`${escapeAuthored(def.name)} (${key})`];
  // The flavor line first, the story; the mechanics follow in the game's
  // own words, derived, the same for every champion.
  if (def.flavor) lines.push(span('tt-flavor', escapeAuthored(def.flavor)));
  lines.push(`${def.manaCost} mana. ${def.cooldown}s cooldown.`);
  if (def.windup && def.windup > 0) {
    lines.push(`Winds up for ${def.windup}s before it fires; both teams see the telegraph.`);
  }
  lines.push(...describeCast(def.spec, def.castRange));
  if (def.recast) {
    lines.push(
      `${span('tt-util', 'Recast')} within ${def.recast.window}s: return to where you cast it.`,
    );
  }
  if (def.atRank) {
    for (const o of def.atRank) {
      lines.push(
        `${span('tt-util', `Rank ${o.rank}`)}: ${describeCast(o.spec, def.castRange).join(' ')}`,
      );
    }
  }
  return lines;
}

export function describeSigil(def: SigilDef): string[] {
  return [
    `${def.name} (sigil)`,
    `${def.cooldown}s cooldown.`,
    ...describeCast(def.spec, def.castRange),
  ];
}

// Full stat names, not initials: nobody should have to guess what AD means.
export function statLabel(s: ItemStats): string {
  const parts: string[] = [];
  if (s.ad) parts.push(`+${s.ad} Attack Damage`);
  if (s.ap) parts.push(`+${s.ap} Ability Power`);
  if (s.hp) parts.push(`+${s.hp} Health`);
  if (s.mana) parts.push(`+${s.mana} Mana`);
  if (s.armor) parts.push(`+${s.armor} Armor`);
  if (s.mr) parts.push(`+${s.mr} Magic Resist`);
  if (s.attackSpeedPct) parts.push(`+${Math.round(s.attackSpeedPct * 100)}% Attack Speed`);
  if (s.moveSpeed) parts.push(`+${s.moveSpeed} Move Speed`);
  if (s.armorPen) parts.push(`+${s.armorPen} Armor Penetration`);
  if (s.mrPen) parts.push(`+${s.mrPen} Magic Penetration`);
  return parts.join(', ');
}

export function describeItem(def: ItemDef, statLine: string): string[] {
  const lines = [`${def.name} (${def.cost}g)`, statLine];
  const passive = ITEM_PASSIVES[def.id];
  if (passive) lines.push(`Passive, ${passive.name}: ${passive.description}`);
  if (def.buildsFrom) {
    const names = def.buildsFrom.map((id) => ITEMS[id]?.name ?? id);
    lines.push(`Builds from: ${names.join(' + ')}.`);
  }
  return lines;
}

// Generates human-readable tooltip lines from the data-as-code records:
// abilities, sigils, and items describe THEMSELVES, so tooltips can never
// drift from the live mechanics (the world-of-claudecraft tooltip rule).

import type { AbilityDef, CastSpec } from '../sim/combat/casting';
import type { EffectSpec } from '../sim/combat/effects';
import { ITEMS, type ItemDef } from '../sim/content/items';
import type { SigilDef } from '../sim/content/sigils';
import type { AbilityKey } from '../sim/types';

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function fmtEffect(e: EffectSpec): string {
  switch (e.kind) {
    case 'damage': {
      let s = `${e.base}`;
      if (e.adRatio) s += ` (+${pct(e.adRatio)} of your Attack Damage)`;
      if (e.apRatio) s += ` (+${pct(e.apRatio)} of your Ability Power)`;
      return `${s} ${e.dtype} damage`;
    }
    case 'heal': {
      let s = `heals ${e.base}`;
      if (e.apRatio) s += ` (+${pct(e.apRatio)} of your Ability Power)`;
      return s;
    }
    case 'shield': {
      let s = `shields ${e.base}`;
      if (e.apRatio) s += ` (+${pct(e.apRatio)} of your Ability Power)`;
      return `${s} for ${e.duration}s`;
    }
    case 'slow':
      return `slows ${pct(e.pct)} for ${e.duration}s`;
    case 'root':
      return `roots for ${e.duration}s`;
    case 'stun':
      return `stuns for ${e.duration}s`;
    case 'taunt':
      return `taunts for ${e.duration}s`;
    case 'stealth':
      return `stealth for ${e.duration}s`;
    case 'blind':
      return `cuts sight to ${pct(e.factor)} for ${e.duration}s`;
    case 'knockback':
      return `knocks back ${e.distance}`;
    case 'pull':
      return `pulls ${e.distance} closer`;
    case 'dot':
      return `${e.perSecond}/s ${e.dtype} damage over ${e.duration}s`;
    case 'grievous':
      return `cuts healing ${pct(e.factor)} for ${e.duration}s`;
    case 'buff': {
      const parts: string[] = [];
      if (e.msPct) parts.push(`+${pct(e.msPct)} move speed`);
      if (e.asPct) parts.push(`+${pct(e.asPct)} attack speed`);
      if (e.armor) parts.push(`+${e.armor} armor`);
      if (e.mr) parts.push(`+${e.mr} magic resist`);
      return `${parts.join(', ')} for ${e.duration}s`;
    }
    case 'mark':
      return `applies a mark; ${e.stacksToTrigger} marks trigger: ${e.onTrigger
        .map(fmtEffect)
        .join(', ')}`;
    default:
      return '';
  }
}

const fmtList = (list: readonly EffectSpec[] | undefined): string =>
  (list ?? []).map(fmtEffect).join('; ');

function describeCast(spec: CastSpec, castRange: number): string[] {
  switch (spec.kind) {
    case 'skillshot':
      return [
        `Skillshot, range ${spec.range}${spec.pierce ? ', piercing' : ''}.`,
        `On hit: ${fmtList(spec.onHit)}.`,
        ...(spec.allyEffects && spec.allyEffects.length > 0
          ? [`Allies touched: ${fmtList(spec.allyEffects)}.`]
          : []),
      ];
    case 'zone': {
      const lines = [`Zone, radius ${spec.radius}, range ${castRange}, lasts ${spec.duration}s.`];
      if (spec.onTick?.length)
        lines.push(`Each ${spec.tickEvery ?? 0.5}s: ${fmtList(spec.onTick)}.`);
      if (spec.allyOnTick?.length) lines.push(`Allies inside: ${fmtList(spec.allyOnTick)}.`);
      if (spec.onEnter?.length) lines.push(`On entering: ${fmtList(spec.onEnter)}.`);
      if (spec.detonateDelay !== undefined)
        lines.push(`Detonates after ${spec.detonateDelay}s: ${fmtList(spec.onDetonate)}.`);
      return lines;
    }
    case 'cone':
      return [`Cone, range ${spec.range}.`, `Hits: ${fmtList(spec.onHit)}.`];
    case 'burst': {
      const lines = [`Around you, radius ${spec.radius}: ${fmtList(spec.effects)}.`];
      if (spec.selfEffects?.length) lines.push(`On yourself: ${fmtList(spec.selfEffects)}.`);
      return lines;
    }
    case 'dash': {
      const lines = [`Dash, range ${spec.range}.`];
      if (spec.onLand?.length)
        lines.push(`On landing (radius ${spec.landRadius ?? 0}): ${fmtList(spec.onLand)}.`);
      if (spec.selfEffects?.length) lines.push(`On yourself: ${fmtList(spec.selfEffects)}.`);
      return lines;
    }
    case 'enemy_target':
      return [`Targets an enemy within ${castRange}.`, `Effect: ${fmtList(spec.effects)}.`];
    case 'self_or_ally':
      return [
        spec.searchRadius > 0
          ? `Targets yourself or an ally near your aim (range ${castRange}).`
          : 'Targets yourself.',
        `Effect: ${fmtList(spec.effects)}.`,
      ];
    default:
      return [];
  }
}

export function describeAbility(key: AbilityKey, def: AbilityDef): string[] {
  return [
    `${def.name} (${key})`,
    `${def.manaCost} mana, ${def.cooldown}s cooldown.`,
    ...describeCast(def.spec, def.castRange),
  ];
}

export function describeSigil(def: SigilDef): string[] {
  return [
    `${def.name} (sigil)`,
    `${def.cooldown}s cooldown.`,
    ...describeCast(def.spec, def.castRange),
  ];
}

export function describeItem(def: ItemDef, statLine: string): string[] {
  const lines = [`${def.name} (${def.cost}g)`, statLine];
  if (def.buildsFrom) {
    const names = def.buildsFrom.map((id) => ITEMS[id]?.name ?? id);
    lines.push(`Builds from: ${names.join(' + ')}.`);
  }
  return lines;
}

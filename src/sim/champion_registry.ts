// Match-scoped champion resolution (plan-forge phase 2): the roster plus
// this match's forged definitions, behind one seam. The champion table
// stops being a compile-time constant here; every host (Sim, ClientWorld,
// replay, the headless env) resolves through an instance of this registry,
// and two matches in one process never share forged state.

import { CHAMPIONS, type ChampionDef } from './content/champions';
import type { ForgedChampionDef } from './forge/forged_def';
import { resolveForgedChampion } from './forge/resolve';
import { validateForged } from './forge/validate';

export class ChampionRegistry {
  // Insertion order is preserved and re-emitted by forgedDefs(): the order
  // definitions are registered in is part of a match's identity (replays
  // re-register them identically).
  private readonly forged = new Map<string, { source: ForgedChampionDef; resolved: ChampionDef }>();

  // Roster first: a forged id can never shadow a roster champion (the
  // validator's forged_ prefix already guarantees no collision).
  get(championId: string): ChampionDef | null {
    return CHAMPIONS[championId] ?? this.forged.get(championId)?.resolved ?? null;
  }

  // Registers one forged definition for this match. The deterministic
  // validator is the gate: an invalid def never enters a registry, whoever
  // sent it. Throws, because by the time a def reaches match setup it was
  // already validated upstream; failing loud here catches drift.
  addForged(def: ForgedChampionDef): ChampionDef {
    const v = validateForged(def);
    if (!v.ok) {
      throw new Error(`invalid forged champion '${String(def?.id)}': ${v.errors.join('; ')}`);
    }
    if (this.forged.has(def.id)) {
      throw new Error(`forged champion '${def.id}' is already registered`);
    }
    const resolved = resolveForgedChampion(def);
    this.forged.set(def.id, { source: def, resolved });
    return resolved;
  }

  // The match's forged definitions, exactly as registered: what match setup
  // distributes to clients and what a replay embeds instead of ids alone.
  forgedDefs(): readonly ForgedChampionDef[] {
    return [...this.forged.values()].map((f) => f.source);
  }
}

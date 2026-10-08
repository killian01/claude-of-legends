// A Respawn life as the wash of its death tells it (ui/hud.ts): when the
// life began, the takedowns scored in it and the assists, so the wash can
// say what the life that just ended held (ui/royale_text.ts lifeLine); and
// the champions last seen, so its recap can give the killer's level and
// health (royaleRecap). A dead champion sees nothing, so the killer leaves
// the mirror on the very snapshot that tells the death: the recap reads
// the body as it stood a moment before.

import type { Unit } from '../sim/unit';
import { lifeLine } from './royale_text';

// The own scoreboard row as the life reads it. The server sends it every
// few seconds (server/royale_service.ts), so the takedowns come off the
// kill feed instead, the moment they happen.
export interface LifeRow {
  assists?: number;
}

export class RoyaleLife {
  private from: number | null = null;
  private diedAt: number | null = null;
  private takedowns = 0;
  // The row's assists when the life began; null until a row is seen.
  private assistsFrom: number | null = null;

  // Once per HUD update. A life begins on the first update in play with
  // the champion standing, and again on the dead-to-alive edge (the
  // return); it ends on the alive-to-dead edge, its length frozen there.
  step(time: number, inPlay: boolean, dead: boolean, row: LifeRow | undefined): void {
    const assists = row ? (row.assists ?? 0) : null;
    if (this.from === null || (this.diedAt !== null && !dead)) {
      if (!inPlay || dead) return;
      this.from = time;
      this.diedAt = null;
      this.takedowns = 0;
      this.assistsFrom = assists;
      return;
    }
    if (dead) {
      if (this.diedAt === null) this.diedAt = time;
      return;
    }
    // The first row seen, or one under the start: a count only climbs in
    // a life, so a lower one is a row that caught up with an Arrival's
    // fresh tally.
    if (assists !== null && (this.assistsFrom === null || assists < this.assistsFrom)) {
      this.assistsFrom = assists;
    }
  }

  // The own champion took a champion down: one more in this life.
  tookDown(): void {
    if (this.from !== null) this.takedowns += 1;
  }

  // The life line for the wash, once a life seen begin has ended; null
  // before.
  line(row: LifeRow | undefined): string | null {
    if (this.from === null || this.diedAt === null) return null;
    const assists =
      row && this.assistsFrom !== null ? Math.max(0, (row.assists ?? 0) - this.assistsFrom) : 0;
    return lifeLine(this.diedAt - this.from, this.takedowns, assists);
  }
}

// A champion's body as the recap tells it.
export interface SeenBody {
  championId: string;
  level: number;
  hp: number;
  maxHp: number;
}

// How long a body seen stays good for the recap: the snapshot before the
// death, with room for a slow frame.
export const SEEN_FRESH_S = 1;

// The champions in the mirror, standing, as each was last seen.
export class SeenChampions {
  private readonly seen = new Map<number, SeenBody & { at: number }>();

  // Once per HUD update, every champion but the own.
  note(units: Iterable<Readonly<Unit>>, selfId: number, time: number): void {
    for (const u of units) {
      if (u.id === selfId || u.kind !== 'champion' || u.dead || !u.championId) continue;
      this.seen.set(u.id, {
        championId: u.championId,
        level: u.level,
        hp: u.hp,
        maxHp: u.maxHp,
        at: time,
      });
    }
    for (const [id, body] of this.seen) if (time - body.at > SEEN_FRESH_S) this.seen.delete(id);
  }

  // The champion as it stands now, while the mirror holds it standing,
  // else as last seen within SEEN_FRESH_S; null for anything else (a
  // camp, a creature, the Dusk, a champion out of sight).
  body(id: number, live: Readonly<Unit> | undefined, time: number): SeenBody | null {
    if (live?.kind === 'champion' && !live.dead && live.championId) {
      return { championId: live.championId, level: live.level, hp: live.hp, maxHp: live.maxHp };
    }
    const kept = this.seen.get(id);
    if (!kept || time - kept.at > SEEN_FRESH_S) return null;
    return { championId: kept.championId, level: kept.level, hp: kept.hp, maxHp: kept.maxHp };
  }
}

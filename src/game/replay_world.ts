// A read-only IWorld over a replaying Sim: the presentation reads freely
// (render, HUD, minimap, fog), but viewer input must never steer the
// recorded match, so every order and purchase is a no-op. castAbility
// answering false makes the deny sound an honest reply in a replay.

import type { ChampionDef } from '../sim/content/champions';
import type { GameMap } from '../sim/content/map';
import type { Projectile } from '../sim/projectiles';
import type { Sim } from '../sim/sim';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { Wall } from '../sim/walls';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';

export class ReplayWorld implements IWorld {
  constructor(private readonly sim: Sim) {}

  get map(): GameMap {
    return this.sim.map;
  }
  get time(): number {
    return this.sim.time;
  }
  get winner(): TeamId | null {
    return this.sim.winner;
  }
  get units(): ReadonlyMap<number, Readonly<Unit>> {
    return this.sim.units;
  }
  get projectiles(): ReadonlyMap<number, Readonly<Projectile>> {
    return this.sim.projectiles;
  }
  get zones(): ReadonlyMap<number, Readonly<Zone>> {
    return this.sim.zones;
  }
  get walls(): ReadonlyMap<number, Readonly<Wall>> {
    return this.sim.walls;
  }
  championDef(championId: string): ChampionDef | null {
    return this.sim.championDef(championId);
  }
  scoreboard(): readonly ScoreRow[] {
    return this.sim.scoreboard();
  }
  isVisible(team: TeamId, unitId: number): boolean {
    return this.sim.isVisible(team, unitId);
  }
  teamBuff(team: TeamId): { until: number; stacks: number } | null {
    return this.sim.teamBuff(team);
  }
  objectiveSpawnAt(): number | null {
    return this.sim.objectiveSpawnAt();
  }

  orderMove(): void {}
  orderAttack(): void {}
  orderAttackMove(): void {}
  orderStop(): void {}
  startRecall(): void {}
  castAbility(): boolean {
    return false;
  }
  castSigil(): boolean {
    return false;
  }
  buyItem(): boolean {
    return false;
  }
  sellItem(): boolean {
    return false;
  }
  levelAbility(): boolean {
    return false;
  }
}

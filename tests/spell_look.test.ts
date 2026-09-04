// The spell look (CONTEXT.md): the bounded visual vocabulary an ability
// carries as data. Three things are pinned here. The validator refuses
// anything the renderer cannot draw, because a look arrives over the wire
// with a forged definition and inside saved replays. The interpreter
// produces hooks ONLY for the parts a look declares, because every part
// left out must keep the generic the renderer already draws. And the
// resolution order holds: authored art first, then the look, then the
// generics, so a champion this client never heard of still gets its own
// spells.

import { describe, expect, it } from 'vitest';
import { resolveLook, spellColorsOf } from '../src/render/ability_vfx';
import { spellVisualOf } from '../src/render/vfx/catalog';
import { lookVisual } from '../src/render/vfx/looks';
import type { ChampionDef } from '../src/sim/content/champions';
import { validateForged } from '../src/sim/forge/validate';
import { type SpellLook, spellLookErrors } from '../src/sim/spell_look';
import type { IWorld } from '../src/world_api';
import { FORGED_TWINS } from './forged_twins';

const FULL: SpellLook = {
  palette: { main: 0x2f6fe0, glow: 0xbfe4ff },
  projectile: { body: 'shard', trail: 'embers', spin: 3, scale: 1.2 },
  cast: { shape: 'ring', scale: 1.1 },
  impact: { shape: 'shatter', density: 0.8, smoke: true, mark: 'frost', shake: 0.1 },
  zone: { floor: 'runes', edge: 'hard', motion: 'swirl' },
  detonate: { shape: 'pillar', scale: 2 },
  windup: { motion: 'orbit' },
};

// A world that knows exactly one champion: all the renderer's resolution
// asks of it is championDef.
function worldWith(def: unknown): IWorld {
  return { championDef: (id: string) => (id === 'forged_test' ? def : null) } as unknown as IWorld;
}

function twinWithLook(look: SpellLook | undefined): ChampionDef {
  const twin = FORGED_TWINS.find((t) => t.id === 'forged_sylra_twin');
  if (!twin) throw new Error('the twin fixture lost sylra');
  const abilities = {
    ...twin.abilities,
    Q: look ? { ...twin.abilities.Q, look } : { ...twin.abilities.Q },
  };
  return { ...twin, id: 'forged_test', abilities } as unknown as ChampionDef;
}

describe('the look vocabulary', () => {
  it('accepts a look that uses every part', () => {
    expect(spellLookErrors(FULL)).toEqual([]);
  });

  it('accepts an empty look and every single part on its own', () => {
    expect(spellLookErrors({})).toEqual([]);
    expect(spellLookErrors({ impact: { shape: 'flash' } })).toEqual([]);
    expect(spellLookErrors({ projectile: { body: 'orb' } })).toEqual([]);
  });

  it('refuses a word the renderer cannot draw', () => {
    expect(spellLookErrors({ projectile: { body: 'dragon' } })[0]).toContain('projectile.body');
    expect(spellLookErrors({ impact: { shape: 'nuke' } })[0]).toContain('impact.shape');
    expect(spellLookErrors({ zone: { floor: 'lava' } })[0]).toContain('zone.floor');
    expect(spellLookErrors({ windup: { motion: 'implode' } })[0]).toContain('windup.motion');
  });

  it('refuses numbers off the rails, so a look can never spend the frame', () => {
    expect(spellLookErrors({ impact: { shape: 'spray', density: 40 } })[0]).toContain('density');
    expect(spellLookErrors({ impact: { shape: 'spray', scale: 900 } })[0]).toContain('scale');
    expect(spellLookErrors({ impact: { shape: 'spray', shake: 5 } })[0]).toContain('shake');
    expect(spellLookErrors({ projectile: { body: 'orb', spin: 1e6 } })[0]).toContain('spin');
    expect(spellLookErrors({ impact: { shape: 'spray', density: Number.NaN } })[0]).toContain(
      'finite',
    );
  });

  it('refuses colors that are not colors, and fields that are not fields', () => {
    expect(spellLookErrors({ palette: { main: -1, glow: 0 } })[0]).toContain('palette.main');
    expect(spellLookErrors({ palette: { main: 0x1000000, glow: 0 } })[0]).toContain('palette.main');
    expect(spellLookErrors({ palette: { main: 0, glow: 'blue' } })[0]).toContain('palette.glow');
    expect(spellLookErrors({ sparkles: true })[0]).toContain('not a look field');
  });

  it('reports every violation at once, the way the editor needs them', () => {
    const errors = spellLookErrors({ projectile: { body: 'dragon', trail: 'glitter' } });
    expect(errors).toHaveLength(2);
  });
});

describe('the look inside the forged validation gate', () => {
  it('passes a twin carrying a valid look', () => {
    const def = twinWithLook(FULL);
    expect(validateForged(def as never).ok).toBe(true);
  });

  it('fails the whole definition on a look the renderer cannot draw', () => {
    const def = twinWithLook({ impact: { shape: 'nuke' } } as unknown as SpellLook);
    const v = validateForged(def as never);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.errors.some((e) => e.includes('abilities.Q.look.impact'))).toBe(
      true,
    );
  });
});

describe('the look interpreter', () => {
  it('builds only the hooks the look declares', () => {
    const vis = lookVisual({ impact: { shape: 'ring' } });
    expect(vis.impact).toBeTypeOf('function');
    expect(vis.projectile).toBeUndefined();
    expect(vis.zone).toBeUndefined();
    expect(vis.windupTick).toBeUndefined();
    expect(vis.detonate).toBeUndefined();
  });

  it('leaves the plain tracer to the renderer for a bolt body', () => {
    expect(lookVisual({ projectile: { body: 'bolt' } }).projectile).toBeUndefined();
    expect(lookVisual({ projectile: { body: 'orb' } }).projectile).toBeTypeOf('function');
  });

  it('ticks a projectile only when there is something to tick', () => {
    expect(lookVisual({ projectile: { body: 'orb' } }).projectileTick).toBeUndefined();
    expect(lookVisual({ projectile: { body: 'orb', trail: 'sparks' } }).projectileTick).toBeTypeOf(
      'function',
    );
    expect(lookVisual({ projectile: { body: 'bolt', spin: 2 } }).projectileTick).toBeTypeOf(
      'function',
    );
  });

  it('builds a real object for every body and every zone floor', () => {
    const colors = { main: 0x336699, glow: 0xaabbcc };
    for (const body of ['orb', 'shard', 'blade', 'star', 'mote'] as const) {
      const vis = lookVisual({ projectile: { body } });
      expect(vis.projectile?.(0.4, colors).type).toBe('Group');
    }
    for (const floor of ['disc', 'ring', 'runes', 'pool', 'storm'] as const) {
      const vis = lookVisual({ zone: { floor } });
      expect(vis.zone?.(3, colors, true).children.length).toBeGreaterThan(0);
    }
  });

  it('keeps a still zone free of a per-frame tick', () => {
    expect(lookVisual({ zone: { floor: 'disc' } }).zoneTick).toBeUndefined();
    expect(lookVisual({ zone: { floor: 'disc', motion: 'swirl' } }).zoneTick).toBeTypeOf(
      'function',
    );
  });
});

describe('the resolution order', () => {
  it('serves a forged spell from its look, since no catalog entry can exist', () => {
    const world = worldWith(twinWithLook(FULL));
    const vis = spellVisualOf('forged_test_Q', world);
    expect(vis?.projectile).toBeTypeOf('function');
    expect(vis?.impact).toBeTypeOf('function');
  });

  it('leaves the generics alone when the spell has no look', () => {
    const world = worldWith(twinWithLook(undefined));
    expect(spellVisualOf('forged_test_Q', world)).toBeNull();
    expect(spellVisualOf(null, world)).toBeNull();
    expect(spellVisualOf('forged_test_A', world)).toBeNull();
  });

  it('keeps the authored catalog ahead of any look', () => {
    // dain_R is authored; the world cannot change what it draws.
    const world = worldWith(twinWithLook(FULL));
    expect(spellVisualOf('dain_R', world)?.zone).toBeTypeOf('function');
  });

  it('reads the look off the tagged ability and nothing else', () => {
    const world = worldWith(twinWithLook(FULL));
    expect(resolveLook('forged_test_Q', world)).toEqual(FULL);
    expect(resolveLook('forged_test_W', world)).toBeNull();
    expect(resolveLook('sigil_riftstep', world)).toBeNull();
    expect(resolveLook('forged_test', world)).toBeNull();
  });

  it("lets a look's palette outrank the school derivation", () => {
    const world = worldWith(twinWithLook(FULL));
    const plain = spellColorsOf('forged_test_W', world, 0xffffff);
    const painted = spellColorsOf('forged_test_Q', world, 0xffffff);
    expect(painted.glow).toBe(FULL.palette?.glow);
    expect(painted.main).not.toBe(plain.main);
  });
});

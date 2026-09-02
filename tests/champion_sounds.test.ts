// A forged champion's sounds (plan-forge phase 4, playtest: "define the
// sound of the auto-attacks and the spells"): one cast sound per spell
// and one basic-attack sound, picked from the procedural palette, carried
// by the definition, bounded by the validator, played by the client in
// place of the school's and the weapon's defaults.

import { describe, expect, it } from 'vitest';
import { attackSoundOf, castSoundOf } from '../src/game/champion_sounds';
import { schoolTagOf } from '../src/render/ability_vfx';
import { ATTACK_SOUNDS, CAST_SOUNDS, isAttackSound, isCastSound } from '../src/sim/content/sounds';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { resolveForgedChampion } from '../src/sim/forge/resolve';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS } from './forged_twins';

function twin(): ForgedChampionDef {
  return structuredClone({ ...FORGED_TWINS[0]!, id: 'forged_s', creator: 'alice' });
}

describe('the sound palette', () => {
  it('lists distinct ids on both sides and tells them apart', () => {
    const casts = CAST_SOUNDS.map((s) => s.id);
    const attacks = ATTACK_SOUNDS.map((s) => s.id);
    expect(new Set(casts).size).toBe(casts.length);
    expect(new Set(attacks).size).toBe(attacks.length);
    // Every school the derivation can name is a pick too, so "auto" and
    // the palette never disagree on what a school sounds like.
    for (const school of ['arcane', 'steel', 'fire', 'life', 'control', 'wind']) {
      expect(isCastSound(school)).toBe(true);
    }
    expect(isCastSound('kazoo')).toBe(false);
    expect(isAttackSound('bow')).toBe(true);
    expect(isAttackSound(7)).toBe(false);
  });

  it('validates a pick from the palette and refuses anything else', () => {
    const def = twin();
    def.abilities.Q.sound = 'thunder';
    def.attackSound = 'bow';
    expect(validateForged(def).ok).toBe(true);
    (def.abilities.Q as { sound?: unknown }).sound = 'kazoo';
    const badCast = validateForged(def);
    expect(badCast.ok).toBe(false);
    if (!badCast.ok) expect(badCast.errors.join(' ')).toContain('abilities.Q.sound');
    def.abilities.Q.sound = undefined;
    (def as { attackSound?: unknown }).attackSound = 'laser';
    const badAttack = validateForged(def);
    expect(badAttack.ok).toBe(false);
    if (!badAttack.ok) expect(badAttack.errors.join(' ')).toContain('attackSound');
  });

  it('rides the resolved champion the engine runs', () => {
    const def = twin();
    def.abilities.W.sound = 'frost';
    def.attackSound = 'heavy';
    const resolved = resolveForgedChampion(def);
    expect(resolved.attackSound).toBe('heavy');
    expect(resolved.abilities.W.sound).toBe('frost');
    // Without picks the resolved record carries none, as the roster does.
    expect('attackSound' in resolveForgedChampion(twin())).toBe(false);
    expect(freshDraftDef('forged_fresh').attackSound).toBeUndefined();
  });

  it('plays the pick, else the school and the weapon', () => {
    const def = twin();
    expect(castSoundOf(def.abilities.Q)).toBe(schoolTagOf(def.abilities.Q.spec));
    def.abilities.Q.sound = 'shadow';
    expect(castSoundOf(def.abilities.Q)).toBe('shadow');
    expect(attackSoundOf(null, false)).toBe('swing');
    expect(attackSoundOf(null, true)).toBe('gunshot');
    expect(attackSoundOf(def, true)).toBe('gunshot');
    def.attackSound = 'blade';
    expect(attackSoundOf(def, true)).toBe('blade');
  });
});

// A spell look in one readable line, the way describe.ts turns a spec
// into the game's own words: the creator reads what they are about to
// apply without opening the JSON, and the proposal panel stays a card.
// Presentation only; the renderer is the authority on what a look does.

import type { LookBurst, SpellLook } from '../sim/spell_look';

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function burstLine(label: string, b: LookBurst): string {
  const extras: string[] = [];
  if (b.smoke) extras.push('smoke');
  if (b.mark && b.mark !== 'none') extras.push(`${b.mark} on the ground`);
  if (typeof b.shake === 'number' && b.shake > 0) extras.push('camera shake');
  const tail = extras.length > 0 ? ` with ${extras.join(', ')}` : '';
  return `${label} ${b.shape}${tail}`;
}

// Every part the look declares, in the order the eye meets them: the
// wind-up, the cast, the flight, the landing.
export function describeLook(look: SpellLook | null | undefined): string {
  if (!look) return 'No look: this spell keeps the default effects.';
  const parts: string[] = [];
  if (look.windup) parts.push(`winds up by ${look.windup.motion}`);
  if (look.cast) parts.push(burstLine('cast', look.cast));
  if (look.projectile) {
    const p = look.projectile;
    const trail = p.trail && p.trail !== 'none' ? ` trailing ${p.trail}` : '';
    const spin = typeof p.spin === 'number' && p.spin !== 0 ? ', spinning' : '';
    parts.push(`a ${p.body}${trail}${spin}`);
  }
  if (look.zone) {
    const z = look.zone;
    const motion = z.motion && z.motion !== 'still' ? `, ${z.motion}` : '';
    parts.push(`a ${z.floor} area${z.edge ? ` with a ${z.edge} edge` : ''}${motion}`);
  }
  if (look.impact) parts.push(burstLine('impact', look.impact));
  if (look.detonate) parts.push(burstLine('detonation', look.detonate));
  if (look.palette) parts.push(`colored ${hex(look.palette.main)} on ${hex(look.palette.glow)}`);
  if (parts.length === 0) return 'An empty look: this spell keeps the default effects.';
  return `${parts.join('; ')}.`;
}

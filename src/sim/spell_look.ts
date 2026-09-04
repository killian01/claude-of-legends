// The spell look (CONTEXT.md): one ability's VISUAL as data, sitting on
// the ability beside its cast sound. The authored catalog in
// render/vfx/catalog.ts is code, so it can only ever cover champions that
// existed when the client was built; a forged champion's id does not, and
// its spells fall back to the school-derived generics (six colors for the
// whole Forge). A look is the same answer the playbook gives for bot
// behavior (ADR 0013): a bounded vocabulary the engine interprets, never
// code from a creator running on ten clients.
//
// Every field is optional and every value comes from a closed list or a
// hard numeric rail: a look is drawn by render/vfx/looks.ts out of the
// primitives the authored catalog already uses, so an unknown word can
// never reach the renderer and a number can never spend the frame budget.
// Absent, the spell keeps the generics exactly as before.

// The projectile body: what the bolt actually is in flight. 'bolt' is the
// renderer's own stretched tracer, the shape the generics already draw.
export const LOOK_BODIES = ['bolt', 'orb', 'shard', 'blade', 'star', 'mote'] as const;
export type LookBody = (typeof LOOK_BODIES)[number];

// What the body leaves behind it.
export const LOOK_TRAILS = ['none', 'sparks', 'smoke', 'embers', 'ribbon'] as const;
export type LookTrail = (typeof LOOK_TRAILS)[number];

// One moment of spending: an impact, a cast, a detonation. The shape is
// the silhouette of the moment, not its color.
export const LOOK_BURSTS = [
  'flash',
  'spray',
  'ring',
  'pillar',
  'shatter',
  'bloom',
  'wave',
] as const;
export type LookBurstShape = (typeof LOOK_BURSTS)[number];

// The ground a zone stands on, its border, and what moves inside it.
export const LOOK_FLOORS = ['disc', 'ring', 'runes', 'pool', 'storm'] as const;
export type LookFloor = (typeof LOOK_FLOORS)[number];

export const LOOK_EDGES = ['soft', 'hard', 'jagged'] as const;
export type LookEdge = (typeof LOOK_EDGES)[number];

export const LOOK_ZONE_MOTIONS = ['still', 'swirl', 'pulse', 'rain'] as const;
export type LookZoneMotion = (typeof LOOK_ZONE_MOTIONS)[number];

// What gathers at the caster while a windup fills.
export const LOOK_WINDUPS = ['none', 'gather', 'orbit', 'rise'] as const;
export type LookWindup = (typeof LOOK_WINDUPS)[number];

// The stain a burst leaves on the ground, from the decal set the renderer
// ships. 'none' leaves the floor clean.
export const LOOK_MARKS = ['none', 'scorch', 'frost', 'cracks'] as const;
export type LookMark = (typeof LOOK_MARKS)[number];

// The numeric rails. Scale and density are the only dials a look has over
// how MUCH it draws, and both are capped well inside what the pooled
// primitives can serve: a look can never ask for a thousand particles.
export const LOOK_BOUNDS = {
  scale: { min: 0.4, max: 2.5 },
  density: { min: 0, max: 1 },
  spin: { min: -8, max: 8 },
  shake: { min: 0, max: 0.4 },
} as const;

// A color is a plain 24-bit RGB integer, the form the renderer's
// materials already take.
export const COLOR_MAX = 0xffffff;

export interface LookBurst {
  shape: LookBurstShape;
  // Size of the moment against its natural radius (impact radius, zone
  // radius); 1 is the generic's own size.
  scale?: number;
  // How busy it is, 0 for a bare flash and 1 for the full spray.
  density?: number;
  smoke?: boolean;
  // Camera trauma, spent from the renderer's shake budget. Reserved for
  // ultimates by taste, capped by the rail for everyone.
  shake?: number;
  mark?: LookMark;
}

export interface LookProjectile {
  body: LookBody;
  trail?: LookTrail;
  // Turns per second around the flight axis; negative spins the other way.
  spin?: number;
  scale?: number;
}

export interface LookZone {
  floor: LookFloor;
  edge?: LookEdge;
  motion?: LookZoneMotion;
}

// The whole look of one spell. Everything optional: a look that only sets
// a palette is a legitimate look, and every part it leaves out keeps the
// school-derived generic.
export interface SpellLook {
  // Overrides the school color derived from the spec. Both or neither.
  palette?: { main: number; glow: number };
  projectile?: LookProjectile;
  // The flash at the caster on a visible instant cast.
  cast?: LookBurst;
  impact?: LookBurst;
  zone?: LookZone;
  detonate?: LookBurst;
  windup?: { motion: LookWindup };
}

const LOOK_KEYS: readonly string[] = [
  'palette',
  'projectile',
  'cast',
  'impact',
  'zone',
  'detonate',
  'windup',
];

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function checkScalar(
  errors: string[],
  path: string,
  v: unknown,
  bound: { min: number; max: number },
): void {
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${path}: must be a finite number`);
    return;
  }
  if (v < bound.min || v > bound.max) {
    errors.push(`${path}: ${v} is outside ${bound.min}..${bound.max}`);
  }
}

function checkColor(errors: string[], path: string, v: unknown): void {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > COLOR_MAX) {
    errors.push(`${path}: must be an integer color between 0 and ${COLOR_MAX}`);
  }
}

function checkBurst(errors: string[], path: string, v: unknown): void {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: must be an object`);
    return;
  }
  const b = v as Record<string, unknown>;
  if (!inList(LOOK_BURSTS, b.shape)) {
    errors.push(`${path}.shape: must be one of ${LOOK_BURSTS.join(', ')}`);
  }
  checkScalar(errors, `${path}.scale`, b.scale, LOOK_BOUNDS.scale);
  checkScalar(errors, `${path}.density`, b.density, LOOK_BOUNDS.density);
  checkScalar(errors, `${path}.shake`, b.shake, LOOK_BOUNDS.shake);
  if (b.smoke !== undefined && typeof b.smoke !== 'boolean') {
    errors.push(`${path}.smoke: must be a boolean`);
  }
  if (b.mark !== undefined && !inList(LOOK_MARKS, b.mark)) {
    errors.push(`${path}.mark: must be one of ${LOOK_MARKS.join(', ')}`);
  }
}

// Every violation as a readable string, the shape the Forge editor and
// the look agent both need (bounds.ts reports the same way: the full
// list, never the first failure).
export function spellLookErrors(look: unknown, path = 'look'): string[] {
  const errors: string[] = [];
  if (typeof look !== 'object' || look === null) {
    return [`${path}: must be an object`];
  }
  const l = look as Record<string, unknown>;
  if (l.palette !== undefined) {
    if (typeof l.palette !== 'object' || l.palette === null) {
      errors.push(`${path}.palette: must be an object`);
    } else {
      const p = l.palette as Record<string, unknown>;
      checkColor(errors, `${path}.palette.main`, p.main);
      checkColor(errors, `${path}.palette.glow`, p.glow);
    }
  }
  if (l.projectile !== undefined) {
    const p = l.projectile as Record<string, unknown>;
    if (typeof p !== 'object' || p === null) {
      errors.push(`${path}.projectile: must be an object`);
    } else {
      if (!inList(LOOK_BODIES, p.body)) {
        errors.push(`${path}.projectile.body: must be one of ${LOOK_BODIES.join(', ')}`);
      }
      if (p.trail !== undefined && !inList(LOOK_TRAILS, p.trail)) {
        errors.push(`${path}.projectile.trail: must be one of ${LOOK_TRAILS.join(', ')}`);
      }
      checkScalar(errors, `${path}.projectile.spin`, p.spin, LOOK_BOUNDS.spin);
      checkScalar(errors, `${path}.projectile.scale`, p.scale, LOOK_BOUNDS.scale);
    }
  }
  if (l.zone !== undefined) {
    const z = l.zone as Record<string, unknown>;
    if (typeof z !== 'object' || z === null) {
      errors.push(`${path}.zone: must be an object`);
    } else {
      if (!inList(LOOK_FLOORS, z.floor)) {
        errors.push(`${path}.zone.floor: must be one of ${LOOK_FLOORS.join(', ')}`);
      }
      if (z.edge !== undefined && !inList(LOOK_EDGES, z.edge)) {
        errors.push(`${path}.zone.edge: must be one of ${LOOK_EDGES.join(', ')}`);
      }
      if (z.motion !== undefined && !inList(LOOK_ZONE_MOTIONS, z.motion)) {
        errors.push(`${path}.zone.motion: must be one of ${LOOK_ZONE_MOTIONS.join(', ')}`);
      }
    }
  }
  if (l.windup !== undefined) {
    const w = l.windup as Record<string, unknown>;
    if (typeof w !== 'object' || w === null) {
      errors.push(`${path}.windup: must be an object`);
    } else if (!inList(LOOK_WINDUPS, w.motion)) {
      errors.push(`${path}.windup.motion: must be one of ${LOOK_WINDUPS.join(', ')}`);
    }
  }
  for (const key of ['cast', 'impact', 'detonate'] as const) {
    if (l[key] !== undefined) checkBurst(errors, `${path}.${key}`, l[key]);
  }
  for (const key of Object.keys(l)) {
    if (!LOOK_KEYS.includes(key)) errors.push(`${path}.${key}: not a look field`);
  }
  return errors;
}

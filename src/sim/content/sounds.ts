// The sound palette a forged champion picks from (plan-forge phase 4):
// one cast sound per spell and one basic-attack sound. A pick is an id,
// never an asset: the recorded bank (src/game/sfx_bank.ts) plays it, and
// until the bank decodes the synthesis (src/game/sfx.ts) stands in
// through the pick's family, one of the nine school sounds for a cast and
// one of the six original attacks for an attack. Data-as-code, a leaf:
// the validator bounds the def's picks to these ids, the editor lists
// them by group, the renderer plays them. Without a pick, a spell sounds
// like its school (derived from what it does) and the attack like the
// model's weapon.
//
// Playtest, 2026-09-02: nine cast sounds were far too few for a MOBA's
// worth of spells; the palette grew to the groups below, each sound a
// recording in the bank.

export const CAST_FAMILIES = [
  'arcane',
  'steel',
  'fire',
  'life',
  'control',
  'wind',
  'frost',
  'shadow',
  'thunder',
] as const;
export type CastFamily = (typeof CAST_FAMILIES)[number];

export const CAST_SOUND_GROUPS = [
  {
    group: 'Elements',
    sounds: [
      { id: 'fire', family: 'fire', label: 'Fire: a crackling roar' },
      { id: 'fireball', family: 'fire', label: 'Fireball: a flame flung with a whoosh' },
      { id: 'explosion', family: 'fire', label: 'Explosion: a blast and its rubble' },
      { id: 'ember', family: 'fire', label: 'Ember: a small flame catching' },
      { id: 'frost', family: 'frost', label: 'Frost: a glassy crystalline ring' },
      { id: 'coldsnap', family: 'frost', label: 'Cold snap: an icy blast' },
      { id: 'shatter', family: 'frost', label: 'Shatter: ice breaking apart' },
      { id: 'thunder', family: 'thunder', label: 'Thunder: a crack and a rumble' },
      { id: 'spark', family: 'thunder', label: 'Spark: an electric snap' },
      { id: 'storm', family: 'thunder', label: 'Storm: wind rising into thunder' },
      { id: 'wind', family: 'wind', label: 'Wind: a fast breathy sweep' },
      { id: 'gust', family: 'wind', label: 'Gust: a long heavy rush of air' },
      { id: 'sand', family: 'wind', label: 'Sand: a dry hissing sweep' },
      { id: 'earth', family: 'control', label: 'Earth: a rumbling quake' },
      { id: 'rockfall', family: 'control', label: 'Rockfall: stones tumbling' },
      { id: 'water', family: 'wind', label: 'Water: a splash' },
      { id: 'tide', family: 'wind', label: 'Tide: a surge of water' },
      { id: 'venom', family: 'shadow', label: 'Venom: bubbling poison' },
    ],
  },
  {
    group: 'Arcane',
    sounds: [
      { id: 'arcane', family: 'arcane', label: 'Arcane: an airy whoosh with a shimmer' },
      { id: 'missile', family: 'arcane', label: 'Missile: a bolt of magic fired' },
      { id: 'beam', family: 'arcane', label: 'Beam: a sustained ray' },
      { id: 'pulse', family: 'arcane', label: 'Pulse: a low throb of power' },
      { id: 'blink', family: 'arcane', label: 'Blink: a teleport pop' },
      { id: 'ward', family: 'arcane', label: 'Ward: a shield raised' },
      { id: 'rune', family: 'arcane', label: 'Rune: a bright glyph chime' },
      { id: 'gravity', family: 'arcane', label: 'Gravity: space folding in' },
      { id: 'soar', family: 'arcane', label: 'Soar: a rising magical rush' },
      { id: 'powerup', family: 'arcane', label: 'Power up: a charge climbing' },
      { id: 'drain', family: 'shadow', label: 'Drain: power drawn away' },
    ],
  },
  {
    group: 'Light and nature',
    sounds: [
      { id: 'life', family: 'life', label: 'Life: a warm double chime' },
      { id: 'bloom', family: 'life', label: 'Bloom: a soft rising cure' },
      { id: 'holy', family: 'life', label: 'Holy: a bell toll under a hymn' },
      { id: 'chime', family: 'life', label: 'Chime: bright bells' },
      { id: 'blessing', family: 'life', label: 'Blessing: a chord of power rising' },
      { id: 'growth', family: 'life', label: 'Growth: twigs and leaves spreading' },
      { id: 'incantation', family: 'arcane', label: 'Incantation: whispered words of power' },
    ],
  },
  {
    group: 'Shadow',
    sounds: [
      { id: 'shadow', family: 'shadow', label: 'Shadow: a dark hiss drawn inward' },
      { id: 'curse', family: 'shadow', label: "Curse: a shade's hiss and a drain" },
      { id: 'void', family: 'shadow', label: 'Void: a hollow implosion' },
      { id: 'wraith', family: 'shadow', label: 'Wraith: a ghostly breath' },
      { id: 'lich', family: 'shadow', label: 'Lich: a dead voice speaking' },
    ],
  },
  {
    group: 'Steel and body',
    sounds: [
      { id: 'steel', family: 'steel', label: 'Steel: a metallic schwing' },
      { id: 'clash', family: 'steel', label: 'Clash: blades meeting' },
      { id: 'chains', family: 'steel', label: 'Chains: iron links whipping' },
      { id: 'control', family: 'control', label: 'Control: a heavy low slam' },
      { id: 'crush', family: 'control', label: 'Crush: a hammer falling' },
      { id: 'stomp', family: 'control', label: 'Stomp: a heavy footfall' },
      { id: 'roar', family: 'control', label: "Roar: a beast's bellow" },
      { id: 'growl', family: 'shadow', label: 'Growl: a guttural threat' },
      { id: 'bite', family: 'steel', label: 'Bite: jaws snapping' },
      { id: 'dash', family: 'wind', label: 'Dash: a burst of speed' },
    ],
  },
  {
    group: 'Tech',
    sounds: [
      { id: 'gunfire', family: 'thunder', label: 'Gunfire: a burst of shots' },
      { id: 'cannon', family: 'thunder', label: 'Cannon: a black-powder boom' },
      { id: 'laser', family: 'arcane', label: 'Laser: a retro beam' },
      { id: 'shock', family: 'thunder', label: "Shock: a taser's crackle" },
    ],
  },
] as const;

export type CastSoundId = (typeof CAST_SOUND_GROUPS)[number]['sounds'][number]['id'];
export type CastSound = {
  readonly id: CastSoundId;
  readonly family: CastFamily;
  readonly label: string;
  readonly group: string;
};

export const CAST_SOUNDS: readonly CastSound[] = CAST_SOUND_GROUPS.flatMap((g) =>
  g.sounds.map((s) => ({ ...s, group: g.group })),
);

export const ATTACK_FAMILIES = ['swing', 'blade', 'heavy', 'bow', 'bolt', 'gunshot'] as const;
export type AttackFamily = (typeof ATTACK_FAMILIES)[number];

export const ATTACK_SOUND_GROUPS = [
  {
    group: 'Melee',
    sounds: [
      { id: 'swing', family: 'swing', label: 'Swing: a quick whip of air' },
      { id: 'blade', family: 'blade', label: 'Blade: a metallic slash' },
      { id: 'dagger', family: 'blade', label: 'Dagger: a quick stab' },
      { id: 'claw', family: 'blade', label: 'Claw: a raking scratch' },
      { id: 'chain', family: 'blade', label: 'Chain: iron links lashing' },
      { id: 'heavy', family: 'heavy', label: 'Heavy: a deep whoosh and a thud' },
      { id: 'blunt', family: 'heavy', label: "Blunt: a club's thud" },
      { id: 'staff', family: 'heavy', label: 'Staff: a wooden strike' },
      { id: 'punch', family: 'heavy', label: 'Punch: a fist landing' },
      { id: 'bite', family: 'heavy', label: 'Bite: jaws snapping' },
      { id: 'whip', family: 'swing', label: 'Whip: a crack of leather' },
    ],
  },
  {
    group: 'Ranged',
    sounds: [
      { id: 'bow', family: 'bow', label: 'Bow: a string twang and an arrow hiss' },
      { id: 'crossbow', family: 'bow', label: 'Crossbow: a latch and a heavy bolt' },
      { id: 'throw', family: 'swing', label: 'Throw: a spinning blade flung' },
      { id: 'bolt', family: 'bolt', label: 'Bolt: a short arcane zap' },
      { id: 'spell', family: 'bolt', label: 'Spell: a bolt of magic' },
      { id: 'laser', family: 'bolt', label: 'Laser: a retro beam' },
      { id: 'gunshot', family: 'gunshot', label: 'Gunshot: a rifle report' },
      { id: 'pistol', family: 'gunshot', label: 'Pistol: a sharp crack' },
      { id: 'cannon', family: 'gunshot', label: 'Cannon: a black-powder boom' },
    ],
  },
] as const;

export type AttackSoundId = (typeof ATTACK_SOUND_GROUPS)[number]['sounds'][number]['id'];
export type AttackSound = {
  readonly id: AttackSoundId;
  readonly family: AttackFamily;
  readonly label: string;
  readonly group: string;
};

export const ATTACK_SOUNDS: readonly AttackSound[] = ATTACK_SOUND_GROUPS.flatMap((g) =>
  g.sounds.map((s) => ({ ...s, group: g.group })),
);

export function isCastSound(v: unknown): v is CastSoundId {
  return typeof v === 'string' && CAST_SOUNDS.some((s) => s.id === v);
}

export function isAttackSound(v: unknown): v is AttackSoundId {
  return typeof v === 'string' && ATTACK_SOUNDS.some((s) => s.id === v);
}

// The school sound the synthesis plays for a cast id while the bank has
// no recording of it; a school name is its own family, anything unknown
// sounds arcane.
export function castFamilyOf(id: string): CastFamily {
  return CAST_SOUNDS.find((s) => s.id === id)?.family ?? 'arcane';
}

// The original attack the synthesis plays for an attack id.
export function attackFamilyOf(id: string): AttackFamily | undefined {
  return ATTACK_SOUNDS.find((s) => s.id === id)?.family;
}

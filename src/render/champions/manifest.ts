// The champion visual manifest: which rigged GLB each champion uses and how
// to drive it. Pure data and small lookups, zero three.js imports, so the
// clip-contract test can pin this table against the shipped GLB files from
// plain node. The models are CC0 packs (KayKit, Quaternius) recorded in
// CREDITS.md; the loader lives in assets.ts, the runtime in visual.ts.

// Clip names as they appear inside the GLB. `windup` holds (loops) while a
// cast is charging; the others are one-shots except idle/run.
export interface ChampionClipNames {
  idle: string;
  run: string;
  attack: string;
  cast: string;
  windup: string;
  death: string;
  // Some rigs (velociraptor) ship no hit-react clip.
  hit?: string;
}

// A signature prop built procedurally (props.ts) and riding a rig bone. The
// anchor follows the bone's POSITION only: bone orientations and scales vary
// wildly across these rigs (quantization compensation, per-pack conventions),
// so each prop's pose is authored here, relative to the champion's facing.
// Bone names are tried raw and GLTFLoader-sanitized ("handslot.r" arrives as
// "handslotr").
export interface ChampionPropDef {
  kind: 'sword' | 'shield' | 'daggers' | 'staff' | 'rifle' | 'bow';
  bone: string;
  // Euler XYZ rotation of the prop inside its anchor, radians.
  rot?: readonly [number, number, number];
  // Position offset inside the anchor, world units, for fine placement.
  pos?: readonly [number, number, number];
}

// How the cinematic portrait poses this champion: which clip, how far into
// it (0..1 of the clip), and the turn toward the camera. portrait.ts owns
// the lights and framing; this is only the champion-specific drama.
export interface ChampionPortraitPose {
  clip?: keyof ChampionClipNames;
  time?: number;
  yaw?: number;
  // Camera distance multiplier; below 1 frames tighter.
  zoom?: number;
}

export interface ChampionVisualDef {
  url: string;
  // World-space height the model is normalized to (feet land on y = 0).
  height: number;
  // Extra lift after grounding, for champions that hover.
  yOffset?: number;
  // Forward correction, radians, for models not authored facing +Z.
  yawOffset?: number;
  // Health bar height above the feet for this silhouette.
  barY: number;
  clips: ChampionClipNames;
  // Node names removed from the clone (baked accessories we replace or drop).
  hide?: readonly string[];
  // Mesh names tinted with the skin body color (team color on default skins):
  // capes and cloth, so allegiance reads on the body and not only the ring.
  teamMeshes?: readonly string[];
  // Mesh names that glow with the skin accent color (Dain's ember fists).
  accentGlowMeshes?: readonly string[];
  // World units per second at which the run clip's feet look planted; the
  // renderer scales the clip's time to the champion's actual speed from it.
  runSpeed?: number;
  // Drop root-node rotation tracks from every clip at load. Some rigs bake
  // a different root facing into individual clips (the goblin's Idle turns
  // it around); stripping the track keeps facing stable across clips.
  stripRootRotation?: boolean;
  // Cinematic portrait pose; portrait.ts falls back to idle when absent.
  portrait?: ChampionPortraitPose;
  // Material names recolored outright (flat-colored creature rigs only).
  recolor?: Readonly<Record<string, number>>;
  // Uniform multiply tint over every material (subtle palette shifts).
  tint?: number;
  // Whole-body opacity below 1 renders the champion translucent (Elowen).
  opacity?: number;
  props?: readonly ChampionPropDef[];
}

// KayKit humanoid rigs share one clip vocabulary; spelling it once keeps the
// ten defs readable. Attack is per champion (sword swing vs bow vs bolt).
const KAYKIT_CLIPS = {
  idle: 'Idle',
  run: 'Running_A',
  cast: 'Spellcast_Shoot',
  windup: 'Spellcasting',
  death: 'Death_A',
  hit: 'Hit_A',
} as const;

export const CHAMPION_VISUALS: Readonly<Record<string, ChampionVisualDef>> = {
  // Korrath, the Bulwark: a human knight in full plate behind a tower shield.
  korrath: {
    url: '/models/champions/knight.glb',
    height: 2.6,
    barY: 3.3,
    clips: { ...KAYKIT_CLIPS, attack: '1H_Melee_Attack_Slice_Horizontal' },
    teamMeshes: ['Knight_Cape'],
    portrait: { clip: 'attack', time: 0.35, yaw: 0.55 },
    props: [
      { kind: 'sword', bone: 'handslot.r' },
      { kind: 'shield', bone: 'handslot.l' },
    ],
  },
  // Dain, Emberfist: a bare-chested brawler whose fists smolder.
  dain: {
    url: '/models/champions/barbarian.glb',
    height: 2.45,
    barY: 3.15,
    clips: { ...KAYKIT_CLIPS, attack: 'Dualwield_Melee_Attack_Chop' },
    hide: ['Barbarian_BearHat'],
    accentGlowMeshes: ['Barbarian_ArmLeft', 'Barbarian_ArmRight'],
    portrait: { clip: 'attack', time: 0.5, yaw: 0.5 },
  },
  // Sylra, Thornweaver: a moss-cast witch, thorn staff in hand.
  sylra: {
    url: '/models/champions/mage.glb',
    height: 2.3,
    barY: 3.0,
    clips: { ...KAYKIT_CLIPS, attack: 'Spellcast_Shoot' },
    teamMeshes: ['Mage_Cape'],
    tint: 0xa8c890,
    portrait: { clip: 'attack', time: 0.6, yaw: 0.6 },
    // Offset keeps the vertical staff out of her face in portraits; from
    // the top-down camera the shift is imperceptible.
    props: [{ kind: 'staff', bone: 'handslot.r', pos: [0.32, 0, 0.12] }],
  },
  // Fenn, the Quickblade: a slight hooded silhouette, a dagger in each hand.
  fenn: {
    url: '/models/champions/rogue_hooded.glb',
    height: 2.15,
    barY: 2.85,
    clips: { ...KAYKIT_CLIPS, attack: 'Dualwield_Melee_Attack_Chop' },
    teamMeshes: ['RogueHooded_Cape'],
    runSpeed: 3.9,
    portrait: { clip: 'attack', time: 0.45, yaw: 0.6 },
    props: [
      { kind: 'daggers', bone: 'handslot.r', rot: [Math.PI, 0, 0] },
      { kind: 'daggers', bone: 'handslot.l', rot: [Math.PI, 0, 0] },
    ],
  },
  // Elowen, Mistward: a translucent mist spirit that never touches the ground.
  elowen: {
    url: '/models/champions/ghost.glb',
    height: 2.3,
    yOffset: 0.25,
    barY: 3.0,
    clips: {
      idle: 'Flying_Idle',
      run: 'Fast_Flying',
      attack: 'Punch',
      cast: 'Punch',
      windup: 'Punch',
      death: 'Death',
      hit: 'HitReact',
    },
    recolor: { Ghost_Main: 0xbfe4f0 },
    opacity: 0.72,
    portrait: { clip: 'idle', time: 0.3, yaw: 0.45 },
  },
  // Vesk, the Longshot: a goblin artillerist lugging a rifle taller than he is.
  vesk: {
    url: '/models/champions/goblin.glb',
    height: 1.55,
    barY: 2.2,
    clips: {
      idle: 'Idle',
      run: 'Run',
      attack: 'Attack',
      cast: 'Attack',
      windup: 'Attack',
      death: 'Death',
      hit: 'HitRecieve',
    },
    // The shipped atlas paints this goblin slate grey; the tint reads goblin.
    tint: 0xa8d890,
    runSpeed: 3.0,
    stripRootRotation: true,
    portrait: { clip: 'run', time: 0.3, yaw: 0.3, zoom: 0.72 },
    // The rifle leans across him, muzzle high: the silhouette IS the joke.
    props: [{ kind: 'rifle', bone: 'Arm.R', rot: [-1.05, 0, 0.25] }],
  },
  // Ashvyn, Nightbow: an undead archer, hood up, eyes burning.
  ashvyn: {
    url: '/models/champions/skeleton_rogue.glb',
    height: 2.25,
    barY: 2.95,
    clips: { ...KAYKIT_CLIPS, attack: '2H_Ranged_Shoot' },
    hide: ['Skeleton_Dagger_Baked'],
    teamMeshes: ['Skeleton_Rogue_Cape'],
    portrait: { clip: 'attack', time: 0.25, yaw: 0.55 },
    // Bow at a three-quarter angle: reads as a bow from the top-down camera.
    props: [{ kind: 'bow', bone: 'handslot.l', rot: [0, 0.6, 0] }],
  },
  // Maera, Tidecaller: a small winged water spirit riding its own swell.
  // The source glub is a dusk purple; the recolor turns it seafoam.
  maera: {
    url: '/models/champions/glubevolved.glb',
    height: 1.85,
    yOffset: 0.3,
    barY: 2.7,
    clips: {
      idle: 'Flying_Idle',
      run: 'Fast_Flying',
      attack: 'Punch',
      cast: 'Punch',
      windup: 'Punch',
      death: 'Death',
      hit: 'HitReact',
    },
    recolor: { Glub_Main: 0x4fb8c9, Wings: 0xbfe8f0 },
    portrait: { clip: 'idle', time: 0.4, yaw: 0.45, zoom: 0.8 },
  },
  // Torv, Stonehorn: a horned colossus recolored to weathered stone.
  torv: {
    url: '/models/champions/demonalt.glb',
    height: 3.3,
    barY: 4.0,
    clips: {
      idle: 'Idle',
      run: 'Walk',
      attack: 'Punch',
      cast: 'Punch',
      windup: 'Punch',
      death: 'Death',
      hit: 'HitReact',
    },
    hide: ['Trident'],
    recolor: { Demon_Main: 0x8a8f96 },
    // A slow colossus gait: the Walk clip reads planted around this speed.
    runSpeed: 2.2,
    portrait: { clip: 'attack', time: 0.3, yaw: 0.5, zoom: 0.8 },
  },
  // Rhoka, Wildclaw: a raptor, all claws and forward weight.
  rhoka: {
    url: '/models/champions/velociraptor.glb',
    height: 1.6,
    barY: 2.3,
    clips: {
      idle: 'Velociraptor_Idle',
      run: 'Velociraptor_Run',
      attack: 'Velociraptor_Attack',
      cast: 'Velociraptor_Attack',
      windup: 'Velociraptor_Attack',
      death: 'Velociraptor_Death',
    },
    // Long raptor strides: the run clip covers ground fast at full speed.
    runSpeed: 4.5,
    portrait: { clip: 'idle', time: 0.3, yaw: -2.3, zoom: 0.75 },
  },
};

export function championVisualDef(championId: string | null): ChampionVisualDef | null {
  return (championId && CHAMPION_VISUALS[championId]) || null;
}

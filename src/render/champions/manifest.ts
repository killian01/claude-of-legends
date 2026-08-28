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
  // A procedural prop shape built in props.ts, or, when url is set instead,
  // a static GLB loaded alongside the champion (a Meshy weapon export).
  kind?: 'sword' | 'shield' | 'daggers' | 'staff' | 'rifle' | 'bow';
  // GLB prop model; overrides kind. Normalized at load so its bounding-box
  // center sits on the anchor and its longest axis spans `size` world units.
  url?: string;
  size?: number;
  bone: string;
  // The prop keeps its authored orientation and follows its bone in
  // position only, skipping the hand rotation delta. For a two-handed GLB
  // weapon the delta would tilt it with the raising arm (a rifle pointing
  // skyward mid-aim); a fixed pose keeps the barrel level.
  fixedPose?: boolean;
  // Out-of-combat mount: while the champion idles or runs the prop rides
  // this bone instead (weapon slung on the back); combat (windup, attack,
  // cast) snaps it back to `bone`. rot and pos mirror the main fields.
  stowed?: {
    bone: string;
    rot?: readonly [number, number, number];
    pos?: readonly [number, number, number];
  };
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
  // Where projectiles visually leave the weapon: world units ahead of the
  // unit center along the fire direction, and height above the feet. The
  // renderer converges the bolt onto the sim-true path right after spawn.
  muzzle?: { forward: number; y: number };
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
  // Clips whose ground travel is baked into the hip bone (Meshy motions ship
  // with root motion): the loader pins their hip position track to its first
  // key so they play on the spot; the sim stays the only source of movement.
  inPlaceClips?: readonly string[];
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
  // Korrath, the Bulwark: a living rampart golem forged from fortress iron
  // and masonry. Meshy-generated model; the tower shield and siege maul are
  // separate Meshy GLB props riding the hands (CREDITS.md).
  korrath: {
    url: '/models/champions/korrath.glb',
    // The tallest silhouette on the roster: a rampart should dwarf even Torv.
    height: 3.6,
    barY: 4.4,
    clips: {
      idle: 'Short_Breathe_and_Look_Around',
      // A fortress walks; it never jogs.
      run: 'Walking',
      // Autos and ability casts both swing the maul; the windup braces
      // behind the tower shield while a cast charges.
      attack: 'Right_Hand_Sword_Slash',
      cast: 'Charged_Slash',
      windup: 'Shield_Push_Left',
      death: 'Dead',
    },
    // The combat clips shipped from Meshy with baked hip lunges; the GLB's
    // hip tracks were flattened horizontally in Blender (vertical weight
    // kept), so no runtime inPlaceClips pinning here. Dead keeps its full
    // travel: the fall to the ground is the clip.
    // The Walking clip reads planted around a slow colossus stride.
    runSpeed: 2.0,
    portrait: { clip: 'attack', time: 0.35, yaw: 0.55 },
    props: [
      // Carried over the right shoulder: the bbox centers on the hand, so the
      // maul rides up and in, rolled so the head rests against the pauldron.
      // The maul GLB centers its bbox on the anchor and the authored y=0
      // slice is mid-handle (measured; the head spans y 0.17..0.5), so a
      // zero offset puts the handle axis exactly through the hand bone in
      // every animation frame.
      {
        url: '/models/champions/korrath_maul.glb',
        size: 3.1,
        bone: 'RightHand',
      },
      // The shield mesh is a vertical slab, lion face +Z, grip straps on the
      // back at authored z -0.135; the z offset lands those straps exactly on
      // the hand bone (0.135 x scale 2.35). Position-only follow keeps the
      // tower upright through arm swings.
      {
        url: '/models/champions/korrath_shield.glb',
        size: 2.35,
        bone: 'LeftHand',
        pos: [0, 0, 0.32],
        fixedPose: true,
      },
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
  // Meshy-generated model with the rifle baked into the mesh (CREDITS.md).
  vesk: {
    url: '/models/champions/vesk.glb',
    height: 2.2,
    // Above the stowed rifle's tip, so the bar never crosses the silhouette.
    barY: 3.6,
    // Bolts leave at the rifle's front, shoulder high.
    muzzle: { forward: 2.3, y: 1.4 },
    // The export has no standing shot; Run_and_Shoot (0.67s) is the only
    // clip that actually fires, and the one-shot window compresses it to
    // attack tempo. The aim scan loops while a cast charges.
    clips: {
      idle: 'Long_Breathe_and_Look_Around',
      run: 'Running',
      attack: 'Run_and_Shoot',
      cast: 'Run_and_Shoot',
      windup: 'Archery_Aim_with_Lateral_Scan',
      death: 'Knock_Down_1',
      hit: 'Hit_Reaction_with_Bow',
    },
    inPlaceClips: ['Run_and_Shoot'],
    runSpeed: 3.0,
    portrait: { clip: 'run', time: 0.3, yaw: 0.3, zoom: 0.72 },
    // The Meshy rifle export rides the right hand, long as the goblin is
    // tall: the silhouette IS the joke. Authored muzzle-up along Y, laid
    // forward by the rotation.
    props: [
      {
        url: '/models/champions/vesk_rifle.glb',
        size: 3.9,
        bone: 'RightHand',
        // X lays the Y-authored barrel forward; the Y roll turns the
        // magazine from the side to straight down. The Z offset slides the
        // rifle forward so the hand grips at the magazine, not the barrel.
        rot: [Math.PI / 2, Math.PI / 2, 0],
        pos: [0, 0, 0.45],
        fixedPose: true,
        // At rest the rifle stands near-vertical on the back: magazine at
        // mid-back, barrel up, tip still below the health bar.
        stowed: { bone: 'Spine02', rot: [0.2, 0, 0.35], pos: [0, 0, -0.4] },
      },
    ],
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

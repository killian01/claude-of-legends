// The set a rigged champion moves with before it bakes anything.
//
// A built champion used to stand in a match as the plain placeholder
// figure until its creator had chosen and baked five animations: the
// model existed, was paid for, and could not be seen playing. The house
// clip library (CONTEXT.md, House clip) is retargeted onto the shared
// rig every forged biped carries and ships with the client, so it costs
// nothing to play and nothing to serve. A champion with no clips of its
// own borrows it, from the moment it is rigged.
//
// It is a stand-in and says so everywhere it shows: the creator's own
// bake replaces it whole, role by role, and a champion cannot be sealed
// on it (server/seal.ts still asks for a set the creator chose, which a
// house pick can be, for free).

// Which of the three shipped sets a weapon family borrows. Sword and
// shield for anything that swings one-handed, great sword for the heavy
// families, magic for everything that holds its arms out in front: a
// bow draw reads far closer to a cast than to a sword swing.
const SET_OF_FAMILY: Readonly<Record<string, string>> = {
  slashing: 'sns',
  blunt: 'gs',
  staff: 'magic',
  bow: 'magic',
  unarmed: 'sns',
};
const FALLBACK_SET = 'sns';

// One file per renderer role, per set. Named from the library on disk
// (public/models/mannequin/clips); the sword set has no cast of its own
// and borrows the great sword's, which is a two-handed gesture either
// way.
const FILE_OF_ROLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sns: {
    idle: 'sns_idle',
    run: 'sns_run',
    attack: 'sns_attack_01',
    cast: 'gs_cast_01',
    death: 'sns_death',
  },
  gs: {
    idle: 'gs_idle',
    run: 'gs_run',
    attack: 'gs_attack_01',
    cast: 'gs_cast_01',
    death: 'gs_death_01',
  },
  magic: {
    idle: 'magic_idle',
    run: 'magic_run',
    attack: 'magic_attack_01',
    cast: 'magic_cast_01',
    death: 'magic_death_01',
  },
};

export function houseClipUrl(name: string): string {
  return `/models/mannequin/clips/house_${name}.glb`;
}

// The role-to-URL map the clip-file loader takes, for a champion that
// has baked nothing. Same shape as a baked champion's clip files, so
// every path downstream is the one that already exists.
export function houseDefaultClipFiles(family: string | null): Record<string, string> {
  const set = FILE_OF_ROLE[(family && SET_OF_FAMILY[family]) || FALLBACK_SET] ?? FILE_OF_ROLE.sns;
  const out: Record<string, string> = {};
  for (const [role, name] of Object.entries(set ?? {})) out[role] = houseClipUrl(name);
  return out;
}

// Bakes the house animation library: every Mixamo source clip we ship,
// retargeted onto the Tripo v1.0 skeleton by scripts/retarget_mixamo.py
// and written under public/models/mannequin/clips/. The table below IS
// the curation record: which source file each house clip comes from and
// which fix it needs.
//
// Fixes, measured once with a hip-track scan of every source FBX:
//   yaw: the clip's facing offset from the rig's rest forward, in
//     degrees. Mixamo packs are authored in an angled stance (sword and
//     shield ~55, magic ~58, great sword ~16); the game aligns every
//     model to its rest forward, so an unfixed clip plays visibly
//     turned. Stances, strikes and casts use the clip's mean facing,
//     spin strikes their first frame. Deaths anchor on the FALL
//     direction instead (forward falls to forward, knockbacks to
//     straight back): the fall is the read, the starting stance is one
//     blended frame.
//   inplace: freezes the hip's horizontal travel; for strikes authored
//     as traveling lunges or spins, which must play on a standing
//     champion. Clips that only sway (travel under ~0.4 hip heights)
//     keep their motion.
// Only in-place performances are cataloged; walks, strafes, turns and
// jumps from the packs are deliberately absent (the run role is the one
// exception, its travel is measured and stripped by the client).
//
// Usage:
//   node scripts/bake_house_clips.mjs [--only <name,name>] [--render <dir>]
// Needs Blender on PATH or BLENDER set to the executable. Re-baking is
// idempotent: same inputs, same outputs, manifest entries kept in sync.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC_DIR = 'art_src/mixamo/extracted';
const OUT_DIR = 'public/models/mannequin/clips';
const MANIFEST = 'public/models/mannequin/mannequin.json';

// name -> house:<name>, house_<name>.glb. src is relative to SRC_DIR.
const CLIPS = [
  // The sword and shield set (lite pack), rebaked with the stance fix.
  { name: 'sns_idle', src: 'sword and shield idle.fbx', yaw: 54.8 },
  { name: 'sns_block_idle', src: 'sword and shield block idle.fbx', yaw: 67.2 },
  { name: 'sns_attack_01', src: 'sword and shield attack.fbx', yaw: 9.4, inplace: true },
  { name: 'sns_attack_02', src: 'sword and shield attack (2).fbx', yaw: 10.8, inplace: true },
  { name: 'sns_attack_03', src: 'sword and shield attack (3).fbx', yaw: 9.8, inplace: true },
  { name: 'sns_attack_04', src: 'sword and shield attack (4).fbx', yaw: 44.8 },
  { name: 'sns_death', src: 'sword and shield death.fbx', yaw: 2.0 },
  { name: 'sns_run', src: 'sword and shield run.fbx', yaw: 0.0 },

  // The great sword set.
  { name: 'gs_idle', src: 'great_sword/great sword idle.fbx', yaw: 15.6 },
  { name: 'gs_guard', src: 'great_sword/great sword blocking (2).fbx', yaw: -47.8 },
  { name: 'gs_attack_01', src: 'great_sword/great sword slash.fbx', yaw: 2.5 },
  { name: 'gs_attack_02', src: 'great_sword/great sword attack.fbx', yaw: 28.3 },
  { name: 'gs_attack_03', src: 'great_sword/great sword slash (3).fbx', yaw: -23.9 },
  { name: 'gs_attack_04', src: 'great_sword/great sword slash (5).fbx', yaw: 9.2 },
  { name: 'gs_cast_01', src: 'great_sword/spell cast.fbx', yaw: 55.1 },
  { name: 'gs_cast_02', src: 'great_sword/great sword power up.fbx', yaw: 3.8 },
  { name: 'gs_cast_03', src: 'great_sword/great sword casting.fbx', yaw: 3.1 },
  { name: 'gs_death_01', src: 'great_sword/two handed sword death.fbx', yaw: -0.2 },
  { name: 'gs_death_02', src: 'great_sword/two handed sword death (2).fbx', yaw: 3.3 },
  // The pack's other run ('great sword run.fbx') travels BACKWARD
  // (travel_yaw -180, a backpedal): skipped like sns run_02 was.
  { name: 'gs_run', src: 'great_sword/great sword run (2).fbx', yaw: 0.0 },

  // The magic set (pro magic pack).
  { name: 'magic_idle', src: 'magic/standing idle.fbx', yaw: 56.0 },
  { name: 'magic_guard', src: 'magic/Standing Block Idle.fbx', yaw: 11.3 },
  { name: 'magic_attack_01', src: 'magic/Standing 1H Magic Attack 01.fbx', yaw: 29.6 },
  { name: 'magic_attack_02', src: 'magic/Standing 1H Magic Attack 02.fbx', yaw: 14.0 },
  { name: 'magic_attack_03', src: 'magic/Standing 1H Magic Attack 03.fbx', yaw: 7.9 },
  { name: 'magic_cast_01', src: 'magic/standing 1H cast spell 01.fbx', yaw: 48.4 },
  { name: 'magic_cast_02', src: 'magic/Standing 2H Cast Spell 01.fbx', yaw: 30.9 },
  { name: 'magic_cast_03', src: 'magic/Standing 2H Magic Attack 01.fbx', yaw: 27.0 },
  { name: 'magic_cast_04', src: 'magic/Standing 2H Magic Area Attack 02.fbx', yaw: 20.6 },
  { name: 'magic_death_01', src: 'magic/Standing React Death Forward.fbx', yaw: 2.6 },
  { name: 'magic_death_02', src: 'magic/Standing React Death Backward.fbx', yaw: -7.9 },
  { name: 'magic_run', src: 'magic/Standing Run Forward.fbx', yaw: 0.0 },
];

function main() {
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? new Set(argv[onlyAt + 1].split(',')) : null;
  const renderAt = argv.indexOf('--render');
  const renderDir = renderAt >= 0 ? argv[renderAt + 1] : null;
  const blender = process.env.BLENDER ?? 'blender';

  const rows = CLIPS.filter((c) => !only || only.has(c.name));
  if (rows.length === 0) {
    console.error('no matching clips; names are:', CLIPS.map((c) => c.name).join(', '));
    process.exitCode = 2;
    return;
  }
  for (const [i, clip] of rows.entries()) {
    const out = path.join(OUT_DIR, `house_${clip.name}.glb`);
    console.log(`[${i + 1}/${rows.length}] ${clip.name} <- ${clip.src}`);
    const args = [
      '--background',
      '--python',
      'scripts/retarget_mixamo.py',
      '--',
      path.join(SRC_DIR, clip.src),
      `house:${clip.name}`,
      out,
      '--yaw',
      String(clip.yaw),
    ];
    if (clip.inplace) args.push('--inplace');
    if (renderDir) args.push('--render', path.join(renderDir, clip.name));
    const run = spawnSync(blender, args, { encoding: 'utf8' });
    const done = (run.stdout ?? '').split('\n').find((l) => l.startsWith('retarget done'));
    if (run.status !== 0 || !done) {
      console.error(run.stdout);
      console.error(run.stderr);
      throw new Error(`${clip.name} failed`);
    }
    console.log(`  ${done}`);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const clip of rows) manifest.clips[`house:${clip.name}`] = `clips/house_${clip.name}.glb`;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`done: ${rows.length} clip(s) baked, manifest updated`);
}

main();

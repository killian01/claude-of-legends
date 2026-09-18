# Sylra's model

Sylra, Thornweaver, is the first roster champion with a body of her own:
`public/models/champions/sylra.glb` replaces the KayKit mage she borrowed
until now. The file carries her eight-piece mesh, her thorn staff and the
eight clips the renderer plays, and `src/render/champions/manifest.ts`
names them the way every other rigged champion is named.

## What ships

| In the file | What it is |
|---|---|
| `SylraRig` | The armature: the 75 deform bones of a Rigify rig (spine, limbs, fingers, sixteen robe bones fanned round the hips, four hair locks). Control and mechanism bones stay in the source. |
| `Sylra_Hat`, `Sylra_Head`, `Sylra_Torso`, `Sylra_Skirt`, `Sylra_ArmLeft`, `Sylra_ArmRight`, `Sylra_LegLeft`, `Sylra_LegRight` | The body, skinned, one material (`Sylra_Body`, a 1024 base colour). |
| `Sylra_Staff` | The staff, a free node under the rig with its own material and texture. Every clip animates it: in the right hand for seven of them, dropped beside her in the death. |

| Clip | Length | Plays when |
|---|---|---|
| `Idle` | 4.0 s, loops | Standing: breath, a weight shift, the free hand and the cloth. |
| `Walk` | 0.83 s, loops, in place | Moving: the cane walk, authored at 1.33 s a cycle with short steps; the export lengthens the stride 1.75x and ships the cycle at 1.6x the pace, so at her height the feet plant at her move speed. |
| `Attack` | 1.54 s | An auto: a seed leaves the staff at 0.35 s into the swing. |
| `Cast_Q` | 2.0 s | Thorn Bolt: the staff thrusts forward, the bolt leaves its tip. |
| `Cast_W` | 2.0 s | Bramble Field: the staff plants, the free hand reaches the ground. |
| `Cast_E` | 2.0 s | Verdant Shell: the free hand raises the shell. |
| `Cast_R` | 3.33 s | Overgrowth: a long two-handed call. |
| `Death` | 3.0 s | The fall: knees, hips, shoulder, head, the staff released at 0.7 s. |

Sylra's `authoredTiming` manifest entry keeps spell gestures at their source
duration. Her attack scales with the simulation's windup so the seed releases
at the authored 0.35-second beat. Movement blends combat recovery back into
the walk. Other champions retain their existing timing windows.

The staff's animated `Sylra_Staff` node supplies the projectile origin, using
the local tip at `[0, 0.96, 0]`, instead of a fixed estimated muzzle.

## Attack and W effects

`public/models/effects/sylra_attack_seed.glb` contains the original thorn seed.
`sylra_bramble.glb` contains the 24 branching brambles, leaves, seeds, roots,
boundary, pollen and petal morph poses from Blender. Stems with the same
growth beat share five mesh groups to limit draw calls. `sylra_fx.ts` animates
growth at 24 fps and adds the game pulses and team-colored boundary.

The game activates W immediately, as before; the visible brambles grow with
the gesture. Simulation damage, targeting and duration are unchanged. Blender
compositor glow, ground mist and procedural bark shading are not reproduced
exactly by glTF materials.

## Q, E and R effects

The same export writes the other three spells, each from its own scene of
the source, and `sylra_fx.ts` plays them on the source's frame numbers:

- `sylra_thorn_bolt.glb`: the thorn projectile (the renderer lays it down
  the flight axis, like the seed) and the impact burst, twenty morph poses
  expanding from source frame 19 at chest height. The chain hop is the
  sim's second bolt and wears the same thorn.
- `sylra_verdant_shell.glb`: the shell at full formation (membrane, veins,
  leaves), its shard burst (poses from frame 72) and one burst thorn the
  runtime instances fourteen times. The shell is a shield body: the
  catalog's `shield` hooks build it when the cast lands, the renderer
  hangs it on whoever took the shield (`src/render/shield_holder.ts`
  reads the freshest shield status in reach), ticks it with the time left
  and ends it with the burst the frame the status leaves.
- `sylra_overgrowth.glb`: the telegraph (warning ring, the sap converging
  on the primal seed over the fuse) as the zone, then the eruption on the
  detonation: sixteen giant roots joined into three beats, nine poses each,
  the torn roots and glowing cracks, the pollen burst and the falling
  spores, sinking back from frame 80. It lives on `VfxSystem.timed`
  (`src/render/vfx/timed.ts`), the seam for authored geometry with a fixed
  life. The membrane's fresnel mix becomes an additive dome; trails and
  lights become the pooled rings, sparks and light pulses.

## Where it comes from

The source is `art_src/models_raw/forest_witch_cleanup/`, gitignored like
every raw generation: a Tripo model of the witch and a second one of her
staff, worked in Blender 5.2. The Blender file that matters is
`forest_witch_animations_completes.blend`; the ones beside it are the
stages that led to it (regrouped, rigged, first walk, first spell), kept
for going back.

Inside it the witch is regrouped from 116 Tripo fragments into eight
meshes, fitted with a Rigify rig, and animated action by action on the
control bones. Each spell and each lifecycle clip lives in its own scene
on its own copy of the rig, beside the studio lights, the camera and the
effect geometry of the reference renders (the `sylra_*.mp4` previews next to
the file). Scene names, actions, markers, asset labels, README notes and
current video captions are in English. The previous source is preserved in
`forest_witch_before_english_names.blend`. Technical Rigify bone identifiers
remain stable in the editable source.

## Exporting

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b \
  art_src/models_raw/forest_witch_cleanup/forest_witch_animations_completes.blend \
  --python scripts/export_sylra.py -- public/models/champions/sylra.glb
```

`scripts/export_sylra.py` does the whole assembly and refuses to finish
when a check fails:

- One export scene around the original rig, its meshes and its staff.
  Objects, meshes, materials, images and the deform bones take the English
  names above (`robe_avant` becomes `robe_front`, `meche` becomes `lock`).
- Each clip's action is pushed onto an NLA track, after the rig has taken
  the Rigify switches and the unkeyed control poses of the scene that
  authored it, so the exporter samples the clip the way its scene played
  it. The transfer check then plays every clip on both rigs and compares
  five joints on every frame; the export stops on any transfer gap.
- The walk's stride is lengthened before anything is sampled: the IK foot
  controls' forward travel is scaled 1.75x and their lift 1.25x, and the
  torso drops 3 cm so the unstretched legs still reach the ground at the
  extremes. Sylra stands 4.35 world units in the match, where the
  authored 0.19-unit steps read as a scramble.
- The staff is baked per frame into a free node (from the hand for seven
  clips, from the death scene's falling staff for the eighth) and rides
  the same track names, so the glTF exporter merges it into each clip.
- Textures are scaled to 1024 and written as JPEG. The report beside the
  GLB (`sylra.export.json`, not committed) records the planted walk speed
  and the staff tip at the Q release, which the manifest's `runSpeed` and
  `muzzle` are taken from.

`tests/champion_visuals.test.ts` reads the shipped file and fails when a
clip, a mesh or a bone the manifest names is not in it.

Export the effects against the same Blender source with
`--python scripts/export_sylra_effects.py`. Rebuild English preview videos
from the existing rendered frames with `scripts/translate_sylra_previews.py`.

`tests/sylra_integration.test.ts` loads the real shipped assets in Three.js:
Attack and W pose samples, attack release timing, distinct W action, moving
staff tip, recovery blending and growing effect morphs. Pose comparison allows
3 mm on the roughly one-metre source: decomposing Rigify's sheared matrices
into glTF translation/rotation/scale alone produces about 2.6 mm at W's feet.
The Blender rig-to-rig action transfer has zero joint error.

`node scripts/smoke_sylra.mjs` exercises the basic attack and the four
spells in the local browser playtest (the seed's beat, the bramble field,
the thorn bolt and its burst, the shell riding its holder and bursting at
expiry, the overgrowth telegraph and its eruption) and writes screenshots
plus a report under `.tmp/sylra-smoke/`.

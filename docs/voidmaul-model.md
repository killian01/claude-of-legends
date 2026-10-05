# Voidmaul model and animation

Voidmaul is a quadruped with two large forelegs and two shorter hindlegs. The
authored Blender asset retains the Tripo design, shared 4K atlas and original
deform skeleton, with repaired topology, 14 editable anatomical segments and
seven game animation clips.

## Asset lineage

| Asset | Purpose |
|---|---|
| [Original Tripo scene](../art_src/models_raw/voidmaul/voidmaul_tripo_original.blend) | Protected original model. |
| [Segmented source](../art_src/models_raw/voidmaul/voidmaul_segmented.blend) | Repaired surface, UVs, segmentation and quadruped walk controls. |
| [Pre-attack backup](../art_src/models_raw/voidmaul/voidmaul_pre_attack.blend) | Snapshot before the reference attack was added. |
| [First animation revision](../art_src/models_raw/voidmaul/voidmaul_animation_v1.blend) | Archived revision with the rejected shoulder twist and rigid death. |
| [Final animated scene](../art_src/models_raw/voidmaul/voidmaul_animated.blend) | Editable rig, seven game clips and full reference attack action. |
| [Game GLB](../public/models/creatures/voidmaul.glb) | Skinned meshes, packed texture and seven canonical animation names. |
| [Export report](../public/models/creatures/voidmaul.export.json) | Clip durations, skeletal samples, texture information and coordinate conventions. |

Raw Blender assets, references and audit files live under `art_src/`; the game
loads `/models/creatures/voidmaul.glb`.

## Geometry, UVs and rig

The assembled repaired surface contains 11,551 source vertices and 23,118
triangles. Repair removed three reviewed bridge or isolated triangles, capped
three actual hole regions and separated two coincident point contacts. The
result has zero boundary edges, multiple-face edges, wire edges, nonmanifold
vertices or degenerate faces. See the
[repair audit](../art_src/models_raw/voidmaul/audit_repair_final.json).

The 14 segments are Body, Crest, and upper, lower and foot regions for each of
the four legs. Segment boundaries deliberately duplicate source vertices.
Their coordinates, UV corners and skin weights remain identical, so the
assembled surface remains closed while each region is independently editable.
`SourceVertex` attributes allow validation of those shared boundaries during
deformation. The [segmentation audit](../art_src/models_raw/voidmaul/audit_segmented.json)
verifies zero UV, rest-position or skin-weight preservation error, no unweighted
vertices and no posed seam gap.

The existing `UVMap` and packed 4096 x 4096 sRGB texture are retained. Original
face UVs were preserved; new repair faces receive valid atlas coordinates.
All 69,354 assembled UV corners were checked, with no nonfinite or zero-area
UV triangles.

The final rig has 32 bones: 21 original deform bones and 11 controls. The controls
are `CTRL_Global`, `CTRL_Body`, `CTRL_Pelvis`, and a foot target and pole for each
leg. The original bind pose and weights are preserved. The Tripo limb names are
misleading: its `Left_Limb` chains are the long forelegs and `Right_Limb` chains
are the short hindlegs. Control suffixes L and R identify model X sides. The
reference attack uses `CTRL_Fore_R_Foot`, the +X forepaw visible on image right.

Blender uses Z up and -Y forward. The exported glTF uses Y up and +Z forward.
The source creature height is approximately one model unit.

## Clips

All clips are authored at 24 fps. Durations count frame intervals, including
the closing pose for a loop.

| Game clip | Blender action | Frames | Duration | Playback |
|---|---|---:|---:|---|
| Idle | `Voidmaul_Idle_Loop_96f` | 1-97 | 4.0000 s | Loop. |
| Walk | `Voidmaul_Walk_Loop_32f` | 1-33 | 1.3333 s | Four-beat quadruped loop. |
| Attack | `Voidmaul_Attack` | 1-77 | 3.1667 s | One forepaw slam and recovery. |
| AttackCrush | `Voidmaul_AttackCrush_77f` | 1-77 | 3.1667 s | Rear on planted hindfeet, lift both forepaws, double slam and recovery. |
| Hurt | `Voidmaul_Hurt_20f` | 1-21 | 0.8333 s | Grounded recoil and settle. |
| Death | `Voidmaul_Death_77f` | 1-78 | 3.2083 s | Collapse, then hold the final corpse pose. |
| Spawn | `Voidmaul_Spawn_96f` | 1-97 | 4.0000 s | Staggered grips, forceful pull, landing, forepaw stomp and crest bellow. |

Spawn intentionally begins below ground. The forepaws reach the edge before the
body and the hindlegs follow. Terrain or portal ground must occlude the
subterranean portion until 2.02 s. The forepaws grip separately at 0.60 and
0.72 s; the shoulders pull upward while the crest unfolds. The rear feet arrive
at 1.82 and 2.02 s. Once grounded, the right forepaw rises and strikes at 2.30 s,
followed by a broad chest and crest bellow and recovery to the guard pose by
4 s. This intentional early occlusion is excluded from floor-penetration
failures. [The Spawn builder](../scripts/voidmaul_spawn.py) authors these beats
through separate body, pelvis, spine and paw controls.

The [full body motion sheet](../art_src/models_raw/voidmaul/spawn_review/spawn_multiview_sheet.jpg)
shows the revised emergence, lifted forepaw and bellow from front and side.
The independent
[skin review](../art_src/models_raw/voidmaul/spawn_review/spawn_candidate_skin_review.json)
checks native and runtime four-weight deformation. Visible shoulder caps retain
their volume and stay continuous through the fast pull. Small inner joint
creases and an early submerged whole-patch budget miss are documented explicitly.

## Appearance ground rift

The game adds a procedural ground rupture around the Spawn clip through
[VoidmaulRiftFx](../src/render/vfx/voidmaul_rift_fx.ts). A jagged dark opening
spreads from an initial seam, surrounded by broken blue and violet light,
branching cracks, fractured stone slabs and drifting motes. The dark aperture
opens fully at 0.60 s and stays open for the emergence and stomp, then starts
closing at 2.85 s. [The burst effects](../src/render/vfx/voidmaul_rift_burst_fx.ts)
throw stones and sparks, drive broad flowing energy tongues above the crest,
and launch torn expanding shockwaves at rupture, rear landing and the forepaw
stomp. Dust spreads outward at ground level. The previous larger footprint
is retained, with width and depth enlarged by 15%.
The opening closes at 4.2 s and the remaining light disappears at 4.6 s.

[Shared Spawn timings](../src/render/voidmaul_spawn.ts) synchronize the body and
effects at 0.45, 2.02 and 2.30 s. The renderer pulses its existing light pool
and applies moderate camera kicks only for a nearby visible on-screen event.
Future beat crossings fire once; a late model or a creature returning from
fog cannot replay past flashes or shakes.

[VoidmaulRifts](../src/render/voidmaul_rifts.ts) starts the effect at the ring's
terrain height before the GLB finishes loading. It seeks to the same rise age
as Spawn, inherits creature visibility and captures a fixed ground transform.
Movement, turning, attack or death cannot drag the rift away from its birth
site. The effect completes its own closure and explicitly disposes its owned
geometry, materials and texture. These ground effects are rendered in Three.js;
the character GLB and the editable Blender body actions stay separate.

The [appearance MP4](../art_src/models_raw/voidmaul/voidmaul_spawn_rift.mp4),
[GIF](../art_src/models_raw/voidmaul/voidmaul_spawn_rift.gif) and
[chronological review](../art_src/models_raw/voidmaul/rift_review/spawn_rift_elevated_three_quarter_sheet.png)
show the actual game model and rift shader. The
[WebGL report](../art_src/models_raw/voidmaul/rift_review/report.json) records
the full birth sequence from two angles, pixel-exact late seeks, fixed anchoring
after movement and death, expiry, native export fidelity and shader checks.
The MP4 uses 24 fps. Reproduce with a local Vite server
on port 5186 and `node scripts/smoke_voidmaul_rift.mjs`; `CLIENT` selects another
origin. Focused Voidmaul animation, export, rift lifecycle and camera feedback
tests pass.

## Attack reference and fidelity

The supplied [Gemini video](../art_src/voidmaul/gemini_generated_video_59ab7b6f.mp4)
contains 240 frames at 24 fps, 1280 x 720, for a 10.000 s encoded shot. It shows
one attack on the image-right near forepaw. The opposite forepaw and both rear
paws support the creature throughout the main lift. The camera remains fixed,
and the paw strikes almost its original footprint. A later small lift of the
opposite forepaw is an idle adjustment.

The [timing passport](../art_src/voidmaul/attack_reference/attack_timing_passport.json)
records source frame numbers starting at zero. The
[contact sheet](../art_src/voidmaul/attack_reference/contact_and_liftoff_sheet.jpg)
shows the liftoff and impact at individual source-frame resolution.

| Event | Source frames | Source time |
|---|---:|---:|
| Initial guard | 0-36 | 0.000-1.500 s |
| Load and toe release | 37-41 | 1.542-1.708 s |
| Slow lift across the chest | 42-68 | 1.750-2.833 s |
| High anticipation hold | 69-73 | 2.875-3.042 s |
| Rapid downswing | 74-77 | 3.083-3.208 s |
| First ground contact | 78 | 3.250 s |
| Compression and dust onset | 79-88 | 3.292-3.667 s |
| Recovery | 89-112 | 3.708-4.667 s |
| Opposite-paw idle adjustment | 167-186 | 6.958-7.750 s |

`Voidmaul_Attack_Reference_240f` retains the full source timing in Blender frames
1-240. Its impact is frame 79. The game clip trims source frames 36-112 into
Blender frames 1-77; its impact is frame 43, or 1.75 s after clip start.

The corrected attack uses a forepaw sole lift of about 0.42 model height. Its
wrist retains its rest orientation, and the foot travels slightly forward and
outward while the calibrated IK pole remains on its original side. This keeps
the shoulder outside the torso during the curl. The rejected revision moved
the pole across the arm axis, twisting the upper arm almost 180 degrees and
collapsing its weights blended with the torso. No mesh or skin weights needed
changing once that motion was corrected. See the
[front and side motion sheet](../art_src/models_raw/voidmaul/correction_review/attack_v2_motion_sheet.jpg).
The source video morphs the mouth and rock arrangement slightly, so the retarget
retains the original mesh instead of copying those shape changes.

## Attack rock fracture and area damage

The Attack's 1.75 s contact now resolves a committed ground slam through
[the combat module](../src/sim/combat/voidmaul_slam.ts). The center is captured
when the windup begins, using the actual right-paw sole centroid at contact:
source glTF `(x,z) = (0.26546222, 0.23808068)`. At the current model scale
12.9 and holder scale 1.1 this becomes 3.76691 metres to the right and
3.37836 metres forward. [Match data](../src/sim/content/voidmaul_slam.ts)
defines the 5.5 metre radius, or 7.25 metres for an Ascendant, with its
1.35 size multiplier. These values participate in the content fingerprint.

Each valid hostile body overlapping the disk is damaged once. The original
target receives the full physical strike and champion health bite; secondary
targets receive 65% of each. Both use the ordinary mitigation, shield, death
and kill-credit pipeline. Moving outside the committed disk dodges the strike;
an interrupted or invalidated windup cannot create an impact. The slam
resolves directly rather than spawning the previous delayed homing bolt.
Other creatures retain their existing attacks.

The authoritative `voidmaul_slam` event carries the fixed point, radius and
contact time. Visible events travel through local play, replay, 5v5 snapshots
and Royale snapshots; presentation never invents a hit from an attack start
or HP delta. [The impact manager](../src/render/voidmaul_impacts.ts) seeks late
events without replaying flashes, rejects duplicates, and keeps the captured
ground anchor independently of movement or death. It owns a bounded set of
effects and releases evicted, expired and teardown resources.

The broken rock is part of the attack. [The stone rain](../src/sim/combat/voidmaul_stones.ts)
lays out 128 stones, 96 of them larger blocks, from a fixed integer hash and
exact angles: each leaves the ground near the paw and lands on its own point
of the ring between about 2 and 3.3 s after the contact. A stone that comes
down on a hostile body deals 40% of a slam's hit (physical, and the health
bite on a champion), once per slam however many stones fall on that body.
The pending stones live on the creature, so a world checkpoint carries them;
a Voidmaul killed while its stones are in the air takes the rest with it.
The creature remembers its ring at its rise (`ringHome`), which the renderer
reads from `map.rings`, so both build the same rain from the same slam event.

[The rock effect](../src/render/vfx/voidmaul_attack_fx.ts) draws those very
stones, with rotation and gravity, each arc meeting the ground at its sim
target on its sim landing time, then a short bounce and roll. The debris covers sixteen sectors and eight radial bands
of the whole authored ring. [The arena helper](../src/render/voidmaul_arena.ts)
reads the actual platform centre and radius from `map.rings`, independently
of the offset paw contact. In Star Orchard revision 123 the radius is 16.35
metres, matching the shipped platform's `radius_m` in the GLB. Leash and fog
margins do not enlarge the debris field. Planet play converts the source
centre into the active chart once and retains that map's radius.

The explosive launch sends blocks roughly 7-14 metres high, with 112 dust
particles, 128 bright fragments and a stronger central flash. The trajectory
and rebound keep the complete rock geometry within the platform. A torn
shockwave still reaches the damage radius. An
irregular dark crater, branching cracks and scattered stones remain after the
burst. The footprint and the stones hold until 4.5 s and fade out by 6.5 s,
so a fight at the ring is not buried under old debris. It is a visual
ground mark; terrain navigation remains unchanged. Subdivided ground geometry
follows the sampled terrain, including the ring's steps, and polygon offsets
keep it on the surface. The renderer adds a stronger attack-specific impact
light and a nearby on-screen camera kick only on a fresh resolved event.
Spawn feedback retains its separate timing and strength.

The [attack impact MP4](../art_src/models_raw/voidmaul/voidmaul_attack_impact.mp4)
shows the production model and effect at 24 fps. The
[exposed ground scar](../art_src/models_raw/voidmaul/attack_impact_review/scar_10s_without_boss.png)
shows the footprint after the creature leaves. The
[WebGL audit](../art_src/models_raw/voidmaul/attack_impact_review/report.json)
records two views, eight normal/Ascendant paw placements, 30 sloped/stepped
ground cases, exact debris contact, arena coverage and seek/lifetime checks.
Its dedicated scene renders the model, impact manager and shaders on a flat
disk with the shipped platform's dimensions; stepped
ground is checked geometrically. Light/camera feedback and actual damage
dispatch are covered separately by renderer and simulation tests. Reproduce
with Vite on port 5187 and `node scripts/smoke_voidmaul_attack.mjs`.


## Second attack and alternating swings

[AttackCrush](../scripts/voidmaul_crush.py) shifts the chest back and up while
both rear feet remain planted, raises both forepaws together, and drives them
down at 1.75 s. The torso compresses on contact, recoils and returns exactly
to its starting guard by 3.1667 s. The [front/profile motion sheet](../art_src/models_raw/voidmaul/crush_review/crush_multiview_sheet.jpg)
shows the complete motion. The [quarter-frame audit](../art_src/models_raw/voidmaul/crush_review/crush_pose_QA.json)
checks 305 poses for sole contact, floor clearance, shared seams and endpoints.
The [shoulder audit](../art_src/models_raw/voidmaul/crush_review/crush_skin_QA.json)
checks native and four-weight skinning of both sockets; the worst median local
volume ratio is 0.8165 on the right and 0.8685 on the left. The
[export preservation proof](../art_src/models_raw/voidmaul/crush_review/glb_preservation.json)
compares raw accessors and embedded data: all six previous animation tracks,
geometry, indices, UVs, skin weights, bind matrices, materials and atlas remain
identical. Only the new clip is added.

The simulation alternates `slam`, `crush`, `slam` per creature through its
saved `voidmaulAttackCount`. A completed ground contact advances the sequence,
including an attack the target dodges; an interrupted windup retries the same
choice. The committed plan carries that choice through a mid-attack checkpoint.
The swing event's `voidmaulAttack` and resolved event's `kind` travel through
local play, replay, 5v5 and Royale. [The swing note adapter](../src/game/attack_notes.ts)
preserves the server's choice. The renderer selects `Attack` or `AttackCrush`
from that note; it never runs its own animation counter. Legacy notes without
a kind retain the original slam. Both attacks keep the existing damage rules,
radii and contact timing.

Crush's impact disk is centred on the equal-weight midpoint of the two actual
sole centroids. At regular world scale, that point is 0.404608 metres to the
right and 3.624891 metres forward. The right sole is another 3.362299 metres
right and 0.246527 metres back, and the left has the opposite offsets. These
values live beside the original attack's calibration in match content and
scale with the Ascendant body. [The paired impact effect](../src/render/vfx/voidmaul_crush_paw_fx.ts)
puts a scar and pressure burst at each sole, emits debris from both feet and
strengthens the central wave. Its 128 rocks still cover the whole authored
arena and settle on the sampled terrain. They are the same stone rain as the
slam's, hurting what they land on; the sim throws the even stones from under
the left sole and the odd ones from under the right, and the `voidmaul_slam`
event of a Crush carries both paw points so every host draws the same rain.

The [Crush MP4](../art_src/models_raw/voidmaul/voidmaul_attack_crush.mp4) uses the
production animation and shaders. The [runtime WebGL report](../art_src/models_raw/voidmaul/crush_impact_review/report.json)
checks both paw effects against both exported soles, normal and Ascendant
placements, the complete debris trajectories, stepped terrain and persistent
scars. Native comparisons include the new clip; the report's pinned hashes
identify the exported asset and runtime code used. The scene uses a circular
platform with the shipped dimensions; renderer light/camera feedback and damage
dispatch are checked separately. Run the same smoke script with
`VOIDMAUL_ATTACK_KIND=crush` to reproduce it. The
[attack sequence test](../tests/voidmaul_attack_sequence.test.ts) checks actual
simulation ticks, replayed commands and a checkpoint during Crush against the
original events, damage and final state.

## Articulated death

The [death builder](../scripts/voidmaul_death.py) replaces the first revision's
rigid side rotation. The right foreleg gives way first, followed by the left;
the hindquarters drop later. The crest bows through separate spine rotations,
and the forepaws skid and roll into relaxed positions. The torso rests on the
ground in the final pose, at about 60% of the standing height. The final Body
surface sits 0.45 mm above the reference floor, within the contact tolerance.
The body never performs the old 84-degree side tumble.

Because relaxed paws rest on their outer fingers, death contact is measured
over the entire Foot segments rather than the original standing sole patches.
Stationary contact windows exclude intentional skids and hand rolls. The
[death audit](../art_src/models_raw/voidmaul/correction_review/death_v2_QA.json)
checks 309 quarter-frame poses; the
[motion sheet](../art_src/models_raw/voidmaul/correction_review/death_multiview_sheet.jpg)
shows the collapse from front and side. A localized crease remains at the
inner left armpit during folding; the broad outer armor stays intact. Skin
volume statistics alone are not used as visual approval.

## Runtime behavior

[VoidmaulVisual](../src/render/creatures/voidmaul_visual.ts) loads the canonical
clips and clones the skeleton for each creature. Idle and Walk loop; Attack,
AttackCrush, Hurt and Spawn return to the current base clip. Death clamps at its final pose.
The existing creature aspect beacon and Ascendant halo remain attached.

The walk is authored in place with a virtual forward speed of
0.11994158146948393 model units per second. Runtime playback rate follows actual
movement speed divided by this speed and the creature's world scale. This links
stance motion to translation rather than playing the same gait rate at every
speed. The renderer uses a model scale of 12.9 before the holder scale, so the
Voidmaul stands about 14 m tall, a ring's towering guardian; the ground rift
takes the same scale and the health bar rides over its crown.

Attack playback rate is `1.75 / windupSeconds`, so its contact pose coincides
with the simulation's damage beat. The simulation gives the Voidmaul that
beat itself (`windupS` in `src/sim/content/rings.ts`): the slam lands 1.75 s
after the swing and the next starts 3.33 s later, so the clip plays at its
authored speed. A champion who steps out of reach during the rise is missed. Hurt does not interrupt an active one-shot
or delay attack contact. Spawn can begin at the correct rise age if the model
loads during emergence.

## Validation and reproduction

The [full attack audit](../art_src/models_raw/voidmaul/audit_attack_full.json)
samples 957 poses at quarter-frame intervals across frames 1-240. It passes
with zero assembled boundary edges, posed seam gaps or floor penetration.
Its initial and final surface poses match exactly, and the walk action remains
available.

The [game clip audit](../art_src/models_raw/voidmaul/audit_runtime_clips.json)
checks Attack, Idle, Hurt, Death and Spawn at quarter-frame intervals, with
305, 385, 81, 309 and 385 samples respectively. Every clip passes without
warnings. All assembled surfaces have zero boundary edges and zero posed seam
gaps; floor penetration is zero wherever the mesh is expected above ground.
The [walk subframe audit](../art_src/models_raw/voidmaul/audit_walk_subframes.json)
adds 129 quarter-frame samples, with zero floor penetration and a maximum
supporting-sole height error of about 0.000049 model units. Supporting targets
remain fixed during stationary contact windows; small skinned-sole residuals
remain within the validation tolerances.

The [earlier saved-file audit](../art_src/models_raw/voidmaul/audit_animated_saved_file.json)
verifies the repaired original, six actions, packed texture, UVs, weights,
closed surface and corrected attack contacts. The revised Spawn's
[saved-file audit](../art_src/models_raw/voidmaul/spawn_review/spawn_final_saved_file_audit.json)
reopens the current blend and confirms that geometry, UVs, skin weights, bind
pose, constraints and every other action remain unchanged. Its
[quarter-frame audit](../art_src/models_raw/voidmaul/spawn_review/spawn_final_quarterframe_audit.json)
checks 385 poses. The previous slow Spawn is archived in Blender and excluded
from the canonical game clips.
The current [real WebGL report](../art_src/models_raw/voidmaul/rift_review/report.json)
checks the revised appearance with no shader errors. Across eight poses, 168
exported joints match Blender within 0.000000474 metres. All 831 shared segment
seam groups remain exactly coincident after the runtime's four-weight skin export.
The focused animation and export tests, TypeScript check and production build
pass.

Two exported-asset regressions reject the archived first revision: one samples
the actual shoulder rotation and proximal surface edge crushing, and the other
requires foreleg articulation, torso descent and a low final corpse silhouette.
The [deformation validator](../scripts/voidmaul_deformation_validate.py) measures
native and four-weight shoulder skinning. The corrected attack's worst median
local volume ratio is 0.846, versus approximately 0.037 for the rejected twist;
its upper-arm axial twist stays below 39 degrees. The earlier full chronological
[attack review](../art_src/models_raw/voidmaul/game_review_v2/attack_front_three_quarter_sheet.png)
and [death review](../art_src/models_raw/voidmaul/game_review_v2/death_front_three_quarter_sheet.png)
use the actual game loader and shader; both corrected actions are unchanged
in the new export. A third exported-asset regression requires complete emergence
by 2.02 s, a visibly lifted forepaw before the 2.30 s stomp, and articulated
crest motion during the bellow.

The complete reference-timed attack is available as an
[MP4 preview](../art_src/models_raw/voidmaul/voidmaul_attack_reference.mp4),
[GIF preview](../art_src/models_raw/voidmaul/voidmaul_attack_reference.gif) and
[timing sheet](../art_src/models_raw/voidmaul/voidmaul_attack_sheet.jpg).
The corrected death has an [MP4 preview](../art_src/models_raw/voidmaul/voidmaul_death.mp4)
and [GIF preview](../art_src/models_raw/voidmaul/voidmaul_death.gif).

The reusable Blender modules are:

- [Mesh repair](../scripts/voidmaul_mesh_tools.py) and
  [anatomical segmentation](../scripts/voidmaul_segment.py).
- [Quadruped walk and controls](../scripts/voidmaul_walk.py).
- [Reference attack build](../scripts/voidmaul_attack.py).
- [Two-paw crush build](../scripts/voidmaul_crush.py).
- [Idle, Hurt, Death and Spawn build](../scripts/voidmaul_extra_clips.py).
- [Forceful Spawn build](../scripts/voidmaul_spawn.py).
- [Structural validation](../scripts/voidmaul_validate.py) and
  [posed animation validation](../scripts/voidmaul_attack_validate.py).
- [GLB export](../scripts/export_voidmaul.py) and
  [browser smoke check](../scripts/smoke_voidmaul.mjs).

Build the attack on the segmented source using only the 14 anatomical meshes.
Exclude the hidden repaired source mesh from sole measurements. Build the extra
clips after the control rig and attack exist. The modules preserve previous
actions; the attack builder rejects an existing full attack action, so use a
clean source revision when rebuilding.

Export the final scene with Blender:

```text
blender --background art_src/models_raw/voidmaul/voidmaul_animated.blend --python scripts/export_voidmaul.py -- public/models/creatures/voidmaul.glb
```

The exporter duplicates the rig and segments into a temporary scene, retargets
constraints and modifiers, samples one NLA track per canonical clip, and removes
the temporary scene afterwards. It preserves the authored scene and writes the
GLB plus its export report. With a local Vite server running, the browser check
is `node scripts/smoke_voidmaul.mjs`.

# The Pyrefang's model

The Pyrefang, the bot ring's creature (`CONTEXT.md`, ADR 0022), is getting a
body of its own to replace the procedural figure of
`src/render/creature_shapes.ts`. This page records the source as it stands:
the segmented mesh, the rig and the fire built over it. Nothing ships yet:
no clips, no export, no manifest entry.

## Where it comes from

The source is `art_src/models_raw/pyrefang/`, gitignored like every raw
generation: a Tripo generation of the creature from a four-view turnaround
sheet (itself drawn from the splash prompt), fourteen triangle-mesh parts
with one 1024 base colour, worked in Blender 5.2. The Blender file that
matters is `pyrefang_segmented.blend`. The creature faces -Y, is about one
source metre long and 0.56 tall; +X is its left.

## The segments

Tripo's split was asymmetric (each left leg one piece, the right legs with
a foot apart, the tail and the crest one piece each), so the mesh was
re-segmented from the skeleton: every vertex takes the nearest bone among
those allowed for its Tripo part, and the parts are cut per bone by face
majority. The result is seventeen objects in the `Pyrefang` collection:

| Object | What it is |
|---|---|
| `Pyrefang_Head`, `Pyrefang_Jaw` | The skull with the front of the crest, and the lower jaw on its own for the bite. |
| `Pyrefang_Neck`, `Pyrefang_Body`, `Pyrefang_Tail` | The neck with the back of the crest, the torso with its ridge of spikes, the whole tail. |
| `Pyrefang_L_UpperArm`, `_L_Forearm`, `_L_Hand` and the `R_` three | The front legs, three pieces each. |
| `Pyrefang_L_Thigh`, `_L_Shin`, `_L_Foot` and the `R_` three | The hind legs, digitigrade, three pieces each. |

Tripo's raw parts stay in the `Tripo_raw` collection, excluded from the
view layer.

## The rig

`PyrefangRig`, 28 bones, no control bones. `Root` at the origin does not
deform; under it `Hips`, then `Spine`, `Chest`, `Neck01`, `Neck02`, `Head`,
`Jaw`; `Tail01..08` along the tail's measured centreline; per side
`UpperArm`, `Forearm`, `Hand` under the chest and `Thigh`, `Shin`, `Foot`
under the hips. Every bone's roll is set so its local X is the world X: an X
rotation is always a pitch in the sagittal plane. For the tail (running +Y
and down) positive X raises it; for the neck and the head negative X raises
the nose; for a front leg negative X on the upper arm swings it forward.

Weights are positional rather than heat-mapped: the primary bone at 1.0,
blended half and half with the neighbouring bone over a band of two to five
centimetres along the bone at each joint. Both sides of a cut share the
same weight function, so the seams between segments never open in a pose.

## The fire

`scripts/build_pyrefang_effects.py` builds the fire over the rigged body,
step by step or all at once (`build_all`), the way Elowen's mist is built:

- `body_glow`: the hide's material darkens toward obsidian and its lava
  cracks emit, the emission colour being the base colour and its strength
  the texture's redness.
- `crest_flames`, `spine_flames`, `tail_fire`: a flame tongue on every
  spike tip the mesh gives (a vertex standing above its neighbourhood near
  the midline, kept only near the ridge line), sized by how far the spike
  stands out, with short filler tongues on the ridge between them; the
  tail's shrink to the tip and four long tongues stream past it. A tongue
  is three cards at 60 degrees, its base sunk one to two centimetres into
  the body and its texture fading in from the root, so no card edge shows
  from any angle. One mesh per zone, three morph poses (`Pose_00..02`)
  cycled round for the flicker, every tongue weighted to the bone nearest
  its base.
- `maw_glow`: a glowing card inside the open maw, riding the head bone. The
  eyes stay the texture's: lit spheres placed by guess sat beside them.
- `embers`: ninety sparks seeded along the ridge and the tail, lifted and
  scattered by the poses, riding the nearest bone.
- `animate`: viewport keys, the poses cycling at 3.2 Hz (the embers at
  0.9), and the rig turning once on the spot.

The textures are generated in the script (`pyre_flame`, four tongues side
by side with a bright core, an orange middle and a deep red tip;
`pyre_spark`, a soft dot) and packed in the blend. Materials are
emission-only and blended, an `additive` custom property marking them for
the runtime, so `scripts/export_elowen_effects.py` is the model for
shipping them.

## The clips

`scripts/build_pyrefang_clips.py` generates every clip procedurally on
`PyrefangRig` and bakes one key per frame at 24 fps, XYZ Euler on every
bone plus the root's location; the actions carry a fake user, a `loop`
property and, for the attack, the `release` beat in seconds.

| Clip | Length | What it is |
|---|---|---|
| `Idle` | 6 s, loops | Prowling on the spot: breath on the spine, a slow look left and right, the jaw working, the tail alive on two waves. |
| `Walk` | 1.2 s, loops, in place | A diagonal trot: the left front with the right hind, the leg carried forward with the lower joints folded, the hips rolling, the tail swinging. The root does not travel. |
| `Attack` | 1.4 s | The bite: the body coils back for 0.35 s with the jaws opening, lunges 10 cm with the neck driving out, and the jaws snap at 0.55 s. |
| `Roar` | 1.5 s | The head rears, the jaws open wide, the tail rises, the neck shaking through the roar. For the first contact and the reset. |
| `Rise` | 2.5 s | Crouched on the ring at frame 1, on its feet by 1.2 s, a head shake, then a roar, settling to rest. Plays when it rises. |
| `Death` | 3 s | Struck, the head thrown up with a cry; a stagger, the left hind stepping back; the elbows fold, then the hind legs, the belly meets the ground; it rolls onto its left flank with an overshoot and a bounce, the head landing last; one long last breath, the upper hind leg kicks once, the tail falls and its tip curls; still by 3 s. |

The loops are sine waves along the chains; the gestures are smoothstep
tracks layered over a fainter breath, so the body never freezes during a
bite. Ground contact is checked on the deformed mesh (`lowest_point`), the
poses found by search where a joint met the floor, and `ground` lifts the
root by what is left, capped at five centimetres; the Death sinks at most
half a centimetre. Previews render from the viewport to
`art_src/models_raw/pyrefang/pyrefang_<clip>_preview.mp4`.

## Next

The export script, the manifest entry, and the runtime for the flames in
`src/render/vfx/`.

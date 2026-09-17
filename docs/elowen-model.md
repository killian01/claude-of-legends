# Elowen's model

Elowen, Mistward, gets a body of her own: `public/models/champions/elowen.glb`
replaces the KayKit ghost she borrowed until now. The file carries her
seven-piece mesh and the eight clips the renderer plays, and
`src/render/champions/manifest.ts` names them the way every other rigged
champion is named.

## What ships

| In the file | What it is |
|---|---|
| `ElowenRig` | The armature: the 41 bones of the Tripo biped rig (root, hips, spine, neck, head, limbs with twist bones, feet) plus 43 cloth bones in chains, 84 deform bones in all. No control bones: every clip is keyed on the deform bones. |
| `Elowen_Body`, `Elowen_Hair`, `Elowen_Halo`, `Elowen_Skirt`, `Elowen_Legs`, `Elowen_SleeveLeft`, `Elowen_SleeveRight` | The body, skinned, one material (`Elowen_Body`, a 1024 base colour as JPEG). The halo rides the head bone and shares the material. |

The cloth chains, each bone parented to the one before it so a gesture on
the parent swings the whole chain:

| Chain | Bones | Hangs from |
|---|---|---|
| `L_Sleeve01..05`, `R_Sleeve01..05` | 5 each | The forearm, at the elbow; the sleeve meshes are weighted to the chain and the forearm only. |
| `Skirt_F`, `Skirt_FL`, `Skirt_BL`, `Skirt_B`, `Skirt_BR`, `Skirt_FR` `01..04` | 4 each, six chains fanned round the hips | The waist. |
| `Hair_L`, `Hair_B`, `Hair_R` `01..03` | 3 each | The head. |

She faces -Y in the source and stands one source metre at rest: the halo's
top is at 1.0, the top of the head at about 0.96. Every clip lifts her off
the ground: the idle carries the root between 0.055 and 0.145 above its
rest, the run between 0.115 and 0.165. The export's report records the
lift on the idle's first frame, so the manifest can seat her.

| Clip | Length | Plays when |
|---|---|---|
| `Levitate` | 11.96 s, loops | Standing: she hovers, the root rising and settling, the skirt, sleeves and hair swaying. |
| `Glide` | 1.96 s, loops, in place | Moving: the run clip, hovering higher than the idle with the cloth chains swinging; the root does not travel. |
| `Attack` | 1.42 s | An auto: an open-hand gesture from the right hand, releasing at 0.55 s (frame 14). |
| `Cast_Q` | 1.5 s | Mist Lance: both hands gather at the chest, the right palm pushes the lance out at 0.55 s, the left hand draws back. |
| `Cast_W` | 1.79 s | Veil: the arms spread palms down, then lay the veil with a slow sweep down; the skirt flares with it. |
| `Cast_E` | 0.5 s | Drifting Step: a blink, so one quick lean into the step, the cloth drawn in then blown back, over before the arrival's flash. |
| `Cast_R` | 2.42 s | Whiteout: a slow rise of 12 cm, arms and cloth opening to the sky, then the storm is laid down. |
| `Death` | 2.5 s | Struck, she folds and dissipates upward, the cloth flaring beneath her. |

The export script fixes no clip length: it reads every clip's frame range
from the action's keys, so a regenerated gesture ships at its own length.

## Where it comes from

The source is `art_src/models_raw/elowen/`, gitignored like every raw
generation: a Tripo smart-mesh generation of the spirit in quads, rigged
by Tripo, worked in Blender 5.2. The Blender file that matters is
`elowen_v2_segmented.blend`; `elowen_tripo_cleanup.blend` beside it is the
stage before segmentation, kept for going back, and the `elowen_*_preview.mp4`
files are the reference renders of the clips.

Inside it the Tripo mesh is segmented into the seven parts above by a
script that welded its 56 shells and cut the sleeves at the elbow, each
part carrying its shipped name and the vertex groups of the bones that
move it. The cloth chains were added to Tripo's rig and their weights
placed by geodesic distance along the mesh. The raw import stays in a
`Tripo_raw` collection, excluded from the view layer, and never reaches
the file.

Every clip is generated procedurally rather than keyed by hand: the idle
is a set of sine waves on the root's hover and the cloth chains; the
gestures are smoothstep tracks layered over the idle's waves, so a cast
or the attack never stops the hover; the sleeves are decoupled from the
forearm's gesture so they keep hanging through it. The actions are keyed
on every frame at 24 fps, with quaternion rotations, and the root also
carries location keys for the hover.

## Exporting

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b \
  art_src/models_raw/elowen/elowen_v2_segmented.blend \
  --python scripts/export_elowen.py -- public/models/champions/elowen.glb
```

`scripts/export_elowen.py` does the whole assembly and refuses to finish
when a check fails:

- The source is checked first: the rig at the origin with only deform
  bones, the seven meshes parented to it through one armature modifier
  with their vertex groups a subset of its bones, the raw collection
  excluded, and every clip's action present (the missing ones are listed).
  `--only Levitate,Glide,Attack` after the `--` restricts the export to
  the named clips while the others are still being authored; the report
  then says `partial`.
- One export scene around the rig and its seven meshes. The raw Tripo
  object is removed outright: it is parented to the rig, and the glTF
  exporter follows a rig's children whether or not the scene holds them.
- Each clip's action is pushed onto an NLA track, one strip each, nothing
  active, the pose reset to identity; the exporter samples the deform
  bones every frame with the rig in its rest position.
- The texture is scaled to 1024 at most and written as JPEG at quality 82.
- The report beside the GLB (`elowen.export.json`, not committed) records
  the clips with their frames and seconds, the deform bone count, and the
  measures the manifest is taken from: her height and the halo's top on
  the idle's first frame, the hover offset (the root's height on that
  frame above its rest), and the right hand's tail on the attack's release
  frame as `forward` (-y) and `height` (z), which the `muzzle` is derived
  from. The manifest also names the hand bone itself as the embedded
  muzzle (`R_Hand`, a few centimetres down the bone), so the auto and the
  lance leave her hand wherever the gesture holds it; the measured muzzle
  is the estimate until the rig is up.

`tests/champion_visuals.test.ts` reads the shipped file and fails when a
clip, a mesh or a bone the manifest names is not in it.

## The spells

Her mist is modelled, not simulated: five files under
`public/models/effects/`, built in the same Blender source by
`scripts/build_elowen_effects.py` (one scene per spell and one for the
auto, `FX A` and `FX Q` to `FX R`)
and exported by `scripts/export_elowen_effects.py`. Everything is layered
translucent geometry (ribbons swept along helices and curls, domes, a
curtain, flat spirals, crossed flecks) wearing three generated alpha
textures: a streaked ribbon, a turbulent puff and a tattered veil. Parts
that grow carry relative shape keys `Pose_00..` from a collapsed base;
parts that turn carry a `spin` in radians a second; every material says
whether it draws additively. `src/render/vfx/elowen_fx.ts` reads those
extras and plays the files at 24 source frames a second, scaled with her
manifest height.

| File | What it holds | Plays when |
|---|---|---|
| `elowen_attack_wisp.glb` | The auto's wisp: a small bright spindle with two mist ribbons spinning round it; the impact: five small petals bursting from a point over 8 poses. | An auto in flight, then where it hits. |
| `elowen_mist_lance.glb` | The lance: a bright core, three helical mist ribbons spinning round it, a trailing sheath; the impact: eight petals unfurling over 14 poses and a ground wave over 10. | Q in flight, then where it lands. |
| `elowen_veil.glb` | Two domes rising over 12 poses and turning against each other, seven wisps climbing the dome, a ground mist, floating flecks. Authored at the zone's radius. | W, for the zone's life, fading over its last beats. |
| `elowen_step.glb` | The blink's flash: a core swelling, ten tufts thrown outward and a ground ring, 6 poses each (a quarter second); a streak one metre long that the runtime stretches to the step. | E: the flash where she left, the streak to where she landed, the flash again there one beat later. |
| `elowen_whiteout.glb` | The wall of wind on the rim, twelve twisting ribbons climbing it, the eye's flat spiral pulled to the centre, a central vortex, a ground mist, orbiting snow. Authored at the zone's radius. | R, for the storm's life. |

The `elowen_fx_*_preview.mp4` renders beside the source are Eevee
previews of each scene's growth and spin.

# The Pyrefang's Codex clips

The Pyrefang's seven clips are built from the rest model and rig by
`scripts/build_pyrefang_codex.py`, with poses and curves of their own, into
`art_src/models_raw/pyrefang/codex/pyrefang_codex.blend` (gitignored, like all
of `art_src/`). `scripts/export_pyrefang.py` turns that file into the GLB the
game ships, and the client plays it (`src/render/creatures/pyrefang_visual.ts`).
The model itself is described in [pyrefang-model.md](pyrefang-model.md).

## The clips

| Scene / action | Clip | Length | Frames at 24 fps |
| --- | --- | ---: | ---: |
| `Codex_Idle` | Watchful idle, loops | 10 s | 240 |
| `Codex_Walk` | Walk, in place, loops | 4/3 s | 32 |
| `Codex_Attack` | Bite | 1.4 s | 34 |
| `Codex_Roar` | Roar | 1.5 s | 36 |
| `Codex_Rise` | Calm wake | 2.5 s | 60 |
| `Codex_Emerge` | Emerge from the fire | 3 s | 72 |
| `Codex_Death` | Death | 3 s | 72 |

- **Right hind leg.** The source rig had copied the left hind chain onto the
  right side, while the Tripo mesh stands its right hind leg about 8 cm further
  forward. `scripts/pyrefang_codex_hind_refit.py` refits `R_Thigh`, `R_Shin` and
  `R_Foot` onto the mesh at rest and rebuilds the leg weights as one continuous
  function of position (22 mm blend planes at the knee and the hock), so both
  hind legs fold alike.
- **Walk** (`scripts/pyrefang_codex_walk.py`), after
  [Rusty Animator's cat walk cycle](https://www.youtube.com/watch?v=-G-ZDo1UXhU):
  a lateral sequence where each hind paw leads its fore paw by 0.22 of a cycle
  (right hind 0, right fore 0.22, left hind 0.50, left fore 0.72); 20 cm of
  stance over 68 % of the cycle, so the paws stay planted at `WALK_SPEED`, about
  0.22 m/s; paws placed by their claw tips (`LegSolver.pose_toe`), peeling heel
  first, hanging from a folded wrist or hock through the swing, unfolding to
  reach; shoulder blades riding over the supporting fore leg; pelvis and thorax
  rolling toward their supporting legs and yawing toward the reaching ones, so
  the spine twists between the girdles; the neck absorbs the thorax with a delay
  and the gaze stays steady.
- **Idle** (`scripts/pyrefang_codex_idle.py`, `pyrefang_codex_tail_idle.py`),
  compared frame by frame with the reference video: paws under the body
  (`FORE_UNDER`, `HIND_UNDER`, shared by every clip but the walk so the splices
  stay exact), a hiss at about 1 s, a snarl, a 50 degree look at the camera
  near 5.4 s, a deep sit, and a tail whose dark distal third carries the hook.
- **Bite**: a coil back on the hips (0.06 to 0.36 s), a 9 cm lunge with a fore
  paw step, the jaws snapping at exactly 0.55 s (the sim's hit lines up with
  it), two tearing shakes.
- **Roar**: the head dips, the chest rears while the right fore paw lifts, the
  jaw opens to 47 degrees with a 13 Hz tremor while the head sweeps, the paw
  stamps near 1.13 s.
- **Emerge**: the creature sleeps curled belly down, spine in a C, head back to
  the hip, tail down to the floor and round to the muzzle, the outer hind leg
  tucked against the flank (`EMERGE_TUCK`). It breathes twice, lifts its head
  with a yawn (0.75 to 1.65 s), plants its fore paws (1.45 and 1.75 s), steps
  its hind paws out of the fold (1.95 and 2.25 s) and ends on the idle's first
  pose, which is also the roar's: the game chains Emerge, Roar, Idle.
- **Death**: the hit throws the head back, jaw open, then the body settles on
  its flank and holds still after 2.7 s.

The attack, the roar and the emerge are sampled at 72 keys a second like the
walk, so the soles stay planted through fast moves.

## The rise's fire column

`scripts/pyrefang_codex_rise_column.py` builds the fire the Pyrefang rises from
in the `Codex_Emerge` scene, the way the Elowen effects are built: layered
additive geometry, driven continuously. The beats follow a painted six-phase
sheet: a lava swirl opens on the floor and a crown of 20 small flames ignites;
16 helical tongues and 6 core tongues climb and twist (0.15 s), tighten into a
vortex (0.35 s), stand as a full column (0.55 s), open in two (0.95 s) and fall
back into low flames that die by 1.75 s. Every tongue is a ribbon with one
shape key per beat, cross-faded every frame; a tileable vein noise streams up
each ribbon under a tongue mask, coloured deep red to pale yellow. A shock ring,
48 sparks and a light complete it.

## In the game

- **Export**: `blender -b art_src/models_raw/pyrefang/codex/pyrefang_codex.blend
  --factory-startup --python scripts/export_pyrefang.py --
  public/models/creatures/pyrefang.glb` takes the Idle scene's rig and meshes,
  pushes the seven `Codex_*` actions onto NLA tracks (Idle, Walk, Attack, Roar,
  Rise, Death, Emerge) and writes `pyrefang.export.json` beside the GLB. What
  does not ship: the tail's B-Bone segments (glTF skins plain bones, so the tail
  bends at its eight joints), the flames' per-frame shapes (the crest, spine and
  tail flames ship in their rest shape, skinned; the plume past the tail tip,
  which only those shapes moved, is bound to the nearest tail bone), the loose
  embers and the maw glow.
- **Body** (`src/render/creatures/pyrefang_visual.ts`): the hide's lava glows
  from the texture's red excess, `max(0, (r - b - 0.18) * 9)`, as the Codex
  material lit it; the flames flicker in a shader of their own; embers rise from
  the back and the tail. A creature seen as it rises plays Emerge, then Roar,
  then its idle (the age comes from the ring clock's `roseAt`). It walks when
  the sim moves it, its walk timed to its ground speed; its bite is stretched so
  the jaws close when the sim's hit lands; on its death it plays the fall before
  the body fades. It stands about sixteen units nose to tail; the sim's body
  (radius, reach) is unchanged.
- **Fire column** (`src/render/pyrefang_rise.ts` for the timing and geometry,
  tested in `tests/pyrefang_rise.test.ts`, and `src/render/vfx/pyrefang_rise_fx.ts`
  for the meshes and the vein shader) is the Codex column ported to three.js,
  centred on the ring and stretched so its crown follows the platform's rim
  (`RingSite.r`), less taller than wider. The Ascendant gets the same fire.
- **Lab**: with the Vite client running (`pnpm dev`), open
  `http://localhost:5173/pyrefang.html`. Keys 1 to 4 raise the Pyrefang again,
  send Korrath to fight it, finish it, or raise the Ascendant.

## Rebuilding the source

From the repository root, with Blender 5; the expected source is
`art_src/models_raw/pyrefang/pyrefang_segmented.blend`.

```powershell
blender -b --factory-startup --python scripts/build_pyrefang_codex.py -- --build --render
blender -b --factory-startup --python scripts/validate_pyrefang_codex.py
```

The first builds the Codex blend and renders every clip's frames, the second
must print
`CODEX_VALIDATION PASS`: finite values, lengths, splices onto the idle's first
pose, loops, ground contacts within a millimetre, the bite at 0.55 s, a still
body after 2.7 s of death, tail joint angles under 70 degrees, action names
limited to `Codex_*` and `CodexFX_*`. `--build` alone rebuilds the file;
`--render --clip Attack` renders one clip again. The generator never writes the
source file: it checks the source's SHA-256 before and after and records it in
`codex/build_report.json`.

# Sound

Two layers make the game's sound.

**Synthesis** (`src/game/sfx.ts`, `src/game/music.ts`): every sound has a
procedural version over WebAudio, built from enveloped oscillators and
filtered noise on one shared bus (compressor, reverb send). It needs no
asset, plays from the first frame, and covers the interface (buy, deny,
ping, level up, kill, victory) and every sound the bank has no recording
for.

**The recorded bank** (`src/game/sfx_bank.ts`, `public/sfx/`): the combat
sounds and the spell palette play short recordings once the bank has
decoded (it starts decoding when the Forge editor opens or a match
loads; the synthesis covers the seconds before). Playtest, 2026-09-02:
the synthesized palette read as cheap next to the rest of the game; real
recordings do not. The bank is data-as-code: the manifest lists, per
sound id, its variant files, and `tests/sfx_bank.test.ts` keeps the
manifest, the files on disk, the palette coverage and the size budget in
step.

## Ids

- Basic attacks, the `SfxName` the renderer plays and the attack palette a
  forged creator picks from (`src/sim/content/sounds.ts`): `swing`,
  `blade`, `heavy`, `bow`, `bolt`, `gunshot`.
- Casts, keyed `cast_<school>` over the cast palette: `arcane`, `steel`,
  `fire`, `life`, `control`, `wind`, `frost`, `shadow`, `thunder`; plus
  `cast`, the shared whoosh of sigils.
- Combat: `hit` (a body thud), `impact` (your damage landing), `towershot`.

Several variants per id; the player picks one at random with a touch of
pitch jitter, so rapid fire never reads as one looped sample.

## Building the bank

`scripts/build_sfx.mjs` renders `public/sfx/*.ogg` from the source packs
listed in `public/sfx/CREDITS.md`, all published under CC0 (a public
domain dedication, so nothing here is borrowed IP in the sense of ADR
0004: the recordings are free for any use and the rendered sounds are
the game's own layering of them). Point `SFX_SRC` at a directory holding
the packs unpacked under these names:

| Directory | Pack |
|---|---|
| `kenney_impact-sounds/Audio` | Kenney, Impact Sounds |
| `kenney_rpg-audio/Audio` | Kenney, RPG Audio |
| `kenney_sci-fi-sounds/Audio` | Kenney, Sci-Fi Sounds |
| `kenney_digital-audio/Audio` | Kenney, Digital Audio |
| `rpg80` | rubberduck, 80 CC0 RPG SFX |
| `sfx100` | rubberduck, 100 CC0 SFX #2 |
| `swishes/swishes` | artisticdude, Swishes Sound Pack |
| `freeze.wav` | artisticdude, Freeze Spell |
| `rpg_sound_pack/RPG Sound Pack` | artisticdude, RPG Sound Pack |
| `sword_starninjas`, `sword_clash_starninjas` | starninjas, 20 Sword Sound Effects |
| `tinysized/sfx-cc0` | vehicle, Fantasy Sound Effects (tinysized) |
| `curemagic` | someoneman, Cure Magic |
| `magical_1.ogg` to `magical_7.ogg` | jaggedstone, Magic Spell SFX |
| `powerdrain.ogg` | qubodup, Energy Drain |
| `whoosh2_0.wav` | pyranostudios, Air whoosh |
| `pistol22.wav`, `magnum22.wav` | kurt, Gunshots |
| `gunsounds/sounds` | tabasco, Gunshot Sounds |

Then:

```
SFX_SRC=<dir> node scripts/build_sfx.mjs [--only <id>] [--list]
```

Each recipe in the script is a list of layers (a recording, trimmed,
pitched, filtered, delayed and gained) mixed through ffmpeg, a
convolution reverb from a synthesized impulse response on top, then RMS
normalization capped by the peak, and a limiter, encoded to mono Ogg
Vorbis. Recipes are the sound design: a heavy attack is a slowed swish,
a wood impact 90 ms later and a sub thump under it; frost is the freeze
recording with glass on the attack; thunder is a crunch, the roll of a
real thunder clap and a low explosion.

The bank ships as Ogg Vorbis; a browser that cannot decode it (Safari)
plays the synthesis.

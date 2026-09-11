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

**The announcer** (`src/game/announcer.ts`, `public/voice/`): the event
lines (first blood, a tower falling, the Warden waking, victory) are
recorded clips of one voice, rendered from the table in
`src/game/voice_lines.ts`; the browser's speech synthesis reads the same
text while a clip has not decoded. See "The announcer" below.

## Ids

The palette is `src/sim/content/sounds.ts`, data-as-code, listed by group
in the Forge editor. Playtest, 2026-09-02: nine cast sounds were far too
few for a MOBA's worth of spells, so the palette grew to fifty-five
casts in six groups (Elements, Arcane, Light and nature, Shadow, Steel
and body, Tech) and twenty basic attacks in two (Melee, Ranged). Every
pick carries a family, one of the nine school sounds for a cast (`arcane`,
`steel`, `fire`, `life`, `control`, `wind`, `frost`, `shadow`, `thunder`)
and one of the six original attacks for an attack (`swing`, `blade`,
`heavy`, `bow`, `bolt`, `gunshot`): the family is what the synthesis
plays for the pick while the bank has no recording of it.

- Basic attacks are keyed by their id, the `SfxName` the renderer plays.
- Casts are keyed `cast_<id>`; plus `cast`, the shared whoosh of sigils.
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
| `blackpowder.wav` | kurt, Gunshots (the black-powder shot) |
| `earth_spell.flac`, `sand_spell.flac`, `ghostbreath.flac` | qubodup, Earth element magic spell, Sand spell, Ghost breath |
| `fantasy_magic_button_1.mp3` | Almitory, Fantasy magic spell |
| `icespells` | bart, Ice spells |
| `teleport.wav` | Ogrebane, Teleport Spell |
| `flame_0.ogg` | themightyglider, Catching fire |
| `flight_sound.mp3` | pauliuw, Flight or spell sound |
| `health_restore.wav`, `magic_words.wav` | Spring Spring, Magic Words + Healing Sound Effect |
| `gravity_inverter.ogg` | fvcalderan, Gravity Inverter |
| `ghostvoices/Ghost and Lich Voice Pack` | Sorth, Ghost Voice Pack |
| `randomsfx/SFX` | Ecrivain, Random SFX |

Then:

```
SFX_SRC=<dir> node scripts/build_sfx.mjs [--only <id>] [--list] [--manifest]
```

`--manifest` prints the bank manifest for `src/game/sfx_bank.ts` from the
recipes, one line per id with its variant count.

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

## The announcer

Every line the announcer says is fixed text in `src/game/voice_lines.ts`,
keyed by the event that says it: the voice never names a champion or a
player (playtest round 3: ten invented names read aloud is noise, and the
line runs long enough to still be talking over the next fight), so the
whole set is fifteen sentences, recorded once. `scripts/build_voice.mjs`
renders them with ElevenLabs text-to-speech, voice Lucy, into
`public/voice/<id>.mp3`:

    ELEVENLABS_API_KEY=<key> node scripts/build_voice.mjs [--only id] [--model id]

The key is read from the environment and from nowhere else; `--list`
prints the table without one. The clips are stored with git-lfs (a clone
made without it holds pointer files, which fail to decode and leave the
speech fallback in place; CI checks out with LFS). `tests/voice_bank.test.ts`
keeps the table, the files on disk, the script's view of the table, the
LFS tracking and the size budget in step.

At play time `src/game/voice_bank.ts` decodes the clips in the background
from the moment the audio bus exists, like the bank, and plays them dry
through the sound-effects gain (an announcer in a booth, not in the room).
`src/game/announcer_policy.ts` decides what gets said: the same wording
twice inside four seconds is a stutter and is dropped unless the caller
marks the line repeatable, a priority line (kills, objectives) interrupts
whatever is playing, an ordinary one waits for a breath. The music ducks
for the length of the clip.

## The multikill ladder

`src/ui/multikill.ts` counts every champion's run of kills and decides what
the game says about it. The numbers were measured over 240 bot matches
(15191 champion kills) rather than guessed, and the measurement is what
shaped them. The flat ten second window this replaces called a double kill
7.3 times a match, which is wallpaper and not an event; but no window short
enough to fix that leaves a pentakill reachable, because five enemies do not
die inside six seconds. So the leash widens as the chain climbs, 7 / 10 / 10
/ 30 seconds, which cuts doubles by a fifth while doubling the rate of the
rung nobody had ever heard. It is counted in sim seconds: the wall clock it
replaced miscounted whenever the tab throttled.

The ladder stops at five and restarts, because there is no word above it.
Dying ends your own chain. Double and triple are called to the killer alone
(seven a match shouted at ten people is unbearable); from the quadrakill up
the call reaches every client, which is the whole point of the rarest thing
the game says, and costs no extra recording because the lines never name a
side.

The voice climbs with the rung on both halves. In the recording:
`LINE_SETTINGS` in `scripts/build_voice.mjs` drops stability and raises
style for the two top lines, so they are performed rather than read. At play
time: the clip's gain rises, the pentakill opens the dry booth onto the
shared reverb, the music ducks deeper and longer, and a low impact
(`multikill` in `src/game/sfx.ts`) lands under the first syllable. Louder
alone reads as louder; the reverb and the hole in the music are what read as
bigger. The speech-synthesis fallback climbs too, through rate and pitch,
since synthesis caps volume at one.

Until their own recordings land, the quadrakill and the pentakill speak
through the `rampage` clip: the line table may not carry a line without a
file on disk (`tests/voice_bank.test.ts`), and the files are rendered from
that same table. The screen already says the right word.

## Lines pending their clips

The rings (ADR 0022) added four lines, "The Pyrefang has risen!", "The
Voidmaul has risen!", "Your team has claimed a favor!" and "The enemy has
claimed a favor", written before their clips: `PENDING_VOICE_LINES` in
`src/game/voice_lines.ts` names them, the speech synthesis reads them at
play time exactly as it reads any line whose clip has not decoded, and
`tests/voice_bank.test.ts` tolerates a missing clip for a pending line
only, while refusing a clip that has landed for a line still listed, so
the list empties as the clips are rendered:

    ELEVENLABS_API_KEY=<key> node scripts/build_voice.mjs --only pyrefang_risen

then the three others, then the ids come off the list in the same commit.

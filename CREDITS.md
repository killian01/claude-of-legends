# Asset credits and asset licenses

The repository's `LICENSE` covers the project's own source code. Everything
this repository ships without having written it is recorded here instead:
media assets, and the one directory of vendored files at the end. Every asset
under `public/` must have a row in this file before it ships (ADR 0004:
original naming, no third-party IP; CC0 packs are original art and satisfy it).

## Champion models (`public/models/champions/`)

Rigged, animated GLB characters. All CC0 1.0 (public domain): redistribute
freely, no attribution required (kept here out of courtesy and provenance).
The files were optimized (meshopt geometry, KTX2 textures) in the
world-of-claudecraft asset pipeline; optimization does not change the license
of CC0 source art.

| Files | Source pack | Author | License |
|---|---|---|---|
| `knight.glb`, `barbarian.glb`, `mage.glb`, `rogue_hooded.glb` | KayKit Character Pack: Adventurers (https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | Kay Lousberg (KayKit) | CC0 1.0 |
| `skeleton_rogue.glb` | KayKit Character Pack: Skeletons (https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | Kay Lousberg (KayKit) | CC0 1.0 |
| `ghost.glb`, `goblin.glb`, `glubevolved.glb`, `demonalt.glb`, `velociraptor.glb` | Quaternius animated creature packs (https://quaternius.com, https://poly.pizza/u/Quaternius) | Quaternius | CC0 1.0 |
| `vesk.glb`, `vesk_rifle.glb` | Generated with Meshy AI (https://meshy.ai) from original Vesk concept art, rigged and animated in the Meshy workspace | killian01 via Meshy AI | Per the Meshy plan's asset terms (CC BY 4.0 on the free plan) |
| `korrath.glb`, `korrath_shield.glb`, `korrath_maul.glb` | Generated with Meshy AI (https://meshy.ai) from original Korrath concept art (docs/design/portrait-prompts.md), rigged and animated in the Meshy workspace; combat clips re-baked in place (horizontal hip travel removed) and the weapon GLBs re-authored in Blender with the grip at the origin | killian01 via Meshy AI | Per the Meshy plan's asset terms (CC BY 4.0 on the free plan) |

## Champion splash art (`public/portraits/`)

Card illustrations for the champion select screen; the resolution chain
falls back to the in-engine cinematic render when a file is missing
(docs/design/portrait-prompts.md).

| Files | Source | License |
|---|---|---|
| `vesk.webp` | Generated with Google Gemini from original Vesk concept art | Google Gemini output terms |
| `korrath.webp` | Generated with Google Gemini from the Korrath prompt in docs/design/portrait-prompts.md | Google Gemini output terms |
| `dain.webp`, `sylra.webp`, `fenn.webp`, `elowen.webp`, `ashvyn.webp`, `maera.webp`, `torv.webp`, `rhoka.webp` | Generated with Google Gemini from the prompts in docs/design/portrait-prompts.md | Google Gemini output terms |

## Tier emblems (`public/icons/tiers/`)

The five tier emblems of the ladder (docs/design/ladder.md), one per tier,
generated from the prompts in docs/design/tier-emblem-prompts.md; the
sources stay in `art_src/tiers/`, the black background keyed out at
conversion.

| Files | Source | License |
|---|---|---|
| `recruit.webp`, `regular.webp`, `veteran.webp`, `elite.webp`, `legend.webp` | Generated with Google Gemini from the prompts in docs/design/tier-emblem-prompts.md | Google Gemini output terms |

### Play tile art (`public/art/tiles/`)

The five painted scenes behind the home's play tiles (CONTEXT.md: Home),
one per tile, generated from the prompts in `scripts/tile_art.mjs` and
described in docs/design/tile-art-prompts.md; the sources stay in
`art_src/tiles/`.

| Files | Source | License |
|---|---|---|
| `ranked.webp`, `bots.webp`, `forge.webp`, `lobby.webp`, `practice.webp` | Generated with the Tripo advanced image task (model `gpt_image_2`) from the prompts in `scripts/tile_art.mjs` | Tripo output terms |

## Logo (`public/icon-*.png`, `public/apple-touch-icon.png`, `public/logo.webp`)

The mark is a broken gold C closing around a watchtower under a starfield,
with a four point star in the gap. It comes in two pieces: the crest alone,
which is what the browser tab, the landing bar and a phone's home screen
want, and the full lockup, the same crest over the CLAUDE OF LEGENDS
wordmark, which is the signature the README wears.

Both arrive cut out, so `node scripts/site_icon.mjs` only trims each to its
art, squares the crest and writes the sizes. It repairs two things on the
way: the generator's opaque is alpha 250 to 254 rather than 255, which
leaves the art faintly see through, and the lockup ships inside a wide soft
black glow that reads as a drop shadow here but as a smudge on a light
README, so its alpha ramp is remapped away. The tab sizes are packed into
one `favicon.ico`, three of them, so a browser picks a size rather than
downsampling to it. The sources stay in `art_src/logo/` (ignored, like the
other raw art).

| Files | Source | License |
|---|---|---|
| `favicon.ico`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `logo.webp` | Generated with ChatGPT (OpenAI image generation), cut by `scripts/site_icon.mjs` | OpenAI output terms |

## Painted ability, item and sigil icons (`public/icons/`)

The 67 paintings that beat the procedural icon painter: every ability
except Maera's ultimate and Rhoka's four, all 28 items, all four sigils.
They follow the art contract in docs/design/icon-art-style.md, whose
subject lines come from our own kit and item records (ADR 0004). The
generators hand back 512px PNG; what ships is the WebP conversion from
`scripts/convert_art.mjs`, and the PNG sources stay in `art_src/`.

| Files | Source | License |
|---|---|---|
| `abilities/*.webp`, `items/*.webp`, `sigils/*.webp` | Generated with Google Gemini or OpenAI's image model from the prompts built per docs/design/icon-art-style.md | Google Gemini or OpenAI output terms |

## Home backdrop (`public/art/home_end.jpg`)

The still the home screen holds on: the sharpened final frame of the
generated cinematic that plays once per page load.

| Files | Source | License |
|---|---|---|
| `home_end.jpg` | Generated with Google Gemini or OpenAI's image model, sharpened to 1080p | Google Gemini or OpenAI output terms |

## The preview mannequin (`public/models/mannequin/`)

One neutral gray biped with the Forge's whole animation catalog baked onto
it as geometry-free clip files, so the editor can preview any preset
instantly and for free. Generated, rigged and baked once by
`scripts/forge_mannequin.mjs`, which is the only thing in the repo that
ever pays Tripo for a preview.

| Files | Source | License |
|---|---|---|
| `mannequin.glb`, `mannequin.json`, `reference.png`, `clips/*.glb` | Generated and rigged with Tripo (https://tripo3d.ai) by `scripts/forge_mannequin.mjs`, animation presets baked in place | Tripo output terms (paid tier) |

## The recorded sound bank (`public/sfx/`)

Rendered by `scripts/build_sfx.mjs` from recordings published under CC0:
layered, trimmed, pitched, filtered and mixed into the game's own sounds,
so what ships is a derivative and not a repackaged pack.
`public/sfx/CREDITS.md` names every source pack and its recordist, and
docs/design/sound.md says which game sound each one feeds. CC0 asks for no
attribution; the list is kept out of respect for the recordists.

| Files | Source | License |
|---|---|---|
| `*.ogg` | CC0 packs from Kenney, rubberduck, artisticdude and others, mixed by `scripts/build_sfx.mjs`; the full list is `public/sfx/CREDITS.md` | CC0 1.0 |

## Vendor runtime files (`public/vendor/`)

| Files | What it is | License |
|---|---|---|
| `basis/basis_transcoder.js`, `basis/basis_transcoder.wasm` | Basis Universal transcoder shipped with three.js (`three/examples/jsm/libs/basis/`), needed to decode the KTX2 textures inside the champion GLBs | Apache 2.0 (Binomial LLC / Google) |

## Vendored agent skills (`.claude/skills/`)

Not assets, but the same rule: files this repository ships without having
written them.

| Files | What it is | License |
|---|---|---|
| `domain-modeling/`, `grill-with-docs/`, `grilling/`, `prototype/`, `research/`, `setup-matt-pocock-skills/`, `wayfinder/` | Unmodified copies of Matt Pocock's skills from [`mattpocock/skills`](https://github.com/mattpocock/skills), checked in so a fresh clone gets the same agent setup; the provenance table is `.claude/skills/README.md` | MIT (Matt Pocock), notice at `.claude/skills/LICENSE` |

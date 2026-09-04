# Asset credits and asset licenses

The repository's `LICENSE` covers the project's source code. Media assets are
governed by the licenses recorded here; every asset under `public/` must have
a row in this file before it ships (ADR 0004: original naming, no third-party
IP; CC0 packs are original art and satisfy it).

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

## Vendor runtime files (`public/vendor/`)

| Files | What it is | License |
|---|---|---|
| `basis/basis_transcoder.js`, `basis/basis_transcoder.wasm` | Basis Universal transcoder shipped with three.js (`three/examples/jsm/libs/basis/`), needed to decode the KTX2 textures inside the champion GLBs | Apache 2.0 (Binomial LLC / Google) |

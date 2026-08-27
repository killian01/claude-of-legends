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

## Vendor runtime files (`public/vendor/`)

| Files | What it is | License |
|---|---|---|
| `basis/basis_transcoder.js`, `basis/basis_transcoder.wasm` | Basis Universal transcoder shipped with three.js (`three/examples/jsm/libs/basis/`), needed to decode the KTX2 textures inside the champion GLBs | Apache 2.0 (Binomial LLC / Google) |

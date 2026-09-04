# Play tile art: generation prompts

The home's play tiles (CONTEXT.md: Home) each wear a painted scene of
their own. A tile has to say what its mode IS, which a champion portrait
cannot do: a champion standing in a tile only says which champion. The
client loads `public/art/tiles/<id>.webp` when the file exists and falls
back to the tile's accent wash otherwise (`src/ui/play_tiles.ts`), the
same way the tier emblem falls back to its CSS banner. Drop a file in,
refresh, done.

- Five files, named after the tile id: `ranked`, `bots`, `forge`,
  `lobby`, `practice`. The sources land in `art_src/tiles/` (ignored, like
  the other raw art) and `node scripts/tile_art.mjs` writes the WebP into
  `public/art/tiles/`; commit those.
- The model answers a square 1024x1024 whatever ratio the prompt asks
  for, and the tiles are cropped with `object-fit: cover` at three
  different shapes, so every scene must survive a crop: keep the subject
  centered, leave headroom, and put nothing that matters in a corner.
  Ranked is landscape (about 4:3), Bots and the Forge queue stand at the
  same height beside it and crop portrait (about 3:4), and the last two
  are near square. The ratio in each prompt is a composition hint to the
  model, not a promise about the file.
- The bottom third of every tile is dimmed by the title scrim, so it
  carries atmosphere, never the subject.
- No text, no numerals, no logos, no watermark, no border inside the
  image, and no user interface drawn in the scene.
- Original naming (ADR 0004): the scenes belong to this world, nothing
  borrowed. The prompts deliberately do not name the game.
- When images land, record them in `CREDITS.md` (generator, prompt
  source, license terms of the tool used), the same way the portraits and
  the emblems are recorded. Do not commit images whose tool terms forbid
  redistribution.

## Shared style block

Every prompt is the style block followed by the tile's scene line, so the
five read as one set. It is the `STYLE` constant in
`scripts/tile_art.mjs`, which is the one place the prompts live:

> Stylized painted fantasy game key art, painterly brushwork, dramatic
> rim light, dark moody palette with one dominant accent color as
> atmospheric glow, deep depth of field, cinematic composition, high
> contrast, no text, no watermark, no user interface.

## The five scenes

The scene lines are the `TILES` table in `scripts/tile_art.mjs`. In short:

| File | What it shows | Accent |
|---|---|---|
| `ranked.webp` | Two teams of five meeting at a bridge over a moonlit river, banners raised, a tower silhouette on each side | Gold |
| `bots.webp` | A war table of glowing rune-script pages writing themselves beside an armored construct at attention, a coach's empty chair | Blue |
| `forge.webp` | An anvil under a floating arcane blueprint, a half-formed champion rising out of the light | Ember |
| `lobby.webp` | A small circle of adventurers around a lantern, one holding up a glowing rune token | Violet |
| `practice.webp` | A training yard of straw and timber dummies at dusk, scarred posts, no people | Green |

## Running it

Spends real Tripo credits, so it runs only with the maintainer's go-ahead:

```
node --env-file=.env scripts/tile_art.mjs            # every missing file
node --env-file=.env scripts/tile_art.mjs ranked     # one tile
node --env-file=.env scripts/tile_art.mjs --force    # regenerate all
```

It prints the credit balance before and after, and the task id behind
each image, which is the provenance ADR 0010 asks generated assets to
carry.

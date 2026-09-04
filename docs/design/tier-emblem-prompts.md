# Tier emblems: generation prompts

The tier emblem (CONTEXT.md: Emblem) is one image per tier, the same
everywhere a tier shows: the ladder page, the account's place on the home
card, and later the lobby and the scoreboard. The client loads
`public/icons/tiers/<tier>.webp` when the file exists and draws a CSS
banner in the tier's color otherwise (`src/ui/tier_emblem.ts`). Drop a file
in, refresh, done.

- One file per tier, named after it in lower case: `recruit`, `regular`,
  `veteran`, `elite`, `legend`. PNG from the generator, then
  `node scripts/convert_art.mjs` re-encodes everything under `public/icons`
  to WebP (the PNG sources stay in `art_src/`, like the spell icons).
- Square, at least 512x512, transparent or plain dark background. The
  emblem is drawn at 18 px beside a name and at 96 px on the page, so the
  silhouette must survive both: one bold banner shape, one motif, no fine
  detail that only reads large.
- No text, no numerals, no logos, no watermark, no border inside the image.
- The names are original (ADR 0004): nothing borrowed from other games'
  metals or league crests. The motifs below belong to this world.
- When images land, record them in `CREDITS.md` (generator, prompt source,
  license terms of the tool used), the same way the portraits and icons are
  recorded. Do not commit images whose tool terms forbid redistribution.

## Shared style block

Append the tier line to this base prompt so the five emblems read as one
set:

> Stylized painted fantasy game emblem, a single hanging heraldic banner
> with a pointed lower edge, centered, front view, flat dark background,
> strong readable silhouette at small size, painterly brushwork with clean
> edges, subtle metallic highlights, no text, no numbers, no watermark.

The banner is the same in all five; what changes is what it carries and
what it is made of. Progression must be legible at a glance from left to
right.

## The five tiers

- **Recruit** (below the base rating): a bare banner of rough undyed
  cloth, dull brown, frayed lower edge, no device, a plain wooden crossbar.
- **Regular** (1000): the banner in iron grey, stitched with a single
  vertical lane mark, a straight pale line from top to point, a plain iron
  crossbar.
- **Veteran** (1100): the banner in deep bronze red carrying two crossed
  blades, short broad swords crossing at the center, a bronze crossbar with
  rounded finials.
- **Elite** (1200): the banner in gold cloth carrying a tower crown, a
  crenellated ring seen from the front, a gold crossbar with pointed finials.
- **Legend** (1300): the banner in radiant white gold carrying the Warden's
  horns, a pair of great curved horns rising from the center, a soft golden
  halo behind the banner, a gold crossbar crowned with a small flame.

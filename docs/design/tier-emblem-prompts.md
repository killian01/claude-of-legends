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
- Square, 1:1, 1024x1024 (set the ratio in the tool as well: a prompt alone
  is often ignored), transparent or flat pure black background. The
  emblem is drawn at 18 px beside a name and at 96 px on the page, so the
  silhouette must survive both: one bold shield shape, one motif, no fine
  detail that only reads large.
- No text, no numerals, no logos, no watermark, no border inside the image.
- The names are original (ADR 0004): nothing borrowed from other games'
  metals or league crests. The motifs below belong to this world.
- When images land, record them in `CREDITS.md` (generator, prompt source,
  license terms of the tool used), the same way the portraits and icons are
  recorded. Do not commit images whose tool terms forbid redistribution.

## Shared style block

Append the tier line to this base prompt so the five emblems read as one
set. The context comes first so the tool knows what the image is for; the
format and the background come last, where generators weigh them most.

> Context: a rank tier emblem for the ranked ladder of a browser 5v5
> fantasy MOBA with a dark painterly look, a gold on night blue interface.
> (The game is not named: a generator may balk at a name.) Five tiers form one set on the same shield silhouette,
> from lowest to highest: Recruit, Regular, Veteran, Elite, Legend. The
> emblem is shown beside a player name at 18 pixels and on the ladder page
> at 96 pixels, so it must read as one bold shape.
>
> Subject: a single rigid heraldic shield, flat top and pointed lower
> edge, front view, stylized painted fantasy game emblem, strong readable
> silhouette, painterly brushwork with crisp intact edges, subtle metallic
> highlights. No cloth, no fabric, no banner, no fraying, no tears, no
> rope, no pole.
>
> Format: square game icon, 1:1 aspect ratio, 1024x1024, one single object
> centered with even margins, filling about eighty percent of the frame
> height. Background: flat, solid, pure black, nothing else in the frame,
> no scene, no landscape, no floor, no shadow on the ground. No text, no
> numbers, no watermark, no border.

The pure black is keyed out at conversion (ffmpeg colorkey) so the emblem
sits on the page with no square behind it; a true transparent PNG is
better still when the tool can make one.

The shield is the same in all five; what changes is what it carries and
what it is made of. Progression must be legible at a glance from left to
right.

## The five tiers

- **Recruit** (below the base rating): a bare shield of rough dark wood,
  dull brown, plain iron rim, no device.
- **Regular** (1000): the shield in iron grey, a single vertical lane
  mark, a straight pale line from top to point, a plain iron rim.
- **Veteran** (1100): the shield in deep bronze red carrying two crossed
  blades, short broad swords crossing at the center, a bronze rim with
  rounded studs.
- **Elite** (1200): the shield in polished gold carrying a tower crown, a
  crenellated ring seen from the front, a gold rim with pointed studs.
- **Legend** (1300): the shield in radiant white gold carrying the Warden's
  horns, a pair of great curved horns rising from the center, a soft golden
  halo tight around the shield, a gold rim crowned with a small flame.

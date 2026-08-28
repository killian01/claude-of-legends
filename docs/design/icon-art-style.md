# Icon art style

Status: canonical. Applies to every painted ability and item icon under `public/icons/`.

The short form:

> Hand-painted dark-fantasy MOBA icon art; one centered, complete subject; warm key light from
> the top left, deep cool shadow to the bottom right; opaque painted ground in the school's
> palette; no text, no frame, no border, no watermark, no transparency.

The goal is one coherent icon catalog that reads at 48 px on the HUD bar, not a collection of
mismatched source styles. Hotkey badges, cooldown sweeps, rank pips, and tier borders belong to
the UI and must never be painted into the asset.

## Pipeline

- Ability paintings ship at `public/icons/abilities/<championId>_<KEY>.png` (square, 512 px or
  larger). Item paintings ship at `public/icons/items/<itemId>.png`.
- `src/ui/icon_images.ts` lists every shipped painting as data-as-code; an id not listed falls
  back to the procedural canvas painter, so coverage never breaks while art lands incrementally
  (the woc declining-claim pattern, both tracks proven there: purchased premium packs for
  spells, style-contracted paintings for items).
- Generation prompts are built as: the shared style directive below, then the per-icon subject
  line derived from the ability or item record. Original art only (ADR 0004): subjects come
  from OUR kit and item data, never from another game's iconography.

## Shared style directive

Every prompt starts with this block, verbatim:

> Hand-painted fantasy game ability icon, square 1:1, classic MMORPG painted style, rich
> saturated colors, dramatic warm key light from the upper left, deep cool shadows lower
> right, opaque dark painted background with subtle atmosphere, one centered subject filling
> about 70 percent of the frame, crisp focal edges and painterly brushwork, no text, no
> letters, no numbers, no runes, no watermark, no signature, no frame, no border, no UI
> elements, no transparency.

For items, replace "ability icon" with "inventory item icon".

## Visual grammar

- One subject per icon: the ability's signature moment (the slam, the wall rising, the comet),
  or the item itself, complete and centered with safe padding on all sides.
- The silhouette must survive 48 px and a desaturated glance: the HUD bar is read in
  peripheral vision under pressure.
- Palette follows the champion's school: Korrath and Torv earth and stone ochres, Dain ember
  oranges, Sylra verdant greens, Fenn shadow violets, Elowen frost blues, Vesk gunmetal and
  gold, Ashvyn dusk purples, Maera sea teals, Rhoka blood reds. Items follow their category:
  attack reds and steels, spellpower violets, armor golds, resist blues, health greens, speed
  teals.
- Ultimates read heavier than basics: broader light, bigger consequence in frame; the UI adds
  no extra marker, the painting itself must carry the weight.
- Magical light supports the subject; it never floods the square or replaces the silhouette.
- No borrowed iconography (ADR 0004): the subject is drawn from our own ability text and item
  names, and two different icons must never share a composition.
- Each subject line pins its own composition explicitly: viewpoint, framing, and subject count
  ("low side view", "top-down", "strict profile", "front-facing symmetric pair"). Generators
  collapse similar nouns into one picture; kin subjects within a kit (a fist ability and a
  fist ultimate, two earth spells) MUST be given opposing viewpoints or framings.

## Per-icon subject lines

The subject line for each ability comes from its kit entry in `docs/design/kits-v2.md` (the
signature moment, one sentence, concrete nouns); for each item from its name and stats. The
working manifest of prompts lives with the generation batch, not in this contract.

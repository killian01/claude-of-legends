# Champion splash art: generation prompts

The champion select screen loads an illustration from
`public/portraits/<championId>.png` when the file exists, and falls back to
the in-engine cinematic 3D render otherwise. Drop a file in, refresh, done.

- One file per champion, PNG (or WebP renamed to .png works in every
  browser we target), portrait orientation, at least 600x800. The card crops
  with `object-fit: cover`, so keep the character centered and leave
  headroom; the bottom fifth is dimmed by the name scrim.
- No text, no logos, no watermarks, no borders inside the image.
- When images land, record them in `CREDITS.md` (generator, prompt source,
  license terms of the tool used), the same way world-of-claudecraft records
  its generated art. Do not commit images whose tool terms forbid
  redistribution.

## Shared style block

Append the champion line to this base prompt so the ten cards read as one
set:

> Stylized painted fantasy splash art portrait, 3:4, bold readable
> silhouette, dramatic rim light, dark moody backdrop with one dominant
> accent color as atmospheric glow, painterly brushwork, high contrast,
> game character card art, no text, no watermark.

## The ten champions

| File | Prompt line |
|---|---|
| `korrath.png` | Korrath the Bulwark: a human knight in heavy grey plate armor, massive hexagonal tower shield raised forward, sword held low, steel-blue atmosphere, immovable stance. |
| `dain.png` | Dain Emberfist: a bald bearded human brawler, bare chest, fists and forearms glowing with molten ember cracks, orange fire atmosphere, mid-punch. |
| `sylra.png` | Sylra Thornweaver: a moss-green witch under a wide pointed hat, thorned wooden staff with a glowing green seed, vines and brambles curling around her, verdant atmosphere. |
| `fenn.png` | Fenn the Quickblade: a slight hooded assassin wrapped in a deep green cloak, twin violet daggers reversed in both hands, purple dusk atmosphere, coiled to strike. |
| `elowen.png` | Elowen Mistward: a translucent pale-blue ghost spirit with pointed ears, drifting above the ground, wisps of mist trailing, cold white-blue atmosphere. |
| `vesk.png` | Vesk the Longshot: a small green goblin artillerist hauling a brass long rifle far taller than himself over one shoulder, golden atmosphere, cocky grin. |
| `ashvyn.png` | Ashvyn Nightbow: an undead skeleton archer in a violet hood and cape, glowing pale eyes, drawing a curved dark bow, indigo night atmosphere. |
| `maera.png` | Maera Tidecaller: a small teal water spirit with fin wings, riding a rising wave, droplets suspended around her, seafoam turquoise atmosphere. |
| `torv.png` | Torv Stonehorn: a towering stone-grey horned colossus with small bat wings and a broken dark halo, fists like boulders, granite atmosphere, protective bulk. |
| `rhoka.png` | Rhoka Wildclaw: a russet-brown raptor beast mid-pounce, claws extended, feather-scaled crest, crimson atmosphere, feral motion. |

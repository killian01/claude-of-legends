# Making a clip

An announcement is a clip. The link is what people click after they have
already decided, from something moving, that this is worth a click, and a
MOBA will not hand you thirty good seconds on request: most of a match is
walking. This is how to find the thirty seconds that are not.

The sim is deterministic (ADR 0001), so a seed is a fight. Find the seed
once, on any machine, and it is the same fight on the machine you film it
on.

## 1. Find the fight

```
node scripts/clip_seed.mjs --seeds 24 --minutes 15
```

Twenty-four matches of ten bots play out headless through the real `Match`
code, and every tick is scored for how it would read to a stranger who has
never seen this game: deaths first, then structures falling, then the
Warden, then casts, and a small bonus for champions from both teams being
in one place (`scripts/clip_window.ts`). It prints the best thirty second
window in each, and saves the winner as a replay:

```
top five:
  seed 12  film from 13:40  score 611  7 things die in shot
...
saved replay 7 from seed 12
Film from 13:40. REPLAY_ID=7 REPLAY_AT=820
```

Read the "things die in shot" column, not just the score. A window with
nothing dying in it is a crowd, not a fight, and no weighting is a
substitute for looking.

`--seeds` and `--from` move the search, `--minutes` how long a match is
played before giving up on it, `--window` the length of the clip in
seconds, `--replay-id` the file written under `DATA_DIR/replays/`.

## 2. Open it

Run the stack (`pnpm server` in one terminal, `pnpm dev` in another), sign
in with any account, and in the browser console:

```js
window.dispatchEvent(new CustomEvent('loc:replay', { detail: 7 }));
```

The replay viewer opens with a speed control. Skip forward at 4x, drop back
to 1x a few seconds before the window, and close the shop panel.

## 3. Film it

**On a machine with a real GPU.** The renderer falls back to software
rasterisation on a headless server and gives eight frames a second, which
is worse than no clip. Record the browser window with whatever the desktop
provides.

The frame to aim for is the first one, because it is the only one most
people see: five champions, a lane, and the minimap in the corner, so that
someone scrolling knows what this is before deciding whether to keep
looking. Twenty to thirty seconds, and it has to work with the sound off.

For a rough preview without leaving the server, `scripts/shot_replay.mjs`
drives the same viewer over CDP and writes frames:

```
REPLAY_ID=7 REPLAY_AT=820 REPLAY_FOR=30 node scripts/shot_replay.mjs
ffmpeg -framerate 8.33 -i docs/screenshots/frame-%04d.jpg \
  -vf scale=720:-2 -vcodec libwebp_anim -q:v 72 -loop 0 \
  -preset picture docs/screenshots/clip.webp
```

That is for judging whether the fight is the right one. It is not the clip.

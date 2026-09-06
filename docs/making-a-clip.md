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

## The tour, not just the fight

One fight says the game exists. It does not say what it is, and what it is
is the reason a developer clicks: ten champions with full kits, a Forge
that builds an eleventh, an Academy where a bot is written rather than
coded. `scripts/tour_clips.mjs` films a short passage of each, in action.

```
GENERATION_PROVIDER=mock node dist-server/server.cjs
pnpm dev --port 5199
TOUR_URL=http://localhost:5199 TOUR_DIR=tour node scripts/tour_clips.mjs
```

The server takes no keys on purpose: `mock` walks the whole Forge pipeline
with real placeholder assets and no vendor, and with no `ANTHROPIC_API_KEY`
the coach and the kit conversations are off. A tour that costs money is a
tour nobody films twice.

Two things that are learned the hard way and are worth keeping in mind when
adding a scene. Every scene has to MOVE while it records: the screencast
emits a frame only when something repaints, so the first pass of the home
screen produced one frame for seven seconds. And a panel's selectors have
to be scoped to that panel, because the home screen stays in the DOM
underneath every surface: the first Academy scene typed the bot's name into
the home's join-code field and filmed a form that never filled.

Surfaces filmed on a fresh data dir are empty ones. The gallery and the
ladder need production data to say anything, so they are filmed and then
usually cut.

## The 3D passages, on a server with no GPU

The workshop and the match are the two passages that show three dimensions,
and they are the two a server cannot film. Measured here, on the workshop:

| | frames in 20s |
|---|---|
| SwiftShader, 1280x720 | 13 |
| ANGLE Vulkan (llvmpipe), 1280x720 | 25 |
| ANGLE Vulkan, 800x450 | 26 |

So `TOUR_GL` defaults to `vulkan`, which is free and doubles it, and
`TOUR_SIZE` is for framing rather than for speed: a software rasteriser
running a rigged character spends its time on skinning, not on pixels, and
shrinking the window buys nothing.

Even doubled it is 1.2 frames a second, which is why the montage decides
per passage from the rate it measures: above 20 it plays the frames, from 8
to 20 it interpolates the motion between them, and below 8 it holds the
scene's screenshot and pushes in slowly. Two frames a second do not become
a video; they become a fault the viewer blames on the game.

Film those two somewhere with a GPU. Refilm the scene and the montage picks
the frames up on its own, because the rule is on the measured rate and
nothing has to be edited.

## Assembling it

`scripts/tour_montage.mjs` cuts what was filmed into something postable: a
title card off `public/social-card.jpg` so the clip and the link preview
open on the same image, one labelled passage per surface, cross fades, and
an end card. Drop your own recording of a fight at `tour/fight.mp4` and it
takes the place of the one filmed here.

```
node scripts/tour_montage.mjs tour tour-montage.mp4
```

The lengths, the starts and the labels are the table at the top of that
file, and the labels are English because the announcement is read where the
developers are. Two ffmpeg details worth not rediscovering: inside
`drawbox`, `h` is the box's own height and not the frame's (`ih` is the
frame), and a label dropped straight onto a screen full of interface makes
both unreadable, so a gradient goes under it.

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

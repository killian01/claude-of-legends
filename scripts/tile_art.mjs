// Paints the home's five play tiles (docs/design/tile-art-prompts.md).
//
// One-shot tool, not a build step. Spends real Tripo credits; run it only
// with the maintainer's explicit go-ahead:
//   node --env-file=.env scripts/tile_art.mjs            every missing file
//   node --env-file=.env scripts/tile_art.mjs ranked     one tile
//   node --env-file=.env scripts/tile_art.mjs --force    regenerate all
//
// The PNG sources stay in art_src/tiles/ (ignored, like the other raw
// art); the committed WebP goes to public/art/tiles/. Prompts live here
// rather than in the doc because this script is what consumes them; the
// doc describes the style, the crop and the credit duty.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TASK_URL = 'https://api.tripo3d.ai/v2/openapi/task';
const BALANCE_URL = 'https://api.tripo3d.ai/v2/openapi/user/balance';
// The same image model the server's provider defaults to (tripo.ts), so
// the tiles are painted by what every other 2D generation here uses.
const IMAGE_MODEL = process.env.TRIPO_IMAGE_MODEL || 'gpt_image_2';
const SRC_DIR = 'art_src/tiles';
const OUT_DIR = 'public/art/tiles';

const STYLE =
  'Stylized painted fantasy game key art, painterly brushwork, dramatic rim light, ' +
  'dark moody palette with one dominant accent color as atmospheric glow, deep depth ' +
  'of field, cinematic composition, high contrast, no text, no watermark, ' +
  'no user interface.';

// Nothing in a corner and nothing that matters low: the tiles crop with
// object-fit cover at three different shapes and dim their bottom third.
export const TILES = [
  {
    id: 'ranked',
    ratio: 'landscape 4:3',
    scene:
      'Two opposing teams of five armored fantasy champions meeting at the middle of a ' +
      'wide stone bridge over a moonlit river, seen from a low heroic angle, war banners ' +
      'raised on both sides, a tall fortress tower silhouetted behind each team, sparks ' +
      'and dust in the air between them, warm gold accent glow against a deep blue night, ' +
      'the moment before the clash.',
  },
  {
    id: 'bots',
    ratio: 'wide banner 3:1',
    scene:
      'A dim strategy war room: a long stone table covered in floating pages of glowing ' +
      'blue rune script that are writing themselves, a tall armored humanoid construct ' +
      'with a softly lit core standing at attention beside the table awaiting orders, an ' +
      'empty high-backed coach chair facing it, chalked battle lines on a dark slate wall ' +
      'behind, cold blue accent glow.',
  },
  {
    id: 'forge',
    ratio: 'square 1:1',
    scene:
      'A blacksmith anvil on a dark stone floor beneath a floating arcane blueprint of a ' +
      'warrior drawn in lines of light, a half-formed champion figure rising out of the ' +
      'molten glow above the anvil, hammer and rune chisels resting nearby, orange ember ' +
      'accent glow, embers rising into darkness.',
  },
  {
    id: 'lobby',
    ratio: 'square 1:1',
    scene:
      'A small close circle of four fantasy adventurers gathered around a hanging lantern ' +
      'in a dark tavern corner, leaning in together, one of them holding up a small ' +
      'glowing violet rune token between two fingers for the others to see, warm violet ' +
      'accent glow, conspiratorial and friendly.',
  },
  {
    id: 'practice',
    ratio: 'square 1:1',
    scene:
      'A quiet training yard at dusk with a row of straw and timber practice dummies on ' +
      'scarred wooden posts, split shields and blunted weapons racked along a fence, ' +
      'no people anywhere, drifting straw dust, cool green accent glow.',
  },
];

const key = process.env.TRIPO_API_KEY;
if (!key) {
  console.error('TRIPO_API_KEY is not set. Run with --env-file=.env');
  process.exit(1);
}
const auth = { authorization: `Bearer ${key}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function balance() {
  try {
    const res = await fetch(BALANCE_URL, { headers: auth });
    if (!res.ok) return -1;
    const body = await res.json();
    return body.data?.balance ?? -1;
  } catch {
    return -1;
  }
}

async function submit(prompt) {
  const res = await fetch(TASK_URL, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'generate_image', model_version: IMAGE_MODEL, prompt }),
  });
  if (!res.ok) throw new Error(`submit refused: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const taskId = body.data?.task_id;
  if (!taskId) throw new Error('submit returned no task id');
  return taskId;
}

// The first http url in the output is the file, whatever Tripo named it.
async function awaitTask(taskId) {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    const res = await fetch(`${TASK_URL}/${taskId}`, { headers: auth });
    if (!res.ok) throw new Error(`poll refused: ${res.status}`);
    const body = await res.json();
    const status = body.data?.status ?? 'unknown';
    if (status === 'success') {
      const url = Object.values(body.data?.output ?? {}).find(
        (v) => typeof v === 'string' && v.startsWith('http'),
      );
      if (!url) throw new Error(`task ${taskId} succeeded with no file url`);
      return url;
    }
    if (status === 'failed' || status === 'cancelled' || status === 'banned') {
      throw new Error(`task ${taskId} ended ${status}`);
    }
    if (Date.now() >= deadline) throw new Error(`task ${taskId} timed out (${status})`);
    await sleep(3000);
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Quality 88 sits between the icons (90) and the portraits (85): a tile is
// large on screen but never read up close (scripts/convert_art.mjs).
function toWebp(src, dest) {
  const r = spawnSync('ffmpeg', ['-y', '-i', src, '-c:v', 'libwebp', '-quality', '88', dest], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${src}`);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const wanted = args.filter((a) => !a.startsWith('--'));
const todo = TILES.filter((t) => wanted.length === 0 || wanted.includes(t.id)).filter(
  (t) => force || !existsSync(path.join(OUT_DIR, `${t.id}.webp`)),
);
if (todo.length === 0) {
  console.log('nothing to paint (every wanted tile already has its file; --force to redo)');
  process.exit(0);
}
mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log(`model ${IMAGE_MODEL}, credits before: ${await balance()}`);
const provenance = [];
for (const tile of todo) {
  const prompt = `${STYLE} Aspect ratio ${tile.ratio}. ${tile.scene}`;
  console.log(`\n[${tile.id}] submitting`);
  const taskId = await submit(prompt);
  console.log(`[${tile.id}] task ${taskId}, waiting`);
  const url = await awaitTask(taskId);
  const src = path.join(SRC_DIR, `${tile.id}.png`);
  await download(url, src);
  toWebp(src, path.join(OUT_DIR, `${tile.id}.webp`));
  provenance.push({ id: tile.id, taskId });
  console.log(`[${tile.id}] done`);
}
console.log(`\ncredits after: ${await balance()}`);
console.log('provenance:', JSON.stringify(provenance));

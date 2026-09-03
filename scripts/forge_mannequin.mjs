// Builds the preview mannequin: one neutral gray biped, generated and
// rigged once, with the Forge's whole animation catalog baked onto it as
// geometry-free clip files. The editor previews any preset on it
// instantly and for free; only this script ever pays Tripo for previews.
//
// Ships under public/models/mannequin/ (committed, like the roster
// models): mannequin.glb (the rigged body), clips/<preset>.glb (one
// animation each, no geometry), and mannequin.json (the manifest the
// client reads, plus the task ids this script needs to resume).
//
// One-shot tool, not a build step. Spends real Tripo credits; run it only
// with the maintainer's explicit go-ahead, stage by stage:
//   node --env-file=.env scripts/forge_mannequin.mjs stage1
//     generate + rig the mannequin, bake ONE test clip (run), verify the
//     geometry-free clip file structurally. About 70 credits.
//   node --env-file=.env scripts/forge_mannequin.mjs clips all
//     bake every catalog preset still missing (batches of 5, the live
//     retarget task limit). About 10 credits per missing clip.
//   node --env-file=.env scripts/forge_mannequin.mjs clips a,b,c
//     bake specific preset ids.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const V3 = 'https://openapi.tripo3d.ai/v3';
const TASK_URL = 'https://api.tripo3d.ai/v2/openapi/task';
const IMAGE_MODEL = 'gpt_image_2';
const MODEL_VERSION = 'v3.1-20260211';
const RIG_MODEL = 'v1.0-20240301';
// One live retarget task carries at most 5 animations (tripo.ts).
const BATCH = 5;
const OUT_DIR = 'public/models/mannequin';
const MANIFEST = path.join(OUT_DIR, 'mannequin.json');

// The whole pickable catalog, deduplicated (fire serves attack and cast).
// Pinned equal to the server's TRIPO_CLIP_CHOICES by test; a new preset
// lands in both places or the test fails.
export const MANNEQUIN_PRESETS = [
  'preset:biped:idle',
  'preset:biped:standing_relax',
  'preset:biped:wait',
  'preset:biped:look_around',
  'preset:biped:fold_arms',
  'preset:biped:run',
  'preset:biped:walk',
  'preset:biped:swagger',
  'preset:biped:slash',
  'preset:biped:chop',
  'preset:biped:shoot',
  'preset:biped:fire',
  'preset:biped:box_01',
  'preset:biped:box_02',
  'preset:biped:box_03',
  'preset:biped:front_kick_01',
  'preset:biped:front_kick_02',
  'preset:biped:pitch_baseball',
  'preset:biped:cast_a_spell',
  'preset:biped:defeat_02',
  'preset:biped:defeat_03',
  'preset:biped:fall',
];

// The look: deliberately styleless so no preset ever reads as belonging
// to one champion archetype.
const MANNEQUIN_PROMPT =
  'A neutral light gray artist mannequin, matte plastic, smooth featureless ' +
  'head with no face, no clothes and no accessories, adult human proportions, ' +
  'standing upright in a T pose with arms straight out, full body, front view, ' +
  'centered, plain white background, soft studio lighting';

const key = process.env.TRIPO_API_KEY;

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} refused: ${res.status} ${await res.text()}`);
  const envelope = await res.json();
  const taskId = envelope.data?.task_id;
  if (!taskId) throw new Error(`${url} returned no task id`);
  return taskId;
}

async function awaitTask(taskId, pollBase = `${V3}/tasks`) {
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const res = await fetch(`${pollBase}/${taskId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`poll refused: ${res.status}`);
    const envelope = await res.json();
    const status = envelope.data?.status ?? 'unknown';
    if (status === 'success') {
      const url = Object.values(envelope.data?.output ?? {}).find(
        (v) => typeof v === 'string' && v.startsWith('http'),
      );
      if (!url) throw new Error(`task ${taskId} succeeded with no file url`);
      return url;
    }
    if (status === 'failed' || status === 'cancelled' || status === 'banned') {
      throw new Error(`task ${taskId} ended ${status}`);
    }
    if (Date.now() >= deadline) throw new Error(`task ${taskId} timed out (${status})`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  const kb = Math.round(readFileSync(dest).length / 1024);
  console.log(`  wrote ${dest} (${kb} KB)`);
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return null;
  }
}

function writeManifest(m) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

// Structural read of a GLB's JSON chunk: enough to prove a geometry-free
// clip file targets the rig's own node names before any browser tries it.
function glbJson(file) {
  const buf = readFileSync(file);
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) return JSON.parse(buf.subarray(off + 8, off + 8 + len).toString());
    off += 8 + len;
  }
  throw new Error(`${file}: no JSON chunk`);
}

function verifyClipFile(clipFile, riggedFile) {
  const clip = glbJson(clipFile);
  const rigged = glbJson(riggedFile);
  const riggedNames = new Set((rigged.nodes ?? []).map((n) => n.name));
  const anims = clip.animations ?? [];
  const meshCount = (clip.meshes ?? []).length;
  const targets = new Set();
  for (const a of anims) {
    for (const ch of a.channels ?? []) {
      const node = clip.nodes?.[ch.target?.node];
      if (node?.name) targets.add(node.name);
    }
  }
  const missing = [...targets].filter((n) => !riggedNames.has(n));
  console.log(
    `  verify ${path.basename(clipFile)}: ${anims.length} animation(s) ` +
      `[${anims.map((a) => a.name).join(', ')}], ${meshCount} mesh(es), ` +
      `${targets.size} target nodes, ${missing.length} missing from the rig` +
      (missing.length > 0 ? ` (${missing.slice(0, 5).join(', ')})` : ''),
  );
  if (anims.length === 0) throw new Error('clip file carries no animations');
  if (missing.length > 0) throw new Error('clip channels target nodes the rig does not have');
}

async function bakeBatch(rigTask, presets, manifest) {
  console.log(`baking ${presets.length} clip(s): ${presets.join(', ')}`);
  const taskId = await post(`${V3}/animations/retarget`, {
    input: rigTask,
    animations: presets,
    out_format: 'glb',
    bake_animation: true,
    export_with_geometry: false,
  });
  const url = await awaitTask(taskId);
  // One task returns one GLB carrying the batch; each preset gets its own
  // served file, so the batch downloads once and splits by reference: the
  // same file is small enough (no geometry) to just store per preset.
  const batchFile = path.join(OUT_DIR, `clips/batch_${taskId}.glb`);
  await download(url, batchFile);
  const json = glbJson(batchFile);
  const baked = new Set((json.animations ?? []).map((a) => a.name));
  for (const preset of presets) {
    if (!baked.has(preset)) {
      console.warn(`  WARNING: ${preset} not found in the baked file (has: ${[...baked]})`);
    }
    manifest.clips[preset] = `clips/batch_${taskId}.glb`;
  }
  writeManifest(manifest);
}

async function stage1() {
  console.log('stage 1: the mannequin itself, plus one test clip');
  console.log('generating the reference image...');
  const imageTask = await post(TASK_URL, {
    type: 'generate_image',
    model_version: IMAGE_MODEL,
    prompt: MANNEQUIN_PROMPT,
    t_pose: true,
  });
  const imageUrl = await awaitTask(imageTask, TASK_URL);
  await download(imageUrl, path.join(OUT_DIR, 'reference.png'));

  console.log('image to 3D (untextured, low face count: gray is the point)...');
  const modelTask = await post(`${V3}/generation/image-to-model`, {
    model: MODEL_VERSION,
    input: imageUrl,
    texture: false,
    face_limit: 15000,
    compress: 'geometry',
    orientation: 'align_image',
  });
  await awaitTask(modelTask);

  console.log('rigging...');
  const rigTask = await post(`${V3}/animations/rig`, {
    input: modelTask,
    model: RIG_MODEL,
    rig_type: 'biped',
    spec: 'tripo',
    out_format: 'glb',
  });
  const riggedUrl = await awaitTask(rigTask);
  await download(riggedUrl, path.join(OUT_DIR, 'mannequin.glb'));

  const manifest = {
    generatedAt: new Date().toISOString(),
    provider: 'tripo',
    modelTask,
    rigTask,
    model: 'mannequin.glb',
    clips: {},
  };
  writeManifest(manifest);

  await bakeBatch(rigTask, ['preset:biped:run'], manifest);
  const runFile = path.join(OUT_DIR, manifest.clips['preset:biped:run']);
  verifyClipFile(runFile, path.join(OUT_DIR, 'mannequin.glb'));
  console.log('stage 1 done: inspect the mannequin, then run `clips all` for the catalog');
}

async function bakeClips(arg) {
  const manifest = readManifest();
  if (!manifest?.rigTask) throw new Error('no manifest with a rig task: run stage1 first');
  const wanted =
    arg === 'all' ? MANNEQUIN_PRESETS : arg.split(',').map((s) => s.trim().replace(/^:*/, ''));
  const missing = wanted.filter((p) => !manifest.clips[p]);
  if (missing.length === 0) {
    console.log('nothing to bake: every requested clip is in the manifest');
    return;
  }
  console.log(`${missing.length} clip(s) to bake, about ${missing.length * 10} credits`);
  for (let i = 0; i < missing.length; i += BATCH) {
    await bakeBatch(manifest.rigTask, missing.slice(i, i + BATCH), manifest);
  }
  console.log('done');
}

async function main() {
  if (!key) throw new Error('TRIPO_API_KEY is not set (use node --env-file=.env)');
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'stage1') await stage1();
  else if (cmd === 'clips' && arg) await bakeClips(arg);
  else {
    console.log('usage: forge_mannequin.mjs stage1 | clips all | clips <id,id,...>');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}

// Renders the announcer's clips, public/voice/<id>.mp3, from the line
// table in src/game/voice_lines.ts with the ElevenLabs text-to-speech
// API (voice: Lucy). The key comes from the environment and only from
// there: never read from a file in the repo, never written, never printed.
//
//   ELEVENLABS_API_KEY=<key> node scripts/build_voice.mjs [--only id] [--model id] [--list]
//
// --list prints the ids and their lines without touching the network (no
// key needed); tests/voice_bank.test.ts uses it to keep the script and the
// client on the same table. The clips are tracked with git-lfs
// (.gitattributes), so a re-render is a normal commit of the changed
// files. Every line is fixed text (the voice never names a champion), so
// the whole set is a few hundred characters per render.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

// Lucy, from the ElevenLabs voice library. Not a secret: the key is.
const VOICE_ID = 'lcMyyd2HUfFzxdCaC4Ta';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
// Steady and clear with a little color: an arena announcer, not a
// storyteller.
const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.8,
  style: 0.25,
  use_speaker_boost: true,
};

const OUT = path.join(process.cwd(), 'public', 'voice');

function parseArgs(argv) {
  const opts = { only: null, model: DEFAULT_MODEL, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--only') opts.only = argv[++i] ?? null;
    else if (a === '--model') opts.model = argv[++i] ?? DEFAULT_MODEL;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

// The table is TypeScript; esbuild strips it to a module we can import.
async function loadLines() {
  const r = await build({
    entryPoints: ['src/game/voice_lines.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
  });
  const code = r.outputFiles[0].text;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return mod.VOICE_LINES;
}

async function render(key, text, model) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const opts = parseArgs(process.argv.slice(2));
const lines = await loadLines();
const ids = Object.keys(lines).filter((id) => !opts.only || id === opts.only);
if (opts.only && ids.length === 0) {
  console.error(`no line named ${opts.only}; --list shows them`);
  process.exit(2);
}

if (opts.list) {
  for (const id of ids) console.log(`${id}\t${lines[id]}`);
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('ELEVENLABS_API_KEY is not set (pass it in the environment, never in a file).');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
let chars = 0;
let bytes = 0;
for (const id of ids) {
  const text = lines[id];
  const started = Date.now();
  const audio = await render(key, text, opts.model);
  const file = path.join(OUT, `${id}.mp3`);
  writeFileSync(file, audio);
  chars += text.length;
  bytes += audio.length;
  console.log(
    `${id.padEnd(16)} ${String(audio.length).padStart(7)} B  ${Date.now() - started} ms  "${text}"`,
  );
}
console.log(`${ids.length} clips, ${chars} characters, ${(bytes / 1024).toFixed(0)} KB -> ${OUT}`);

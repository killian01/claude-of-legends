// Cut the tour into something postable: title card, one labelled passage
// per surface, cross fades, end card. Reads what scripts/tour_clips.mjs
// filmed (tour/scenes.json plus a folder of frames per scene) and writes
// one mp4.
//
//   node scripts/tour_montage.mjs [tourDir] [out.mp4]
//
// The labels are English on purpose: the clip is for the announcement, and
// the announcement is read where the developers are.
//
// Cutting here rather than in an editor is not thrift. The passages are
// re-filmed every time a surface changes, and a montage nobody can rebuild
// from a command is a montage that is out of date by the next release.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TOUR = process.argv[2] ?? 'tour';
const OUT = process.argv[3] ?? path.join(TOUR, 'tour-montage.mp4');
const FONT = process.env.TOUR_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
// The card that already carries the crest, the wordmark and the domain:
// the link preview and the clip should open on the same image.
const CARD = process.env.TOUR_CARD ?? 'public/social-card.jpg';

const W = 1280;
const H = 720;
const FPS = 30;
// Long enough to read as a cut rather than a glitch, short enough that
// four of them do not eat a third of the clip.
const FADE = 0.35;

// What each passage is worth, in seconds, and where to start inside it.
// The starts skip the moment a surface spends arriving; the lengths are
// what the passage says, not what it recorded.
const CUT = [
  {
    scene: 'home',
    start: 1.0,
    seconds: 3.5,
    label: 'FIVE WAYS IN',
    sub: 'ranked · bots · forge · lobby · practice',
  },
  {
    scene: 'champions',
    start: 1.4,
    seconds: 6.0,
    label: 'TEN CHAMPIONS',
    sub: 'every one with a full kit',
  },
  {
    scene: 'forge',
    start: 2.0,
    seconds: 7.0,
    label: 'THE FORGE',
    sub: 'build an eleventh · kit and all',
  },
  {
    scene: 'academy',
    start: 2.6,
    seconds: 7.5,
    label: 'THE ACADEMY',
    sub: 'a bot is written · not coded',
  },
];

function run(args, what) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
}

// drawtext takes its text inside single quotes, so the characters that end
// the quoting or the filter have to go. Kept deliberately narrow: the
// labels are written here, not by a user.
const safe = (s) => s.replace(/['\\:]/g, '');

// A label dropped straight onto a screen full of interface lands on top of
// somebody else's sentence and neither reads. Six bands of increasing
// darkness fake a gradient under it: cheap, and it keeps the frame legible
// without a black bar across the picture.
function scrim(on) {
  const bands = [
    [210, 30, 0.1],
    [180, 30, 0.24],
    [150, 30, 0.4],
    [120, 30, 0.56],
    [90, 30, 0.68],
    [60, 60, 0.76],
  ];
  return bands
    .map(
      ([up, tall, a]) =>
        // ih, not h: inside drawbox `h` is the box's own height, and the
        // first version put the whole gradient across the top of the frame.
        `drawbox=x=0:y=ih-${up}:w=iw:h=${tall}:color=0x0A1120@${a}:t=fill:enable='${on}'`,
    )
    .join(',');
}

function label(text, sub, from = 0.4, hold = 2.6) {
  const on = `between(t,${from},${from + hold})`;
  // Fades on the text itself, so a label arrives and leaves rather than
  // blinking, and never sits on the cut.
  const alpha = `if(lt(t,${from + 0.35}),(t-${from})/0.35,if(lt(t,${from + hold - 0.45}),1,(${from + hold}-t)/0.45))`;
  const common = `fontfile=${FONT}:fontcolor=0xE6D7A8:alpha='${alpha}':enable='${on}'`;
  return [
    scrim(on),
    `drawtext=text='${safe(text)}':${common}:fontsize=40:x=64:y=h-152`,
    `drawtext=text='${safe(sub)}':fontfile=${FONT}:fontcolor=0xDFE7F5:alpha='${alpha}':enable='${on}':fontsize=23:x=64:y=h-100`,
  ].join(',');
}

const manifestPath = path.join(TOUR, 'scenes.json');
if (!existsSync(manifestPath)) {
  throw new Error(`no ${manifestPath}: run scripts/tour_clips.mjs first`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const seconds = new Map(manifest.scenes.map((s) => [s.name, s]));

const work = mkdtempSync(path.join(tmpdir(), 'tour-cut-'));
const segments = [];

try {
  // 1. The title card, with a slow push in so the clip is never still.
  const title = path.join(work, 'a-title.mp4');
  run(
    [
      '-loop',
      '1',
      '-t',
      '2.2',
      '-i',
      CARD,
      '-filter_complex',
      `[0:v]scale=${Math.round(W * 1.12)}:-2,crop=${W}:${H},zoompan=z='min(zoom+0.0012,1.09)':d=66:s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=0.5,format=yuv420p[v]`,
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      title,
    ],
    'title card',
  );
  segments.push({ file: title, seconds: 2.2 });

  // 2. Each passage, cut and labelled.
  for (const cut of CUT) {
    const dir = path.join(TOUR, cut.scene);
    const shot = seconds.get(cut.scene);
    if (!shot || !existsSync(dir)) {
      console.log(`skip ${cut.scene}: not filmed`);
      continue;
    }
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
    // The screencast hands back whatever frames it managed, so the real
    // rate is what was captured over how long it ran. Assuming 30 would
    // play every passage at the wrong speed.
    const rate = frames / shot.seconds;
    const file = path.join(work, `b-${cut.scene}.mp4`);
    run(
      [
        '-framerate',
        rate.toFixed(4),
        '-i',
        path.join(dir, 'frame-%04d.jpg'),
        '-ss',
        String(cut.start),
        '-t',
        String(cut.seconds),
        '-filter_complex',
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=0x0A1120,fps=${FPS},${label(cut.label, cut.sub)},format=yuv420p[v]`,
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '21',
        file,
      ],
      cut.scene,
    );
    segments.push({ file, seconds: cut.seconds });
  }

  // 3. The fight, if one has been filmed beside the tour. It comes from
  // the replay viewer rather than from here (docs/making-a-clip.md), and
  // on a machine without a GPU it is the passage that lets the clip down.
  const fight = path.join(TOUR, 'fight.mp4');
  if (existsSync(fight)) {
    const file = path.join(work, 'c-fight.mp4');
    run(
      [
        '-i',
        fight,
        '-filter_complex',
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:-1:-1:color=0x0A1120,fps=${FPS},${label('5v5 IN A BROWSER TAB', 'three lanes · no install')},format=yuv420p[v]`,
        '-map',
        '[v]',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '21',
        file,
      ],
      'fight',
    );
    const probe = spawnSync('ffprobe', [
      '-v',
      'quiet',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]);
    segments.push({ file, seconds: Number(String(probe.stdout).trim()) || 8 });
  } else {
    console.log('no tour/fight.mp4: the montage ends on the Academy');
  }

  // 4. The end card: the same image the link preview uses, plus the one
  // line the audience for this clip cares about.
  const end = path.join(work, 'd-end.mp4');
  run(
    [
      '-loop',
      '1',
      '-t',
      '2.6',
      '-i',
      CARD,
      '-filter_complex',
      `[0:v]scale=${Math.round(W * 1.09)}:-2,crop=${W}:${H},fps=${FPS},drawtext=text='open source · MIT · TypeScript':fontfile=${FONT}:fontcolor=0xA9B8CF:fontsize=24:x=(w-text_w)/2:y=h-54,fade=t=out:st=2.0:d=0.6,format=yuv420p[v]`,
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      end,
    ],
    'end card',
  );
  segments.push({ file: end, seconds: 2.6 });

  // 5. Chain the cross fades. Each offset is where the transition starts
  // in the growing output, which is the previous offset plus the previous
  // clip minus one fade: the clips overlap, so the timeline is shorter
  // than their sum and every offset after the first depends on the last.
  const inputs = segments.flatMap((s) => ['-i', s.file]);
  const steps = [];
  let cursor = segments[0].seconds - FADE;
  let last = '0:v';
  for (let i = 1; i < segments.length; i++) {
    const out = i === segments.length - 1 ? 'v' : `x${i}`;
    steps.push(
      `[${last}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${cursor.toFixed(3)}[${out}]`,
    );
    last = out;
    cursor += segments[i].seconds - FADE;
  }
  run(
    [
      ...inputs,
      '-filter_complex',
      steps.join(';'),
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      OUT,
    ],
    'montage',
  );

  const total = segments.reduce((n, s) => n + s.seconds, 0) - FADE * (segments.length - 1);
  console.log(`${OUT}: ${segments.length} segments, ${total.toFixed(1)}s`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

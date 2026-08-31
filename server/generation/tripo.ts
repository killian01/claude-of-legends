// Tripo, the first provider behind the neutral interface. The 3D half
// rides the v3 API (async tasks created per endpoint, polled on
// /v3/tasks/{id}); the 2D half rides the v2 task queue's advanced
// generate_image task (docs.tripo3d.ai advanced-image-generation) so a
// real image model, chosen by model_version, does both generation and
// instruction editing. Verified against a live key (2026-08-31): the
// task envelope is {code, data: {task_id, status, output}}, the upload
// endpoint lives on the v2 host, an uploaded token rides as
// input.file_token on v3 routes and as file.file_token on the v2 task;
// the advanced 2D envelope itself follows the docs and is proven by its
// first live generation (a failure costs nothing, the 2D quota spends
// only on success).
//
// v1 contract points from the spike: bipeds ride rig model v1.0-20240301
// because only its 110-preset library tells the full six-clip story; the
// per-family attack mapping below is the spike's, pending a human pass
// over the actual clips (chop stands in for blunt).

import {
  type ClipChoice,
  type ClipRole,
  GenerationError,
  type GenerationProvider,
  type ProviderAsset,
  type RigType,
  type WeaponFamily,
} from './provider';

const BASE = 'https://openapi.tripo3d.ai/v3';
// The upload endpoint never moved to v3: it lives on the v2 host and
// answers a file token (verified against a live key, 2026-08-31).
const UPLOAD_URL = 'https://api.tripo3d.ai/v2/openapi/upload/sts';
// Same host: the account's credit balance, logged at boot for ops.
const BALANCE_URL = 'https://api.tripo3d.ai/v2/openapi/user/balance';
// The v2 task queue (docs.tripo3d.ai quick start): where the advanced
// generate_image task lives. Submissions and polls both ride it.
const TASK_URL = 'https://api.tripo3d.ai/v2/openapi/task';
// The advanced image task's model: the strongest GPT image model Tripo
// exposes (docs.tripo3d.ai advanced-image-generation), a deliberate
// quality-over-cost default: it both generates and instruction-edits
// well, so every 2D generation rides it. Alternatives include
// flux.1_kontext_pro and gemini_3_pro_image_preview (TRIPO_IMAGE_MODEL).
const DEFAULT_IMAGE_MODEL = 'gpt_image_2';
// The rig model whose preset library covers every clip role (spike);
// rig verified live 2026-08-31 (task type animate_rig, output model_url).
const RIG_MODEL = 'v1.0-20240301';
// image-to-model demands an explicit model in live (2026-08-31: allowed
// P1-20260311, P2-20260801, v2.5-20250123, v3.0-20250812, v3.1-20260211).
// The standard lineage; the low-poly P series is worth a trial once the
// full chain stands, since UGC gameplay is its stated target.
const IMAGE_TO_MODEL_VERSION = 'v3.1-20260211';

// The renderer clips as Tripo v1.0 rig presets, per weapon family: the
// quick-pick prefill and the fallback. Five on purpose: one live
// retarget task carries at most 5 animations.
export const TRIPO_CLIPS: Readonly<Record<WeaponFamily, Readonly<Record<ClipRole, string>>>> =
  (() => {
    const shared = {
      idle: 'preset:biped:idle',
      run: 'preset:biped:run',
      cast: 'preset:biped:cast_a_spell',
      death: 'preset:biped:defeat_02',
    };
    return {
      slashing: { ...shared, attack: 'preset:biped:slash' },
      blunt: { ...shared, attack: 'preset:biped:chop' },
      bow: { ...shared, attack: 'preset:biped:shoot' },
      staff: { ...shared, attack: 'preset:biped:fire' },
      unarmed: { ...shared, attack: 'preset:biped:box_01' },
    };
  })();

// What the player picks from, per clip role: the fighting-shaped slice
// of the v1.0 rig's preset library (developers.tripo3d.ai
// animations-retarget, fetched 2026-08-31). Ids verbatim from the docs.
// Curated ON THE MANNEQUIN (playtest round 9c, every preset watched):
// swagger is a walk, not an idle; the flee presets, golf, hurt, and the
// emote-shaped casts (cheer, angry, clap, heart pose) read wrong on a
// champion and are out. Every family default above appears in its
// role's list, pinned by test.
export const TRIPO_CLIP_CHOICES: Readonly<Record<ClipRole, readonly ClipChoice[]>> = {
  idle: [
    { id: 'preset:biped:idle', label: 'Combat idle' },
    { id: 'preset:biped:standing_relax', label: 'Relaxed stance' },
    { id: 'preset:biped:wait', label: 'Impatient wait' },
    { id: 'preset:biped:look_around', label: 'Look around' },
    { id: 'preset:biped:fold_arms', label: 'Folded arms' },
  ],
  run: [
    { id: 'preset:biped:run', label: 'Run' },
    { id: 'preset:biped:walk', label: 'Walk' },
    { id: 'preset:biped:swagger', label: 'Swagger walk' },
  ],
  attack: [
    { id: 'preset:biped:slash', label: 'Sword slash' },
    { id: 'preset:biped:chop', label: 'Heavy chop' },
    { id: 'preset:biped:shoot', label: 'Bow shot' },
    { id: 'preset:biped:fire', label: 'Ranged fire' },
    { id: 'preset:biped:box_01', label: 'Punch combo 1' },
    { id: 'preset:biped:box_02', label: 'Punch combo 2' },
    { id: 'preset:biped:box_03', label: 'Punch combo 3' },
    { id: 'preset:biped:front_kick_01', label: 'Front kick 1' },
    { id: 'preset:biped:front_kick_02', label: 'Front kick 2' },
    { id: 'preset:biped:pitch_baseball', label: 'Overhand throw' },
  ],
  cast: [
    { id: 'preset:biped:cast_a_spell', label: 'Spell cast' },
    { id: 'preset:biped:fire', label: 'Channel and fire' },
  ],
  death: [
    { id: 'preset:biped:defeat_02', label: 'Defeat, variant 2' },
    { id: 'preset:biped:defeat_03', label: 'Defeat, variant 3' },
    { id: 'preset:biped:fall', label: 'Fall' },
  ],
};

interface TripoTaskEnvelope {
  code?: number;
  data?: {
    task_id?: string;
    status?: string;
    output?: Record<string, unknown>;
  };
}

export interface TripoOptions {
  fetchFn?: typeof fetch;
  // Injectable for tests; production sleeps between polls.
  sleep?: (ms: number) => Promise<void>;
  pollEveryMs?: number;
  timeoutMs?: number;
  // The advanced image task's model_version (TRIPO_IMAGE_MODEL).
  imageModel?: string;
}

export class TripoProvider implements GenerationProvider {
  readonly id = 'tripo';
  // Image-driven 2D goes through the advanced generate_image task, whose
  // models edit the input image under the prompt instead of loosely
  // reimagining it.
  readonly editsImages = true;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollEveryMs: number;
  private readonly timeoutMs: number;
  private readonly imageModel: string;

  constructor(
    private readonly apiKey: string,
    options: TripoOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.pollEveryMs = options.pollEveryMs ?? 3000;
    // A generation task can legitimately take minutes; ten is a hang.
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    this.imageModel = options.imageModel || DEFAULT_IMAGE_MODEL;
  }

  private async postAt(url: string, body: unknown): Promise<string> {
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new GenerationError(`tripo ${url} refused: ${res.status} ${await res.text()}`);
    }
    const envelope = (await res.json()) as TripoTaskEnvelope;
    const taskId = envelope.data?.task_id;
    if (!taskId) throw new GenerationError(`tripo ${url} returned no task id`);
    return taskId;
  }

  private post(path: string, body: unknown): Promise<string> {
    return this.postAt(`${BASE}${path}`, body);
  }

  // Poll until the task settles; the first URL in the output is the file
  // (Tripo names it model, pbr_model, or image depending on the task).
  // Both queues speak the same envelope; pollBase picks the queue the
  // task was submitted on (v3 generations, or the v2 task queue).
  private async awaitTask(
    taskId: string,
    model: string,
    pollBase = `${BASE}/tasks`,
  ): Promise<ProviderAsset> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const res = await this.fetchFn(`${pollBase}/${taskId}`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) throw new GenerationError(`tripo task poll refused: ${res.status}`);
      const envelope = (await res.json()) as TripoTaskEnvelope;
      const status = envelope.data?.status ?? 'unknown';
      if (status === 'success') {
        const output = envelope.data?.output ?? {};
        const url = Object.values(output).find(
          (v): v is string => typeof v === 'string' && v.startsWith('http'),
        );
        if (!url) throw new GenerationError(`tripo task ${taskId} succeeded with no file url`);
        return {
          taskId,
          url,
          provenance: { provider: this.id, model, at: Date.now(), taskId },
        };
      }
      if (status === 'failed' || status === 'cancelled' || status === 'banned') {
        // 'banned' is Tripo's content refusal.
        throw new GenerationError(`tripo task ${taskId} ended ${status}`, status === 'banned');
      }
      if (Date.now() >= deadline) {
        throw new GenerationError(`tripo task ${taskId} timed out (${status})`);
      }
      await this.sleep(this.pollEveryMs);
    }
  }

  // Every 2D generation rides the advanced generate_image task on the v2
  // queue (docs.tripo3d.ai advanced-image-generation): its model_version
  // selects the actual image model, text-only included, so the splash is
  // never made by a weaker default. With a source image (an uploaded file
  // token) the same model instruction-edits it instead of reimagining.
  // t_pose stands the character in a rig-ready pose while keeping its
  // look; the model reference derivation asks for it. (The v3 basic
  // text-to-image this replaced stays live-verified in git history.)
  async generate2D(req: {
    prompt: string;
    image?: string;
    tPose?: boolean;
  }): Promise<ProviderAsset> {
    const taskId = await this.postAt(TASK_URL, {
      type: 'generate_image',
      model_version: this.imageModel,
      prompt: req.prompt,
      ...(req.image ? { file: { type: 'png', file_token: req.image } } : {}),
      ...(req.tPose ? { t_pose: true } : {}),
    });
    return this.awaitTask(taskId, this.imageModel, TASK_URL);
  }

  // The file upload that turns a local image into an input token
  // (data.image_token). Lives on the v2 host; verified live 2026-08-31.
  async uploadImage(file: { data: Uint8Array; name: string }): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.data)]), file.name);
    const res = await this.fetchFn(UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new GenerationError(`tripo upload refused: ${res.status} ${await res.text()}`);
    }
    const envelope = (await res.json()) as { data?: { image_token?: string } };
    const token = envelope.data?.image_token;
    if (!token) throw new GenerationError('tripo upload returned no image token');
    return token;
  }

  // The account's credit balance ({balance, frozen}); -1 when the call
  // fails, so a boot log never blocks on it. Tripo-specific, not part of
  // the neutral interface.
  async balance(): Promise<number> {
    try {
      const res = await this.fetchFn(BALANCE_URL, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return -1;
      const envelope = (await res.json()) as { data?: { balance?: number } };
      return envelope.data?.balance ?? -1;
    } catch {
      return -1;
    }
  }

  async imageTo3D(req: {
    image?: string;
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    // Input preference: an uploaded file token first (the staged flow
    // re-uploads the chosen local reference), then the signed output URL,
    // then the task id. Live corrections: a token must ride as
    // file.file_token, the same shape as the advanced 2D task (an
    // input.file_token object is refused with 1004 "file is required",
    // 2026-08-31); a URL rides as input (verified by the first live
    // build); a 2D task referenced by id is refused as inaccessible.
    const source =
      req.image !== undefined
        ? { file: { type: 'png', file_token: req.image } }
        : { input: req.imageUrl ?? req.imageTaskId };
    const taskId = await this.post('/generation/image-to-model', {
      model: IMAGE_TO_MODEL_VERSION,
      ...source,
      texture: true,
      compress: 'geometry',
      orientation: 'align_image',
      ...(req.seed !== undefined ? { model_seed: req.seed } : {}),
    });
    return this.awaitTask(taskId, IMAGE_TO_MODEL_VERSION);
  }

  async rig(req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset> {
    const taskId = await this.post('/animations/rig', {
      input: req.modelTaskId,
      model: RIG_MODEL,
      rig_type: req.rigType,
      spec: 'tripo',
      out_format: 'glb',
    });
    return this.awaitTask(taskId, RIG_MODEL);
  }

  clipChoices(): Readonly<Record<ClipRole, readonly ClipChoice[]>> {
    return TRIPO_CLIP_CHOICES;
  }

  clipDefaults(family: WeaponFamily): Readonly<Record<ClipRole, string>> {
    return TRIPO_CLIPS[family];
  }

  async animate(req: {
    riggedTaskId: string;
    animations: readonly string[];
    withGeometry: boolean;
  }): Promise<ProviderAsset> {
    const taskId = await this.post('/animations/retarget', {
      input: req.riggedTaskId,
      // The baked GLB names each clip by its preset id.
      animations: [...req.animations],
      out_format: 'glb',
      bake_animation: true,
      export_with_geometry: req.withGeometry,
    });
    return this.awaitTask(taskId, RIG_MODEL);
  }
}

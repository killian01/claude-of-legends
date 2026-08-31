// Tripo, the first provider behind the neutral interface. Written against
// the v3 API as documented on developers.tripo3d.ai (see
// docs/research/generation-providers-spike.md): async tasks created per
// endpoint, then polled on /v3/tasks/{id}. The 2D half is VERIFIED
// against a live key (2026-08-31): the task envelope is
// {code, data: {task_id, status, output}}, text-to-image and
// image-to-image answer output.generated_image_url, the upload endpoint
// lives on the v2 host, and an uploaded token rides as input.file_token.
// The 3D half (image-to-model, rig, retarget) still follows the docs
// alone and is verified by the first live finalize chain.
//
// v1 contract points from the spike: bipeds ride rig model v1.0-20240301
// because only its 110-preset library tells the full six-clip story; the
// per-family attack mapping below is the spike's, pending a human pass
// over the actual clips (chop stands in for blunt).

import {
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
// The rig model whose preset library covers all six clips (spike).
const RIG_MODEL = 'v1.0-20240301';
// image-to-model demands an explicit model in live (2026-08-31: allowed
// P1-20260311, P2-20260801, v2.5-20250123, v3.0-20250812, v3.1-20260211).
// The standard lineage; the low-poly P series is worth a trial once the
// full chain stands, since UGC gameplay is its stated target.
const IMAGE_TO_MODEL_VERSION = 'v3.1-20260211';

// The six renderer clips as Tripo v1.0 rig presets, per weapon family.
export const TRIPO_CLIPS: Readonly<Record<WeaponFamily, Readonly<Record<ClipRole, string>>>> =
  (() => {
    const shared = {
      idle: 'preset:biped:idle',
      run: 'preset:biped:run',
      cast: 'preset:biped:cast_a_spell',
      death: 'preset:biped:defeat_02',
      victory: 'preset:biped:victory_celebration',
    };
    return {
      slashing: { ...shared, attack: 'preset:biped:slash' },
      blunt: { ...shared, attack: 'preset:biped:chop' },
      bow: { ...shared, attack: 'preset:biped:shoot' },
      staff: { ...shared, attack: 'preset:biped:fire' },
      unarmed: { ...shared, attack: 'preset:biped:box_01' },
    };
  })();

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
}

export class TripoProvider implements GenerationProvider {
  readonly id = 'tripo';
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollEveryMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly apiKey: string,
    options: TripoOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.pollEveryMs = options.pollEveryMs ?? 3000;
    // A generation task can legitimately take minutes; ten is a hang.
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  }

  private async post(path: string, body: unknown): Promise<string> {
    const res = await this.fetchFn(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new GenerationError(`tripo ${path} refused: ${res.status} ${await res.text()}`);
    }
    const envelope = (await res.json()) as TripoTaskEnvelope;
    const taskId = envelope.data?.task_id;
    if (!taskId) throw new GenerationError(`tripo ${path} returned no task id`);
    return taskId;
  }

  // Poll until the task settles; the first URL in the output is the file
  // (Tripo names it model, pbr_model, or image depending on the task).
  private async awaitTask(taskId: string, model: string): Promise<ProviderAsset> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const res = await this.fetchFn(`${BASE}/tasks/${taskId}`, {
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

  // With a source image (the validated splash, as an uploaded file token)
  // this is the image-to-image derivation the ADR describes; without one
  // it is plain text-to-image. Both verified against a live key
  // (2026-08-31): the token rides as input.file_token (a bare token
  // string is refused as "input task not found"), and the output arrives
  // as output.generated_image_url.
  async generate2D(req: { prompt: string; image?: string }): Promise<ProviderAsset> {
    const endpoint = req.image ? '/generation/image-to-image' : '/generation/text-to-image';
    const taskId = await this.post(endpoint, {
      prompt: req.prompt,
      ...(req.image ? { input: { file_token: req.image } } : {}),
    });
    return this.awaitTask(taskId, endpoint.slice('/generation/'.length));
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
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    // The URL is preferred over the task id: live (2026-08-31) a 2D task
    // referenced by id is refused as inaccessible, while the signed
    // output URL is accepted; the pipeline always calls this seconds
    // after the sheet lands, well inside the URL's validity.
    const taskId = await this.post('/generation/image-to-model', {
      model: IMAGE_TO_MODEL_VERSION,
      input: req.imageUrl ?? req.imageTaskId,
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

  async animate(req: { riggedTaskId: string; family: WeaponFamily }): Promise<ProviderAsset> {
    const clips = TRIPO_CLIPS[req.family];
    const taskId = await this.post('/animations/retarget', {
      input: req.riggedTaskId,
      animations: Object.values(clips),
      out_format: 'glb',
      bake_animation: true,
      export_with_geometry: true,
    });
    return this.awaitTask(taskId, RIG_MODEL);
  }
}

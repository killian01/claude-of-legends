// Tripo, the first provider behind the neutral interface. Written against
// the v3 API as documented on developers.tripo3d.ai (read 2026-08-31, see
// docs/research/generation-providers-spike.md): async tasks created per
// endpoint, then polled on /v3/tasks/{id}. The task envelope shape
// ({code, data.status, data.output}) follows Tripo's published pattern
// and MUST be re-verified against a live key before production; the
// fetch is injectable exactly so tests pin our side of the contract now.
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
// The rig model whose preset library covers all six clips (spike).
const RIG_MODEL = 'v1.0-20240301';

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
  // it is plain text-to-image. Both routes follow Tripo's documented v3
  // pattern and MUST be re-verified against a live key.
  async generate2D(req: { prompt: string; image?: string }): Promise<ProviderAsset> {
    const endpoint = req.image ? '/generation/image-to-image' : '/generation/text-to-image';
    const taskId = await this.post(endpoint, {
      prompt: req.prompt,
      ...(req.image ? { input: req.image } : {}),
    });
    return this.awaitTask(taskId, endpoint.slice('/generation/'.length));
  }

  // The file upload that turns a local image into an input token. Written
  // against Tripo's published upload pattern (the v2 API exposed
  // /upload/sts answering data.image_token); MUST be re-verified against
  // a live key alongside the task envelope.
  async uploadImage(file: { data: Uint8Array; name: string }): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.data)]), file.name);
    const res = await this.fetchFn(`${BASE}/upload/sts`, {
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

  async imageTo3D(req: {
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    const taskId = await this.post('/generation/image-to-model', {
      input: req.imageTaskId ?? req.imageUrl,
      texture: true,
      compress: 'geometry',
      orientation: 'align_image',
      ...(req.seed !== undefined ? { model_seed: req.seed } : {}),
    });
    return this.awaitTask(taskId, 'image-to-model');
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

// The mock provider: the whole pipeline, no vendor. Deterministic task
// ids, mock:// URLs, zero latency, and injectable failures so the refund
// paths are as testable as the happy one. Also the keyless dev provider
// (GENERATION_PROVIDER=mock), so finalize can be walked end to end on
// localhost before a Tripo key exists.

import {
  CLIP_ROLES,
  type ClipChoice,
  type ClipRole,
  GenerationError,
  type GenerationProvider,
  type ProviderAsset,
  type RigType,
  type WeaponFamily,
} from './provider';

export type MockOp = 'generate2D' | 'imageTo3D' | 'rig' | 'animate';

// What each op says it charged, in the same shape and the same order of
// magnitude Tripo reports (measured 2026-09-05: 10 for an image, 30 for
// an image_to_model, 25 for the rig, 10 to 30 for a retarget by clip
// count). Tests assert relative sizes, never these exact numbers.
export const MOCK_COSTS: Readonly<Record<MockOp, number>> = {
  generate2D: 10,
  imageTo3D: 30,
  rig: 25,
  animate: 30,
};

export class MockProvider implements GenerationProvider {
  readonly id = 'mock';
  // Mirrors production Tripo (instruction-edit models behind generate2D);
  // tests flip it to cover the reimagining-provider prompt path.
  editsImages = true;
  private counter = 0;
  // Ops that must fail, by name; `blocked` failures simulate a content
  // refusal instead of a technical one.
  readonly failOn = new Set<MockOp>();
  blockOn: MockOp | null = null;
  // Every request, in order, so tests can pin what rode along (the splash
  // token on the model sheet derivation, for one).
  readonly seen: { op: string; req: unknown }[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  private produce(op: MockOp, kind: string, req: unknown): Promise<ProviderAsset> {
    this.seen.push({ op, req });
    if (this.blockOn === op) {
      return Promise.reject(new GenerationError(`mock ${op} refused the content`, true));
    }
    if (this.failOn.has(op)) {
      return Promise.reject(new GenerationError(`mock ${op} failed`));
    }
    this.counter += 1;
    const taskId = `mock-${op}-${this.counter}`;
    return Promise.resolve({
      taskId,
      url: `mock://${kind}/${taskId}`,
      provenance: { provider: this.id, model: 'mock-1', at: this.now(), taskId },
      // A settled task reports what it charged, as Tripo does, so the
      // calibration path (ADR 0017) is exercised without a real provider.
      cost: MOCK_COSTS[op],
    });
  }

  generate2D(req: { prompt: string; image?: string; tPose?: boolean }): Promise<ProviderAsset> {
    return this.produce('generate2D', 'image', req);
  }

  uploadImage(file: { data: Uint8Array; name: string }): Promise<string> {
    this.seen.push({ op: 'uploadImage', req: { name: file.name, bytes: file.data.length } });
    this.counter += 1;
    return Promise.resolve(`mock-upload-${this.counter}`);
  }

  imageTo3D(req: {
    image?: string;
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    return this.produce('imageTo3D', 'model', req);
  }

  rig(req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset> {
    return this.produce('rig', 'rigged', req);
  }

  // The mock's catalog: each role offers its bare name (what the
  // placeholder GLB names its clips) plus one alternate, so pick
  // validation has something to accept and something to refuse.
  clipChoices(): Readonly<Record<ClipRole, readonly ClipChoice[]>> {
    return Object.fromEntries(
      CLIP_ROLES.map((role) => [
        role,
        [
          { id: role, label: `Mock ${role}` },
          { id: `${role}_alt`, label: `Mock ${role} alt` },
        ],
      ]),
    ) as Record<ClipRole, ClipChoice[]>;
  }

  clipDefaults(_family: WeaponFamily): Readonly<Record<ClipRole, string>> {
    return Object.fromEntries(CLIP_ROLES.map((role) => [role, role])) as Record<ClipRole, string>;
  }

  animate(req: {
    riggedTaskId: string;
    animations: readonly string[];
    withGeometry: boolean;
  }): Promise<ProviderAsset> {
    return this.produce('animate', 'animated', req);
  }
}

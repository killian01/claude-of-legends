// The mock provider: the whole pipeline, no vendor. Deterministic task
// ids, mock:// URLs, zero latency, and injectable failures so the refund
// paths are as testable as the happy one. Also the keyless dev provider
// (GENERATION_PROVIDER=mock), so finalize can be walked end to end on
// localhost before a Tripo key exists.

import {
  GenerationError,
  type GenerationProvider,
  type ProviderAsset,
  type RigType,
  type WeaponFamily,
} from './provider';

export type MockOp = 'generate2D' | 'imageTo3D' | 'rig' | 'animate';

export class MockProvider implements GenerationProvider {
  readonly id = 'mock';
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
    });
  }

  generate2D(req: { prompt: string; image?: string }): Promise<ProviderAsset> {
    return this.produce('generate2D', 'image', req);
  }

  uploadImage(file: { data: Uint8Array; name: string }): Promise<string> {
    this.seen.push({ op: 'uploadImage', req: { name: file.name, bytes: file.data.length } });
    this.counter += 1;
    return Promise.resolve(`mock-upload-${this.counter}`);
  }

  imageTo3D(req: {
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    return this.produce('imageTo3D', 'model', req);
  }

  rig(req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset> {
    return this.produce('rig', 'rigged', req);
  }

  animate(req: { riggedTaskId: string; family: WeaponFamily }): Promise<ProviderAsset> {
    return this.produce('animate', 'animated', req);
  }
}

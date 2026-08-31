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

  constructor(private readonly now: () => number = Date.now) {}

  private produce(op: MockOp, kind: string): Promise<ProviderAsset> {
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

  generate2D(_req: { prompt: string; imageUrl?: string }): Promise<ProviderAsset> {
    return this.produce('generate2D', 'image');
  }

  imageTo3D(_req: {
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    return this.produce('imageTo3D', 'model');
  }

  rig(_req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset> {
    return this.produce('rig', 'rigged');
  }

  animate(_req: { riggedTaskId: string; family: WeaponFamily }): Promise<ProviderAsset> {
    return this.produce('animate', 'animated');
  }
}

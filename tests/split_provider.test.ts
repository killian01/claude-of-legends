// Two vendors behind one provider. The interesting part is the upload
// token: art.ts hands it to generate2D and the pipeline hands it to
// imageTo3D, and those are now different companies. Everything else is
// delegation and is checked once so a method added to the interface and
// forgotten here is caught.

import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtProvider } from '../server/generation/openai_images';
import type { GenerationProvider, ProviderAsset } from '../server/generation/provider';
import { SplitProvider, STAGE_TTL_MS } from '../server/generation/split';

const asset = (taskId: string): ProviderAsset => ({
  taskId,
  url: `mock://${taskId}`,
  provenance: { provider: 'test', model: 'm', at: 1, taskId },
});

let stage: string;
let artCalls: { prompt: string; bytes: number[] | null }[];
let restCalls: string[];
let uploaded: number[][];

const art: ArtProvider = {
  id: 'art',
  editsImages: true,
  async generate2D(req) {
    artCalls.push({ prompt: req.prompt, bytes: req.image ? [...req.image.data] : null });
    return asset('art-1');
  },
};

const rest = {
  id: 'rest',
  async uploadImage(file: { data: Uint8Array; name: string }) {
    uploaded.push([...file.data]);
    return `rest-token-${uploaded.length}`;
  },
  async generate2D() {
    restCalls.push('generate2D');
    return asset('rest-2d');
  },
  async imageTo3D(req: { image?: string }) {
    restCalls.push(`imageTo3D:${req.image}`);
    return asset('rest-3d');
  },
  async rig() {
    restCalls.push('rig');
    return asset('rest-rig');
  },
  clipChoices() {
    restCalls.push('clipChoices');
    return {} as never;
  },
  clipDefaults() {
    restCalls.push('clipDefaults');
    return {} as never;
  },
  async animate() {
    restCalls.push('animate');
    return asset('rest-animate');
  },
} as unknown as GenerationProvider;

const make = (now = () => Date.now()) => new SplitProvider(art, rest, { stageDir: stage, now });

beforeEach(() => {
  stage = mkdtempSync(path.join(tmpdir(), 'loc-split-'));
  artCalls = [];
  restCalls = [];
  uploaded = [];
});
afterEach(() => rmSync(stage, { recursive: true, force: true }));

describe('the upload that has to serve both sides', () => {
  it('stages the bytes instead of choosing a vendor for them', async () => {
    // Nothing is sent anywhere here: an upload is used by whichever side
    // asks next, and uploading to the 3D vendor up front would pay a round
    // trip on every 2D iteration that never becomes a model.
    const token = await make().uploadImage({ data: new Uint8Array([1, 2, 3]), name: 'a.png' });
    expect(token.startsWith('staged:')).toBe(true);
    expect(uploaded).toEqual([]);
    expect(readdirSync(stage)).toHaveLength(1);
  });

  it('gives the same bytes the same token', async () => {
    const split = make();
    const one = await split.uploadImage({ data: new Uint8Array([7, 7]), name: 'a.png' });
    const two = await split.uploadImage({ data: new Uint8Array([7, 7]), name: 'b.png' });
    expect(one).toBe(two);
    expect(readdirSync(stage)).toHaveLength(1);
  });

  it('hands the art side the bytes, because it does not speak tokens', async () => {
    const split = make();
    const token = await split.uploadImage({ data: new Uint8Array([4, 5]), name: 'a.png' });
    await split.generate2D({ prompt: 'edit this', image: token });
    expect(artCalls).toEqual([{ prompt: 'edit this', bytes: [4, 5] }]);
    expect(restCalls).toEqual([]);
  });

  it('uploads to the 3D vendor only when a model is actually asked for', async () => {
    const split = make();
    const token = await split.uploadImage({ data: new Uint8Array([9]), name: 'a.png' });
    expect(uploaded).toEqual([]);
    await split.imageTo3D({ image: token });
    expect(uploaded).toEqual([[9]]);
    expect(restCalls).toEqual(['imageTo3D:rest-token-1']);
  });

  it('passes a token it did not stage straight through', async () => {
    // A provider-fresh handle from the 3D vendor itself: not ours to read,
    // and forwarding beats failing on it.
    await make().imageTo3D({ imageTaskId: 'tripo-task-77' });
    expect(restCalls).toEqual(['imageTo3D:undefined']);
  });

  it('fails rather than quietly generate a different character', async () => {
    // A job that outlived its staged input. Refunding is right; carrying
    // on from the prompt alone would hand back somebody else's champion.
    await expect(make().generate2D({ prompt: 'x', image: 'staged:gone.png' })).rejects.toThrow(
      /no longer staged/,
    );
  });
});

describe('the rest of the interface', () => {
  it('goes to the vendor that makes 3D', async () => {
    const split = make();
    await split.rig({ modelTaskId: 't', rigType: 'biped' });
    await split.animate({ riggedTaskId: 't', animations: ['a'], withGeometry: false });
    split.clipChoices();
    split.clipDefaults('staff');
    expect(restCalls).toEqual(['rig', 'animate', 'clipChoices', 'clipDefaults']);
  });

  it('reports the pair, and whether the art side edits', () => {
    // art.ts writes a different prompt when the provider truly edits, so
    // the flag has to be the art side's and not the other one's.
    expect(make().id).toBe('art+rest');
    expect(make().editsImages).toBe(true);
  });
});

describe('the staging directory', () => {
  it('drops files older than a day on the way past', async () => {
    const old = path.join(stage, 'old.png');
    writeFileSync(old, 'x');
    const longAgo = (Date.now() - STAGE_TTL_MS - 60_000) / 1000;
    utimesSync(old, longAgo, longAgo);
    await make().uploadImage({ data: new Uint8Array([1]), name: 'new.png' });
    const left = readdirSync(stage);
    expect(left).toHaveLength(1);
    expect(left[0]).not.toBe('old.png');
  });

  it('keeps what is still young', async () => {
    const fresh = path.join(stage, 'fresh.png');
    writeFileSync(fresh, 'x');
    await make().uploadImage({ data: new Uint8Array([1]), name: 'new.png' });
    expect(readdirSync(stage)).toHaveLength(2);
  });
});

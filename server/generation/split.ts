// Two vendors behind one provider: the 2D where it is made, the 3D where
// it is made.
//
// OpenAI sells the image model Tripo resells, at less than half the price
// (server/generation/openai_images.ts), and makes no 3D at all. Tripo
// makes the model, the rig and the retargets, and nobody else in the spike
// had a story for them. So the pipeline keeps talking to one
// GenerationProvider and this one routes each call to whoever should
// answer it. The seam ADR 0010 asked for is exactly this: swapping a
// vendor must never touch the pipeline.
//
// The one thing that had to be designed rather than delegated is
// `uploadImage`. Its token is used on BOTH sides: server/art.ts uploads a
// source image and passes the token to generate2D, and the pipeline
// uploads the chosen reference and passes the token to imageTo3D. Those
// are now two different companies, and neither understands the other's
// handle. Every upload starts from local bytes, so the token names a file
// this module keeps: the art side reads it, and the 3D side uploads it to
// Tripo at the moment it is actually needed. Nothing is uploaded to a
// vendor that never gets asked for it.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { ArtProvider } from './openai_images';
import {
  type ClipChoice,
  type ClipRole,
  GenerationError,
  type GenerationProvider,
  type ProviderAsset,
  type RigType,
  type WeaponFamily,
} from './provider';

// What a staged upload's token looks like. A prefix rather than a bare
// hash so a token from some other provider passed in by mistake is
// recognised and forwarded rather than silently read as a filename.
const TOKEN_PREFIX = 'staged:';

// How long a staged file is worth keeping. An upload is used within the
// same request or job, seconds later; a day is generous and bounds the
// directory without a scheduler.
export const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

export function stagedName(token: string): string | null {
  return token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null;
}

export interface SplitOptions {
  // Where staged uploads live. Under the data dir, not the assets dir:
  // these are inputs in flight, not champion assets, and nothing serves
  // them.
  stageDir: string;
  now?: () => number;
}

export class SplitProvider implements GenerationProvider {
  readonly id: string;
  readonly editsImages: boolean;
  private readonly stageDir: string;
  private readonly now: () => number;

  constructor(
    private readonly art: ArtProvider,
    private readonly rest: GenerationProvider,
    options: SplitOptions,
  ) {
    this.id = `${art.id}+${rest.id}`;
    this.editsImages = art.editsImages;
    this.stageDir = options.stageDir;
    this.now = options.now ?? Date.now;
  }

  // Staged rather than uploaded: the bytes go to disk under a name derived
  // from them, and whoever needs them decides what to do with them. The
  // hash makes the same image stage once however many times it is offered.
  async uploadImage(file: { data: Uint8Array; name: string }): Promise<string> {
    mkdirSync(this.stageDir, { recursive: true });
    this.sweep();
    const digest = createHash('sha256').update(file.data).digest('hex').slice(0, 32);
    const ext = path.extname(file.name) || '.png';
    const name = `${digest}${ext}`;
    const dest = path.join(this.stageDir, name);
    if (!existsSync(dest)) writeFileSync(dest, file.data);
    return `${TOKEN_PREFIX}${name}`;
  }

  async generate2D(req: {
    prompt: string;
    image?: string;
    tPose?: boolean;
  }): Promise<ProviderAsset> {
    const image = req.image === undefined ? undefined : this.read(req.image);
    return this.art.generate2D({
      prompt: req.prompt,
      ...(image ? { image } : {}),
      ...(req.tPose === undefined ? {} : { tPose: req.tPose }),
    });
  }

  // The staged file becomes a real upload here, and only here: this is the
  // one call that needs the 3D vendor to be holding the picture.
  async imageTo3D(req: {
    image?: string;
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset> {
    const name = req.image === undefined ? null : stagedName(req.image);
    if (name === null) return this.rest.imageTo3D(req);
    if (!this.rest.uploadImage) {
      throw new GenerationError('the 3D provider cannot take an image as input');
    }
    const file = this.read(req.image as string);
    const token = await this.rest.uploadImage(file);
    return this.rest.imageTo3D({ ...req, image: token });
  }

  rig(req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset> {
    return this.rest.rig(req);
  }

  clipChoices(): Readonly<Record<ClipRole, readonly ClipChoice[]>> {
    return this.rest.clipChoices();
  }

  clipDefaults(family: WeaponFamily): Readonly<Record<ClipRole, string>> {
    return this.rest.clipDefaults(family);
  }

  animate(req: {
    riggedTaskId: string;
    animations: readonly string[];
    withGeometry: boolean;
  }): Promise<ProviderAsset> {
    return this.rest.animate(req);
  }

  private read(token: string): { data: Uint8Array; name: string } {
    const name = stagedName(token);
    if (name === null) {
      throw new GenerationError('this image was not staged here and cannot be read back');
    }
    const file = path.join(this.stageDir, name);
    if (!existsSync(file)) {
      // A job that outlived its staged input: the caller refunds, which is
      // the right answer, rather than silently generating from the prompt
      // alone and handing back a different character.
      throw new GenerationError('the source image is no longer staged; generate it again');
    }
    return { data: readFileSync(file), name };
  }

  // Old staged files, dropped on the way past. No scheduler: uploads are
  // the only thing that fills this directory, so they are the only thing
  // that needs to empty it.
  private sweep(): void {
    const cutoff = this.now() - STAGE_TTL_MS;
    let names: string[];
    try {
      names = readdirSync(this.stageDir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(this.stageDir, name);
      try {
        if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
      } catch {
        // Someone else's race or a permission we do not have: a file left
        // behind costs a few kilobytes and is not worth failing an upload.
      }
    }
  }
}

// The 2D half of generation, bought where it is made.
//
// Tripo's advanced image task runs `gpt_image_2`, which is OpenAI's model
// resold, and bills a flat 10 credits for it. OpenAI bills the same model
// by token: the splash the Forge really asks for, 1024x1536 at medium,
// measured 2026-09-06, comes to 98 text tokens in and 1372 image tokens
// out, which is 4.2 cents against Tripo's 10. Same picture, same model,
// less than half the price, so the 2D comes here and the 3D stays where
// it is made (server/generation/split.ts joins the two).
//
// This is not a GenerationProvider: it has no 3D and never will, because
// OpenAI makes no models, no rigs and no retargets. It is the art half,
// and the split provider is what the pipeline sees.

import { GenerationError, type ProviderAsset } from './provider';

const GENERATE_URL = 'https://api.openai.com/v1/images/generations';
const EDIT_URL = 'https://api.openai.com/v1/images/edits';

// The same model Tripo resells, so switching providers changes the price
// and not the picture. gpt-image-1-mini exists and is a third of the cost
// (1.3 cents on the same prompt): it was measured and rejected, because
// it returned a half-body figure with the accent colour missed and a hand
// that did not survive being looked at, and an image that has to be
// rerolled twice is not cheaper than one that does not.
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

// Portrait, because the shared splash style asks for 3:4 (server/art.ts).
// The cost follows the pixels here, which it never did at Tripo's flat
// rate: 1024x1024 would be about a third fewer output tokens.
export const DEFAULT_SIZE = '1024x1536';
export const DEFAULT_QUALITY = 'medium';

// Dollars per million tokens, read from developers.openai.com/api/docs/
// pricing on 2026-09-06. Transcription of a published rate, like
// EMBER_PRICES is a transcription of measurement: when it moves, edit it
// here and re-run the numbers in docs/design/generation-costs.md.
export const OPENAI_IMAGE_RATES: Readonly<
  Record<string, { textIn: number; imageIn: number; imageOut: number }>
> = {
  'gpt-image-2': { textIn: 5, imageIn: 8, imageOut: 30 },
  'gpt-image-1-mini': { textIn: 2, imageIn: 2.5, imageOut: 8 },
};

export interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

// What a call cost, in cents. Cents because that is the unit the ledger
// calibrates against (ADR 0017: one ember is one cent) and because Tripo's
// own `consumed_credit` is already cents, so two providers report the same
// thing and the spend log needs no per-provider arithmetic.
export function costInCents(model: string, usage: ImageUsage | undefined): number | undefined {
  const rate = OPENAI_IMAGE_RATES[model];
  if (!rate || !usage) return undefined;
  const textIn = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  const imageOut = usage.output_tokens ?? 0;
  // dollars per million tokens to cents per token: divide by 10 000.
  return (textIn * rate.textIn + imageIn * rate.imageIn + imageOut * rate.imageOut) / 10_000;
}

export interface OpenAIImagesOptions {
  model?: string;
  size?: string;
  quality?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

// The art half of a split provider: text (and optionally one source
// image) to one PNG.
export interface ArtProvider {
  readonly id: string;
  // True when passing `image` performs instruction-guided EDITING that
  // preserves the character, rather than taking it as loose inspiration.
  // server/art.ts writes its prompts differently on this flag.
  readonly editsImages: boolean;
  generate2D(req: {
    prompt: string;
    image?: { data: Uint8Array; name: string };
    tPose?: boolean;
  }): Promise<ProviderAsset>;
}

export class OpenAIImages implements ArtProvider {
  readonly id = 'openai';
  // The edits endpoint keeps the input character and applies the prompt as
  // an instruction, which is the behaviour the flag names.
  readonly editsImages = true;
  private readonly model: string;
  private readonly size: string;
  private readonly quality: string;
  private readonly http: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly apiKey: string,
    options: OpenAIImagesOptions = {},
  ) {
    this.model = options.model || DEFAULT_IMAGE_MODEL;
    this.size = options.size || DEFAULT_SIZE;
    this.quality = options.quality || DEFAULT_QUALITY;
    this.http = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async generate2D(req: {
    prompt: string;
    image?: { data: Uint8Array; name: string };
    tPose?: boolean;
  }): Promise<ProviderAsset> {
    const body = req.image ? this.editBody(req.prompt, req.image) : this.createBody(req.prompt);
    const res = await this.http(req.image ? EDIT_URL : GENERATE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(req.image ? {} : { 'content-type': 'application/json' }),
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw asError(res.status, text);

    let parsed: { data?: { b64_json?: string }[]; usage?: ImageUsage; created?: number };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GenerationError('image generation returned something that was not JSON');
    }
    const b64 = parsed.data?.[0]?.b64_json;
    if (!b64) throw new GenerationError('image generation returned no image');

    const at = this.now();
    // No task id exists for an image here, and the pipeline stores this
    // one in provenance, so it names the call rather than pretending to a
    // handle that could be fetched again.
    const taskId = `openai-image-${at}-${b64.length}`;
    const cost = costInCents(this.model, parsed.usage);
    return {
      taskId,
      // A data URL, because the pipeline downloads the asset immediately
      // through one fetch and node's fetch reads data URLs. Nothing has to
      // learn that this provider hands back bytes rather than a link.
      url: `data:image/png;base64,${b64}`,
      provenance: { provider: this.id, model: this.model, at, taskId },
      ...(cost === undefined ? {} : { cost }),
    };
  }

  private createBody(prompt: string): string {
    return JSON.stringify({
      model: this.model,
      prompt,
      size: this.size,
      quality: this.quality,
      n: 1,
    });
  }

  private editBody(prompt: string, image: { data: Uint8Array; name: string }): FormData {
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', prompt);
    form.set('size', this.size);
    form.set('quality', this.quality);
    form.set('n', '1');
    // Copied into a plain ArrayBuffer: a Uint8Array can sit on a
    // SharedArrayBuffer, which Blob will not take.
    const bytes = new Uint8Array(image.data.byteLength);
    bytes.set(image.data);
    form.set('image', new Blob([bytes.buffer], { type: 'image/png' }), image.name || 'source.png');
    return form;
  }
}

// A refusal is a content block and must refund as one (ADR 0007); a 429 or
// a 5xx is the ordinary kind of failure. The moderation refusal comes back
// as 400 with a code naming it, so the code decides rather than the status.
function asError(status: number, body: string): GenerationError {
  let code = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
    code = parsed.error?.code ?? '';
    message = parsed.error?.message ?? '';
  } catch {
    message = body.slice(0, 200);
  }
  const blocked =
    status === 400 && /moderation|safety|content_policy|rejected/i.test(`${code} ${message}`);
  return new GenerationError(
    `image generation failed (${status}${code ? ` ${code}` : ''}): ${message.slice(0, 200)}`,
    blocked,
  );
}

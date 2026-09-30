// The terrain's pictures once the GPU holds them. The light map's 261
// textures decode to about 154 MB of bitmaps (38 MP at 4 bytes), the full
// map's to 1.2 GB, and from its upload on the GPU keeps a copy of its own:
// three.js reads a texture's picture again only to upload it again. So the
// renderer uploads every terrain texture before its first frame (which
// also spares the walk to lane the hitches of uploads made as the camera
// meets each one) and the decoded bitmaps are closed behind it. On a
// phone that is the difference between a tab that holds and one the
// system kills.
//
// One thing uploads again: a lost WebGL context, which takes the GPU's
// copies with it; three.js uploads everything once the browser gives the
// context back, so the pictures must be at hand again first. They are
// decoded again from the model's bytes, which the page keeps for its next
// match anyway (src/game/star_orchard.ts). A picture is closed only when
// it can be had back that way: an ImageBitmap whose bytes lie in the
// model, decoded the way GLTFLoader decoded it. Old Safari and old Firefox
// load plain images, which stay as they are.

import * as THREE from 'three';

// A texture's picture: the data it uploads from, shared by its clones.
type Picture = THREE.Texture['source'];

// Where a picture's bytes lie in the model, and their type.
export interface ImageSpan {
  offset: number;
  length: number;
  mimeType: string;
}

// The parts of a glTF's JSON read here.
export interface GltfImages {
  images?: { bufferView?: number; mimeType?: string }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength: number }[];
  buffers?: { uri?: string }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number } | undefined> }[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_HEADER = 12;
const CHUNK_HEADER = 8;
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

// Where the binary chunk of a GLB begins, or null for anything else.
export function glbBinOffset(glb: ArrayBuffer): number | null {
  if (glb.byteLength < GLB_HEADER) return null;
  const view = new DataView(glb);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  let at = GLB_HEADER;
  while (at + CHUNK_HEADER <= glb.byteLength) {
    const length = view.getUint32(at, true);
    if (view.getUint32(at + 4, true) === CHUNK_BIN) return at + CHUNK_HEADER;
    at += CHUNK_HEADER + length;
  }
  return null;
}

// Every image of the model, by its index: where its bytes lie, or null
// for one that is not in the binary chunk (a file beside it, a data URI).
export function glbImageSpans(glb: ArrayBuffer, json: GltfImages): (ImageSpan | null)[] {
  const bin = glbBinOffset(glb);
  return (json.images ?? []).map((image) => {
    if (bin === null || image.bufferView === undefined || !image.mimeType) return null;
    const view = json.bufferViews?.[image.bufferView];
    const buffer = view?.buffer ?? 0;
    // A GLB's own chunk is its first buffer, the one with no address.
    if (view === undefined || buffer !== 0 || json.buffers?.[0]?.uri !== undefined) return null;
    const offset = bin + (view.byteOffset ?? 0);
    if (offset + view.byteLength > glb.byteLength) return null;
    return { offset, length: view.byteLength, mimeType: image.mimeType };
  });
}

// The images a glTF texture may show, in the order GLTFLoader tries them:
// the WebP or AVIF extension's own source first, the plain source last.
export function textureImageCandidates(json: GltfImages, textureIndex: number): number[] {
  const def = json.textures?.[textureIndex];
  if (def === undefined) return [];
  const ext = def.extensions ?? {};
  const out: number[] = [];
  for (const source of [ext.EXT_texture_webp?.source, ext.EXT_texture_avif?.source, def.source]) {
    if (typeof source === 'number' && !out.includes(source)) out.push(source);
  }
  return out;
}

// The span of the image a loaded texture shows: the candidate of the type
// GLTFLoader recorded on the texture, or the only candidate when it
// recorded none. Null when that cannot be told, and the picture then
// stays decoded.
export function textureImageSpan(
  json: GltfImages,
  spans: readonly (ImageSpan | null)[],
  textureIndex: number,
  mimeType: unknown,
): ImageSpan | null {
  const candidates = textureImageCandidates(json, textureIndex);
  if (typeof mimeType === 'string') {
    for (const index of candidates) {
      const span = spans[index];
      if (span?.mimeType === mimeType) return span;
    }
    return null;
  }
  return candidates.length === 1 ? (spans[candidates[0]!] ?? null) : null;
}

// What GLTFLoader leaves on its parser that says which image each of its
// textures shows.
export interface ParsedTextures {
  json: GltfImages;
  associations: Iterable<[unknown, { textures?: number | undefined }]>;
}

// Each picture the parse made (a texture's Source, shared by its clones),
// and where its bytes lie in the model. A picture two textures disagree
// about is left out, and so never closed.
export function sourceSpans(parsed: ParsedTextures, glb: ArrayBuffer): Map<Picture, ImageSpan> {
  const spans = glbImageSpans(glb, parsed.json);
  const out = new Map<Picture, ImageSpan>();
  const unsure = new Set<Picture>();
  for (const [key, ref] of parsed.associations) {
    if (!(key instanceof THREE.Texture) || ref.textures === undefined) continue;
    const span = textureImageSpan(parsed.json, spans, ref.textures, key.userData.mimeType);
    const known = out.get(key.source);
    if (span === null || (known !== undefined && known.offset !== span.offset)) {
      unsure.add(key.source);
    } else {
      out.set(key.source, span);
    }
  }
  for (const source of unsure) out.delete(source);
  return out;
}

export type DecodeImage = (
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
) => Promise<ImageBitmap>;

// GLTFLoader's own decode, when it made bitmaps: its ImageBitmapLoader's
// options plus the color space setting that loader always adds, so a
// picture decoded again is the picture it made. Null when it loaded plain
// images (old Safari, old Firefox), whose pictures are never closed.
export function bitmapDecoder(loader: unknown): DecodeImage | null {
  const bitmaps = loader as { isImageBitmapLoader?: boolean; options?: ImageBitmapOptions } | null;
  if (bitmaps?.isImageBitmapLoader !== true || typeof createImageBitmap !== 'function') return null;
  const options: ImageBitmapOptions = { ...bitmaps.options, colorSpaceConversion: 'none' };
  return (bytes, mimeType) => createImageBitmap(new Blob([bytes], { type: mimeType }), options);
}

function isBitmap(data: unknown): data is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap;
}

export class TerrainImages {
  // The pictures closed, with where to decode each again from.
  private readonly closed = new Map<Picture, ImageSpan>();
  private restoring: Promise<void> | null = null;
  private disposed = false;

  constructor(
    // The model's bytes, which the page keeps for its next match.
    private readonly model: ArrayBuffer,
    private readonly textures: readonly THREE.Texture[],
    private readonly spans: ReadonlyMap<Picture, ImageSpan>,
    private readonly decode: DecodeImage | null,
  ) {}

  // Uploads every texture through `upload`, then closes each picture that
  // can be decoded again; how many it closed. Every upload comes first:
  // two textures can share one picture.
  release(upload: (texture: THREE.Texture) => void): number {
    // A restore that ends after the match did has nothing to upload to.
    if (this.disposed) return 0;
    for (const texture of this.textures) upload(texture);
    if (this.decode === null) return 0;
    let count = 0;
    for (const texture of this.textures) {
      const source = texture.source;
      const span = this.spans.get(source);
      const data: unknown = source.data;
      if (span === undefined || this.closed.has(source) || !isBitmap(data)) continue;
      data.close();
      this.closed.set(source, span);
      count++;
    }
    return count;
  }

  // How many pictures are closed right now.
  get closedCount(): number {
    return this.closed.size;
  }

  // Decodes every closed picture again, for the uploads a restored context
  // makes; the textures that show it are marked for upload. One pass at a
  // time however often it is asked, and one picture at a time, so the
  // memory the context was lost for is not asked for all at once.
  restore(): Promise<void> {
    this.restoring ??= this.decodeClosed().finally(() => {
      this.restoring = null;
    });
    return this.restoring;
  }

  private async decodeClosed(): Promise<void> {
    const decode = this.decode;
    if (decode === null) return;
    for (const [source, span] of [...this.closed]) {
      const bitmap = await decode(
        new Uint8Array(this.model, span.offset, span.length),
        span.mimeType,
      );
      if (this.disposed) {
        bitmap.close();
        return;
      }
      source.data = bitmap;
      this.closed.delete(source);
      for (const texture of this.textures)
        if (texture.source === source) texture.needsUpdate = true;
    }
  }

  // The terrain is gone: nothing decoded after this is kept.
  dispose(): void {
    this.disposed = true;
  }
}

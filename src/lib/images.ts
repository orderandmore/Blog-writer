import sharp from "sharp";
import { put, head, del } from "@vercel/blob";
import type { CropPosition } from "./schema";

/**
 * Image pipeline. Variant dimensions tuned for Patty's Kadence theme on
 * orderandmore.com (hero renders at ~1314×446 = 2.95:1, body images shown
 * around 600×600).
 *
 *   - Featured/hero: 1200×408 (≈ 2.95:1) — matches the theme's render
 *     aspect; theme won't have to crop.
 *   - Body: 1200×1200 — 2× the 600×600 render for retina headroom.
 *   - Social wide JPG: 1200×630 — Buffer (Facebook, LinkedIn) + GMB
 *   - Social square JPG: 1080×1080 — Buffer (Instagram)
 *
 * Scratch storage moved to Vercel Blob since Vercel's serverless filesystem
 * is read-only except for /tmp (which is ephemeral). Local dev still works
 * against the same Blob — set BLOB_READ_WRITE_TOKEN.
 */

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
  format: string;
}

/** Featured image: 1200×408 (≈2.95:1), WebP q85, cover crop, strip EXIF.
 * Matches the Kadence hero render aspect on orderandmore.com. */
export async function processFeaturedImage(
  input: Buffer,
  position: CropPosition = "centre",
): Promise<ProcessedImage> {
  const result = await sharp(input)
    .resize(1200, 408, { fit: "cover", position })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "webp",
  };
}

/** Body image: 1200×1200 square cover (or aspect-preserving), WebP q85. */
export async function processBodyImage(
  input: Buffer,
  preserveAspect = false,
  position: CropPosition = "centre",
): Promise<ProcessedImage> {
  const pipeline = sharp(input);
  if (preserveAspect) {
    pipeline.resize(1200, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    });
  } else {
    pipeline.resize(1200, 1200, { fit: "cover", position });
  }
  const result = await pipeline
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "webp",
  };
}

/** Social wide JPG: 1200×630 (Facebook, GMB) — Buffer-fed. */
export async function processSocialJpgImage(
  input: Buffer,
  position: CropPosition = "centre",
): Promise<ProcessedImage> {
  const result = await sharp(input)
    .resize(1200, 630, { fit: "cover", position })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "jpeg",
  };
}

/** Social square JPG: 1080×1080 (Instagram) — Buffer-fed. */
export async function processSocialSquareImage(
  input: Buffer,
  position: CropPosition = "centre",
): Promise<ProcessedImage> {
  const result = await sharp(input)
    .resize(1080, 1080, { fit: "cover", position })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "jpeg",
  };
}

/** Get metadata about an image buffer. */
export async function getImageInfo(input: Buffer) {
  const metadata = await sharp(input).metadata();
  return {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: metadata.format ?? "unknown",
    size: input.length,
  };
}

// ---------- Scratch storage (Vercel Blob) ----------
//
// Key namespace: `scratch/{draftId}/{imageId}`. Blob stores these as
// addByRandomSuffix=false so the key is stable across reads, and access=public
// so the wizard's <img> tags can load preview thumbnails directly without
// going through a signed-URL flow.

function scratchKey(draftId: string, imageId: string): string {
  return `scratch/${draftId}/${imageId}`;
}

export async function saveScratchImage(
  draftId: string,
  imageId: string,
  buffer: Buffer,
): Promise<string> {
  const key = scratchKey(draftId, imageId);
  // put() writes; the returned `url` is the public CDN URL we use for
  // <img src> in the wizard and to feed Buffer's `image.url` asset field.
  const blob = await put(key, buffer, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    // Sharp-produced buffers are already content-typed by extension hint in
    // the imageId (...-social.jpg, ...-processed for webp, etc.). Default
    // mime detection by Vercel Blob handles unrecognized cases.
  });
  return blob.url;
}

export async function readScratchImage(
  draftId: string,
  imageId: string,
): Promise<Buffer | null> {
  const key = scratchKey(draftId, imageId);
  try {
    // head() resolves to the metadata + url; we then GET the public URL.
    const info = await head(key);
    if (!info?.url) return null;
    const res = await fetch(info.url);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}

export async function scratchImageUrl(
  draftId: string,
  imageId: string,
): Promise<string | null> {
  try {
    const info = await head(scratchKey(draftId, imageId));
    return info?.url ?? null;
  } catch {
    return null;
  }
}

export async function cleanupScratch(draftId: string): Promise<void> {
  // Vercel Blob doesn't support prefix-deletion directly; the @vercel/blob
  // package exposes `list()` + `del()`. The list call can be paginated but
  // 50 entries is plenty for one draft's variants.
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `scratch/${draftId}/`, limit: 100 });
  if (blobs.length === 0) return;
  await del(blobs.map((b) => b.url));
}

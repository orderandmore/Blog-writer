import sharp from "sharp";
import { put, head, del } from "@vercel/blob";
import type { CropRect } from "./schema";

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
 * Each processor accepts an optional `CropRect` (normalized 0..1 fractions of
 * the source image). When provided, the rect is extracted first, then the
 * extracted region is resized to the target dimensions. When omitted, falls
 * back to a centered cover-fit on the full source.
 *
 * Scratch storage is on Vercel Blob since Vercel's serverless filesystem is
 * read-only except for /tmp (which is ephemeral). Local dev still works
 * against the same Blob — set BLOB_READ_WRITE_TOKEN.
 */

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  size: number;
  format: string;
}

/**
 * Apply the user's crop rect (if any) to a Sharp pipeline, then resize-cover
 * to the target dimensions. Clamps the rect to source bounds so an off-by-one
 * doesn't cause Sharp to throw.
 */
async function buildCroppedPipeline(
  input: Buffer,
  cropRect: CropRect | undefined,
  targetW: number,
  targetH: number,
): Promise<sharp.Sharp> {
  let pipeline = sharp(input);
  if (cropRect) {
    const meta = await sharp(input).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (srcW > 0 && srcH > 0) {
      const left = Math.max(0, Math.min(srcW - 1, Math.round(cropRect.x * srcW)));
      const top = Math.max(0, Math.min(srcH - 1, Math.round(cropRect.y * srcH)));
      let width = Math.max(1, Math.round(cropRect.width * srcW));
      let height = Math.max(1, Math.round(cropRect.height * srcH));
      width = Math.min(width, srcW - left);
      height = Math.min(height, srcH - top);
      if (width > 0 && height > 0) {
        pipeline = pipeline.extract({ left, top, width, height });
      }
    }
  }
  return pipeline.resize(targetW, targetH, { fit: "cover", position: "centre" });
}

/** Featured image: 1200×408 (≈2.95:1), WebP q85.
 * Uses cropRect when provided; matches Kadence hero render aspect. */
export async function processFeaturedImage(
  input: Buffer,
  cropRect?: CropRect,
): Promise<ProcessedImage> {
  const pipeline = await buildCroppedPipeline(input, cropRect, 1200, 408);
  const result = await pipeline.webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "webp",
  };
}

/** Body image: 1200×1200 square cover, WebP q85. */
export async function processBodyImage(
  input: Buffer,
  cropRect?: CropRect,
): Promise<ProcessedImage> {
  const pipeline = await buildCroppedPipeline(input, cropRect, 1200, 1200);
  const result = await pipeline.webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "webp",
  };
}

/** Social wide JPG: 1200×630 (Facebook, LinkedIn, GMB).
 * Reuses the featured cropRect — if the user picked a focal slice for the
 * hero, social variants stay centered on that same region. The aspect
 * mismatch (2.95:1 → 1.91:1) means a small additional center-crop happens,
 * which Sharp handles via the resize cover-fit at the end. */
export async function processSocialJpgImage(
  input: Buffer,
  cropRect?: CropRect,
): Promise<ProcessedImage> {
  const pipeline = await buildCroppedPipeline(input, cropRect, 1200, 630);
  const result = await pipeline.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: "jpeg",
  };
}

/** Social square JPG: 1080×1080 (Instagram). */
export async function processSocialSquareImage(
  input: Buffer,
  cropRect?: CropRect,
): Promise<ProcessedImage> {
  const pipeline = await buildCroppedPipeline(input, cropRect, 1080, 1080);
  const result = await pipeline.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
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

function scratchKey(draftId: string, imageId: string): string {
  return `scratch/${draftId}/${imageId}`;
}

export async function saveScratchImage(
  draftId: string,
  imageId: string,
  buffer: Buffer,
): Promise<string> {
  const key = scratchKey(draftId, imageId);
  const blob = await put(key, buffer, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return blob.url;
}

export async function readScratchImage(
  draftId: string,
  imageId: string,
): Promise<Buffer | null> {
  const key = scratchKey(draftId, imageId);
  try {
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
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: `scratch/${draftId}/`, limit: 100 });
  if (blobs.length === 0) return;
  await del(blobs.map((b) => b.url));
}

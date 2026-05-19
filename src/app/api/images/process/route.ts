import { NextRequest, NextResponse } from "next/server";
import {
  processFeaturedImage,
  processBodyImage,
  processSocialJpgImage,
  processSocialSquareImage,
  getImageInfo,
  saveScratchImage,
} from "@/lib/images";
import { sanitizeImageName } from "@/lib/slug";
import type { CropRect, ImageMeta } from "@/lib/schema";
import { createDraft } from "@/lib/db";

function parseCropRect(raw: string | undefined): CropRect | undefined {
  if (!raw || raw === "null" || raw === "undefined") return undefined;
  try {
    const v = JSON.parse(raw) as Partial<CropRect>;
    if (
      typeof v.x === "number" &&
      typeof v.y === "number" &&
      typeof v.width === "number" &&
      typeof v.height === "number" &&
      v.width > 0 &&
      v.height > 0
    ) {
      return {
        x: Math.max(0, Math.min(1, v.x)),
        y: Math.max(0, Math.min(1, v.y)),
        width: Math.max(0, Math.min(1, v.width)),
        height: Math.max(0, Math.min(1, v.height)),
      };
    }
  } catch {
    // Fall through — undefined means server uses centered default
  }
  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const rawDraftId = (formData.get("draftId") as string | null) ?? "";
    const draftId =
      !rawDraftId || rawDraftId === "temp" ? await createDraft() : rawDraftId;
    const slug = (formData.get("slug") as string) || "post";

    const imageFiles = formData.getAll("images") as File[];
    const imageTypes = formData.getAll("imageTypes") as string[];
    const imageFilenames = formData.getAll("imageFilenames") as string[];
    const imageCropRects = formData.getAll("imageCropRects") as string[];

    if (imageFiles.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const processedImages: ImageMeta[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const type = (imageTypes[i] || "body") as "featured" | "body";
      const cropRect = parseCropRect(imageCropRects[i]);
      const buffer = Buffer.from(await file.arrayBuffer());
      const imgId = `img-${i}`;

      const info = await getImageInfo(buffer);

      const seoName = (imageFilenames[i] || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\-_]/g, "");
      const cleanName = seoName
        ? `${seoName}.webp`
        : sanitizeImageName(file.name, slug);
      const repoPath = `/uploads/${cleanName}`;

      let processed;
      if (type === "featured") {
        processed = await processFeaturedImage(buffer, cropRect);

        // Buffer-fed JPG variants. Stay in scratch, never uploaded to WP.
        // Reuse the same cropRect so social variants stay centered on the
        // user's focal slice (further cover-cropped to their own aspect).
        const socialJpg = await processSocialJpgImage(buffer, cropRect);
        await saveScratchImage(draftId, `${imgId}-social.jpg`, socialJpg.buffer);

        const socialSquare = await processSocialSquareImage(buffer, cropRect);
        await saveScratchImage(draftId, `${imgId}-social-square.jpg`, socialSquare.buffer);
      } else {
        processed = await processBodyImage(buffer, cropRect);
      }

      await saveScratchImage(draftId, `${imgId}-processed`, processed.buffer);

      processedImages.push({
        id: imgId,
        originalName: file.name,
        type,
        originalWidth: info.width,
        originalHeight: info.height,
        originalSize: info.size,
        processedName: cleanName,
        processedWidth: processed.width,
        processedHeight: processed.height,
        processedSize: processed.size,
        repoPath,
        processed: true,
        cropRect,
      });
    }

    return NextResponse.json({
      draftId,
      images: processedImages,
    });
  } catch (err) {
    console.error("Image processing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 },
    );
  }
}

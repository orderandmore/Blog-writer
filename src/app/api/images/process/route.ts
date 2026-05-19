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
import {
  CROP_POSITIONS,
  type CropPosition,
  type ImageMeta,
} from "@/lib/schema";
import { createDraft } from "@/lib/db";

function coercePosition(raw: string | undefined): CropPosition {
  if (raw && (CROP_POSITIONS as readonly string[]).includes(raw)) {
    return raw as CropPosition;
  }
  return "centre";
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
    const imagePositions = formData.getAll("imagePositions") as string[];

    if (imageFiles.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const processedImages: ImageMeta[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const type = (imageTypes[i] || "body") as "featured" | "body";
      const cropPosition = coercePosition(imagePositions[i]);
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
      // repoPath is kept as a stable display value but is NOT the publish
      // path anymore — WP returns its own attachment URL on upload.
      const repoPath = `/uploads/${cleanName}`;

      let processed;
      if (type === "featured") {
        processed = await processFeaturedImage(buffer, cropPosition);

        // Buffer-fed JPG variants. Stay in scratch, never uploaded to WP.
        // Wide (1200×630) covers Facebook, LinkedIn, GMB.
        // Square (1080×1080) covers Instagram.
        const socialJpg = await processSocialJpgImage(buffer, cropPosition);
        await saveScratchImage(draftId, `${imgId}-social.jpg`, socialJpg.buffer);

        const socialSquare = await processSocialSquareImage(buffer, cropPosition);
        await saveScratchImage(draftId, `${imgId}-social-square.jpg`, socialSquare.buffer);
      } else {
        processed = await processBodyImage(buffer, false, cropPosition);
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
        cropPosition,
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

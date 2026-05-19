import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { CROP_POSITIONS, type CropPosition } from "@/lib/schema";

type Format = "webp" | "jpeg" | "png";

const PRESETS: Record<
  string,
  { width: number; height: number; format: Format; quality: number }
> = {
  featured: { width: 1200, height: 800, format: "webp", quality: 85 },
  body: { width: 1200, height: 800, format: "webp", quality: 85 },
  social: { width: 1200, height: 630, format: "jpeg", quality: 88 },
  "social-square": { width: 1080, height: 1080, format: "jpeg", quality: 88 },
  pinterest: { width: 1000, height: 1500, format: "jpeg", quality: 88 },
};

function coercePosition(raw: string | null): CropPosition {
  if (raw && (CROP_POSITIONS as readonly string[]).includes(raw)) {
    return raw as CropPosition;
  }
  return "centre";
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function extFor(format: Format): string {
  return format === "jpeg" ? "jpg" : format;
}

function mimeFor(format: Format): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}

function sanitizeBaseName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "image";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const preset = (formData.get("preset") as string | null) ?? "custom";
    const position = coercePosition(formData.get("position") as string | null);
    const fitRaw = (formData.get("fit") as string | null) ?? "cover";
    const fit: "cover" | "contain" | "inside" =
      fitRaw === "contain" || fitRaw === "inside" ? fitRaw : "cover";
    const filenameRaw = (formData.get("filename") as string | null) ?? "image";

    let width: number;
    let height: number;
    let format: Format;
    let quality: number;

    if (preset !== "custom" && PRESETS[preset]) {
      ({ width, height, format, quality } = PRESETS[preset]);
    } else {
      width = clampInt(Number(formData.get("width")), 16, 8000);
      height = clampInt(Number(formData.get("height")), 16, 8000);
      const fmtRaw = (formData.get("format") as string | null) ?? "webp";
      format =
        fmtRaw === "jpeg" || fmtRaw === "jpg"
          ? "jpeg"
          : fmtRaw === "png"
            ? "png"
            : "webp";
      quality = clampInt(Number(formData.get("quality") ?? 85), 1, 100);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const pipeline = sharp(buffer).resize(width, height, { fit, position });

    if (format === "webp") pipeline.webp({ quality });
    else if (format === "jpeg") pipeline.jpeg({ quality });
    else pipeline.png({ compressionLevel: 9 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    const ext = extFor(format);
    const base = sanitizeBaseName(filenameRaw);
    const downloadName = `${base}.${ext}`;

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mimeFor(format),
        "Content-Length": String(info.size),
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "X-Output-Width": String(info.width),
        "X-Output-Height": String(info.height),
        "X-Output-Size": String(info.size),
        "X-Output-Filename": downloadName,
      },
    });
  } catch (err) {
    console.error("Standalone image processing error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 },
    );
  }
}

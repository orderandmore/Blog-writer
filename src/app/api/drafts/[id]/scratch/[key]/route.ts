import { NextRequest, NextResponse } from "next/server";
import { readScratchImage } from "@/lib/images";

type Ctx = { params: Promise<{ id: string; key: string }> };

// Path components are validated so a draftId/key can't escape the scratch
// namespace in Vercel Blob.
const SAFE_RE = /^[a-zA-Z0-9._-]+$/;

function contentTypeFor(key: string): string {
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  return "image/webp";
}

export async function GET(req: NextRequest, context: Ctx) {
  const { id, key } = await context.params;
  if (!SAFE_RE.test(id) || !SAFE_RE.test(key)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const buffer = await readScratchImage(id, key);
  if (!buffer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const download = req.nextUrl.searchParams.get("download");
  const headers: Record<string, string> = {
    "Content-Type": contentTypeFor(key),
    "Content-Length": String(buffer.length),
    "Cache-Control": "private, max-age=60",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
  }

  return new NextResponse(new Uint8Array(buffer), { headers });
}

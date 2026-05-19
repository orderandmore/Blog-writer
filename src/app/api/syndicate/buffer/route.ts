import { NextRequest, NextResponse } from "next/server";
import { getDraft, recordBufferSubmission } from "@/lib/db";
import { destinations } from "@/config/destinations";
import { createBufferPost, findChannelId } from "@/lib/buffer";
import { scratchImageUrl } from "@/lib/images";
import type { ImageMeta } from "@/lib/schema";

/**
 * Push a single destination's text + image to Buffer's queue.
 *
 * Unlike the parent project, we no longer require the post to be published
 * first — Buffer fetches the image from the Vercel Blob URL of our scratch
 * variant directly. That URL is public-readable and stable for the life of
 * the draft.
 */
export async function POST(request: NextRequest) {
  try {
    const { draftId, destinationId, text } = (await request.json()) as {
      draftId?: string;
      destinationId?: string;
      text?: string;
    };

    if (!draftId || !destinationId || typeof text !== "string") {
      return NextResponse.json(
        { error: "draftId, destinationId, and text are required" },
        { status: 400 },
      );
    }

    const dest = destinations.find((d) => d.id === destinationId);
    if (!dest || !dest.bufferService) {
      return NextResponse.json(
        { error: `Destination ${destinationId} is not configured for Buffer` },
        { status: 400 },
      );
    }

    const draft = await getDraft(draftId);
    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Empty post text" }, { status: 400 });
    }
    if (dest.maxChars && trimmed.length > dest.maxChars) {
      return NextResponse.json(
        {
          error: `Text exceeds ${dest.name} limit of ${dest.maxChars} chars (got ${trimmed.length}).`,
        },
        { status: 400 },
      );
    }

    const imageUrl = await resolveImageUrl(draft, dest.socialImageVariant);
    if (!imageUrl) {
      return NextResponse.json(
        {
          error:
            "No featured image available. Add and process a featured image in Step 2.",
        },
        { status: 400 },
      );
    }

    const channelId = await findChannelId(dest.bufferService);
    if (!channelId) {
      return NextResponse.json(
        {
          error: `No Buffer channel connected for ${dest.bufferService}. Connect it in your Buffer dashboard.`,
        },
        { status: 400 },
      );
    }

    const result = await createBufferPost({
      channelId,
      text: trimmed,
      imageUrl,
      service: dest.bufferService,
    });

    await recordBufferSubmission(draftId, destinationId, result.id);

    return NextResponse.json({ ok: true, bufferPostId: result.id, imageUrl });
  } catch (err) {
    console.error("Buffer syndication error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Buffer submission failed" },
      { status: 500 },
    );
  }
}

async function resolveImageUrl(
  draft: Record<string, unknown>,
  variant: "wide" | "square" | undefined,
): Promise<string | null> {
  const imagesRaw = draft.images;
  if (typeof imagesRaw !== "string") return null;
  let images: ImageMeta[];
  try {
    images = JSON.parse(imagesRaw) as ImageMeta[];
  } catch {
    return null;
  }
  const featured = images.find((i) => i.type === "featured" && i.processed);
  if (!featured) return null;

  const draftId = draft.id as string;
  const key =
    variant === "square"
      ? `${featured.id}-social-square.jpg`
      : `${featured.id}-social.jpg`;
  return await scratchImageUrl(draftId, key);
}

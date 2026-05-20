import { NextRequest, NextResponse } from "next/server";
import { getDraft, recordBufferSubmission } from "@/lib/db";
import { destinations } from "@/config/destinations";
import { createBufferPost, findChannelId, type BufferMode } from "@/lib/buffer";
import { getPost } from "@/lib/wordpress";
import { scratchImageUrl } from "@/lib/images";
import type { ImageMeta } from "@/lib/schema";

// Buffer scheduling, relative to the WP article's actual go-live: fire the
// first social a full day after the article publishes, then stagger each
// channel. The 1-day lead keeps socials safely after go-live even if Buffer's
// account timezone display differs from the WP/site timezone by a few hours
// (the source of the sub-day skew seen in testing).
const BUFFER_LEAD_MS = 24 * 60 * 60 * 1000; // 1 day after the article is live
const BUFFER_STAGGER_MS = 30 * 60 * 1000; // 30 min between channels

/**
 * Push a single destination's text + image to Buffer.
 *
 * The Buffer mode/timing is resolved from the WordPress post's LIVE state
 * (looked up by the draft's wp_post_id), not from client-supplied state which
 * can be stale on a re-send:
 *   - WP published  → add to queue (article link already resolves)
 *   - WP scheduled  → schedule the social after the post's real date_gmt
 *   - WP draft      → save as a Buffer draft
 * `mode`/`scheduledAt` in the body are only a fallback for the rare case where
 * the draft has no wp_post_id yet.
 *
 * Buffer fetches the image from the Vercel Blob URL of our scratch variant
 * directly (public-readable, stable for the life of the draft).
 */
export async function POST(request: NextRequest) {
  try {
    const { draftId, destinationId, text, mode, scheduledAt, staggerIndex } =
      (await request.json()) as {
        draftId?: string;
        destinationId?: string;
        text?: string;
        mode?: BufferMode;
        scheduledAt?: string;
        staggerIndex?: number;
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

    // Resolve mode + timing from the live WP post (source of truth), falling
    // back to the client-supplied values only if there's no WP post yet.
    let resolvedMode: BufferMode = mode ?? "queue";
    let dueAt: string | undefined = scheduledAt;
    const idx =
      typeof staggerIndex === "number" && staggerIndex > 0 ? staggerIndex : 0;
    const wpPostId = draft.wp_post_id as number | null | undefined;

    if (wpPostId) {
      try {
        const post = await getPost(wpPostId);
        if (post.status === "future") {
          // Still scheduled — schedule the social after the article's real
          // go-live, clamped to "now" so a late re-send stays in the future.
          resolvedMode = "scheduled";
          const anchorMs = parseWpGmt(post.date_gmt);
          const baseMs =
            (Number.isNaN(anchorMs)
              ? Date.now()
              : Math.max(anchorMs, Date.now())) + BUFFER_LEAD_MS;
          dueAt = new Date(baseMs + idx * BUFFER_STAGGER_MS).toISOString();
        } else if (post.status === "publish") {
          // Already live — the link resolves, so just add to the queue.
          resolvedMode = "queue";
          dueAt = undefined;
        } else {
          // draft / pending / private — keep it as a Buffer draft.
          resolvedMode = "draft";
          dueAt = undefined;
        }
      } catch (e) {
        console.error(
          "WP status lookup failed; using client-provided Buffer mode:",
          e,
        );
      }
    }

    // Scheduled requested but no time available (no WP post + no client time):
    // fall back to the queue rather than failing.
    if (resolvedMode === "scheduled" && !dueAt) resolvedMode = "queue";

    const result = await createBufferPost({
      channelId,
      text: trimmed,
      imageUrl,
      service: dest.bufferService,
      mode: resolvedMode,
      scheduledAt: dueAt,
    });

    await recordBufferSubmission(draftId, destinationId, result.id);

    return NextResponse.json({
      ok: true,
      bufferPostId: result.id,
      imageUrl,
      mode: resolvedMode,
      scheduledAt: resolvedMode === "scheduled" ? dueAt : undefined,
    });
  } catch (err) {
    console.error("Buffer syndication error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Buffer submission failed" },
      { status: 500 },
    );
  }
}

/** Parse a WP GMT datetime (no tz designator) as UTC → epoch ms. */
function parseWpGmt(s: string | undefined): number {
  if (!s) return NaN;
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  return new Date(hasTz ? s : `${s}Z`).getTime();
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

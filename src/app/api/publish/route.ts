import { NextRequest, NextResponse } from "next/server";
import { postMetaSchema, type PostMeta, type ImageMeta } from "@/lib/schema";
import { renderMarkdown } from "@/lib/markdown";
import { readScratchImage } from "@/lib/images";
import {
  createPost,
  uploadMedia,
  adminEditUrl,
  resolveTagIds,
  type CreatePostInput,
} from "@/lib/wordpress";
import { detectSeoPlugin, buildSeoMeta } from "@/lib/seo-plugin";
import { updateDraft } from "@/lib/db";

/**
 * Publish a draft to WordPress.
 *
 * Flow:
 *   1. Validate the postMeta the wizard sends.
 *   2. Render markdown body → HTML.
 *   3. Upload featured + body images to WP /wp/v2/media (multipart), keep
 *      a map { localId -> { id, sourceUrl } }.
 *   4. Rewrite img src attributes in the rendered HTML so they point at WP
 *      attachment URLs (the originals reference local scratch keys).
 *   5. Detect Yoast/RankMath and translate SEO fields to plugin meta keys
 *      (or fall back to the native excerpt).
 *   6. POST the post via /wp/v2/posts with status="draft" (or whatever the
 *      wizard requested).
 *   7. Record wp_post_id + wp_link on the draft row.
 *   8. Return { wpPostId, wpLink, editUrl }.
 *
 * Social-variant JPGs (1200×630, 1080×1080, 1000×1500) stay in scratch;
 * they're fetched from there during Buffer syndication.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, postMeta, body: markdownBody, images, draftId } = body as {
      slug: string;
      postMeta: Partial<PostMeta>;
      body: string;
      images: ImageMeta[];
      draftId: string | null;
    };

    const validation = postMetaSchema.safeParse({
      title: postMeta.title || "",
      description: postMeta.description || "",
      pubDate: postMeta.pubDate || new Date().toISOString(),
      categoryIds: postMeta.categoryIds || [],
      tags: postMeta.tags || [],
      featuredImage: postMeta.featuredImage,
      featuredImageAlt: postMeta.featuredImageAlt,
      status: postMeta.status || "draft",
      seoTitle: postMeta.seoTitle,
      seoDescription: postMeta.seoDescription,
      focusKeyword: postMeta.focusKeyword,
    });
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid post metadata", details: validation.error.issues },
        { status: 400 },
      );
    }
    const meta = validation.data;

    if (images.length > 0 && !draftId) {
      return NextResponse.json(
        {
          error:
            "Cannot publish images without a draftId. Re-run image processing in Step 2 so a draft is created first.",
        },
        { status: 400 },
      );
    }

    // 2. Render markdown → HTML
    let html = await renderMarkdown(markdownBody);

    // 3. Upload images to WP media library. Track id→sourceUrl so we can
    //    rewrite <img src> in the HTML, and pick out the featured image ID.
    const uploaded: Record<
      string,
      { wpId: number; sourceUrl: string; localPath: string }
    > = {};
    let featuredMediaId: number | undefined;

    for (const img of images) {
      if (!img.processed || !draftId) continue;
      const buffer = await readScratchImage(draftId, `${img.id}-processed`);
      if (!buffer) continue;

      const alt =
        img.type === "featured"
          ? meta.featuredImageAlt || meta.title
          : img.originalName.replace(/\.[^.]+$/, "");

      const result = await uploadMedia(buffer, {
        filename: img.processedName,
        mime: "image/webp",
        alt,
        title: img.processedName.replace(/\.webp$/, "").replace(/-/g, " "),
      });

      uploaded[img.id] = {
        wpId: result.id,
        sourceUrl: result.sourceUrl,
        localPath: img.repoPath,
      };

      if (img.type === "featured" && featuredMediaId === undefined) {
        featuredMediaId = result.id;
      }
    }

    // 4. Rewrite <img src="/uploads/..."> in the rendered HTML to point at
    //    WP attachment URLs. We match by the localPath we minted in the
    //    process step.
    for (const id of Object.keys(uploaded)) {
      const { sourceUrl, localPath } = uploaded[id];
      const escaped = localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(escaped, "g"), sourceUrl);
    }

    // 5. SEO plugin detection + meta key mapping.
    const seoConfig = await detectSeoPlugin();
    const seoMeta = buildSeoMeta(seoConfig, {
      description: meta.seoDescription || meta.description,
      title: meta.seoTitle,
      focusKeyword: meta.focusKeyword,
    });

    // 6. Convert tag names → integer IDs (WP REST requires integers).
    //    resolveTagIds() looks up existing tags by name/slug, creating any
    //    that don't exist yet.
    const tagIds = await resolveTagIds(meta.tags);

    // 7. Build + send the WP create-post request.
    //
    // For scheduled posts, send the UTC instant as `date_gmt`. WP expects a
    // GMT datetime WITHOUT a timezone designator (no trailing "Z" and no
    // milliseconds) — passing the raw toISOString() form ("…000Z") makes some
    // WP versions misparse it and shift the publish time. Normalize to
    // "YYYY-MM-DDTHH:MM:SS". WP derives the site-local `date` from this.
    const scheduledGmt =
      meta.status === "future"
        ? new Date(meta.pubDate).toISOString().replace(/\.\d{3}Z$/, "")
        : undefined;
    const postInput: CreatePostInput = {
      title: meta.title,
      content: html,
      excerpt: meta.description,
      slug,
      status: meta.status === "future" ? "future" : meta.status,
      date_gmt: scheduledGmt,
      categories: meta.categoryIds,
      tags: tagIds,
      featured_media: featuredMediaId,
    };
    if (Object.keys(seoMeta).length > 0) {
      postInput.meta = seoMeta;
    }

    const created = await createPost(postInput);

    // 8. Persist WP IDs + the authoritative go-live time on the draft. We use
    //    WP's echoed date_gmt (not what we sent) so Buffer scheduling — even a
    //    re-send in a later session — anchors to the real publish instant.
    if (draftId) {
      await updateDraft(draftId, {
        status: "published",
        wp_post_id: created.id,
        wp_link: created.link,
        wp_status: created.status,
        wp_scheduled_gmt: created.date_gmt ?? null,
      });
    }

    // 9. Return what the wizard needs to render the success state, deep-link to
    //    her WP admin, and anchor Buffer scheduling to WP's real go-live time.
    return NextResponse.json({
      wpPostId: created.id,
      wpLink: created.link,
      wpStatus: created.status,
      wpDateGmt: created.date_gmt ?? null,
      editUrl: adminEditUrl(created.id),
      seoPlugin: seoConfig.plugin,
      uploadedImageCount: Object.keys(uploaded).length,
    });
  } catch (err) {
    console.error("Publish error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Publish failed" },
      { status: 500 },
    );
  }
}

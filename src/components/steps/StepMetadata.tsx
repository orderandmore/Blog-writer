"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useWizard } from "../WizardProvider";
import { generateSlug } from "@/lib/slug";
import { copyToClipboard } from "@/lib/clipboard";
import type { ClientImage } from "@/lib/wizard-store";

// Author dropdown was removed — WP infers the author from the authenticated
// user (set via WP_USERNAME). Multi-author support would re-introduce a
// dropdown that fetches /wp/v2/users.

interface CategoryOption {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export function StepMetadata() {
  const { state, dispatch } = useWizard();
  const fm = state.postMeta;

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [existingSlugs, setExistingSlugs] = useState<string[]>([]);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [regeneratingField, setRegeneratingField] = useState<string | null>(
    null,
  );

  // Fetch authors, categories, and existing slugs
  useEffect(() => {
    fetch("/api/wp/categories")
      .then((r) => r.json())
      .then((j) => setCategories(j.categories || []))
      .catch(() => setCategories([]));

    fetch("/api/wp/slugs")
      .then((r) => r.json())
      .then((j) => setExistingSlugs(j.slugs || []))
      .catch(() => {});
  }, []);

  // Auto-fire AI metadata generation on first visit to this step
  useEffect(() => {
    if (!state.metadataAiDone && state.rawMarkdown && !state.metadataAiLoading) {
      generateMetadataBatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateMetadataBatch = useCallback(async () => {
    if (!state.rawMarkdown) return;

    dispatch({ type: "SET_METADATA_AI_LOADING", loading: true });

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "metadata-batch",
          title: fm.title || state.parsedTitle || "",
          body: state.parsedBody,
          categories: fm.categoryIds || [],
        }),
      });

      if (!response.ok) throw new Error("AI generation failed");
      const result = await response.json();

      if (result.data) {
        const updates: Record<string, unknown> = {};
        if (result.data.description && !fm.description) {
          updates.description = result.data.description;
        }
        if (result.data.seoTitle && !fm.seoTitle) {
          updates.seoTitle = result.data.seoTitle;
        }
        if (result.data.seoDescription && !fm.seoDescription) {
          updates.seoDescription = result.data.seoDescription;
        }
        if (
          result.data.tags &&
          Array.isArray(result.data.tags) &&
          (!fm.tags || fm.tags.length === 0)
        ) {
          updates.tags = result.data.tags;
        }

        if (Object.keys(updates).length > 0) {
          dispatch({ type: "UPDATE_POST_META", fields: updates });
        }
      }

      dispatch({ type: "SET_METADATA_AI_DONE" });
    } catch {
      dispatch({ type: "SET_METADATA_AI_LOADING", loading: false });
    }
  }, [state.rawMarkdown, state.parsedBody, state.parsedTitle, fm, dispatch]);

  const regenerateField = useCallback(
    async (field: "description" | "seoTitle" | "seoDescription" | "tags") => {
      setRegeneratingField(field);
      try {
        const response = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field,
            title: fm.title || state.parsedTitle || "",
            body: state.parsedBody,
            categories: fm.categoryIds || [],
          }),
        });

        if (!response.ok) throw new Error("Regeneration failed");
        const result = await response.json();

        if (field === "tags") {
          dispatch({
            type: "UPDATE_POST_META",
            fields: { tags: result.data },
          });
        } else {
          dispatch({
            type: "UPDATE_POST_META",
            fields: { [field]: result.data },
          });
        }
      } catch {
        // Silent fail
      } finally {
        setRegeneratingField(null);
      }
    },
    [fm, state.parsedBody, state.parsedTitle, dispatch],
  );

  const slug = slugManuallyEdited
    ? (fm as Record<string, unknown>)["_slug"] as string || ""
    : generateSlug(fm.title || "");
  const isDuplicate = slug ? existingSlugs.includes(slug) : false;
  const pubDate = fm.pubDate || new Date().toISOString();
  // WP assigns the final permalink at publish time. We show the slug only
  // as a hint here — the wizard's review step shows the real URL after
  // /api/publish returns.
  const urlPreview = slug ? `/${slug}/` : "";

  function update(field: string, value: unknown) {
    dispatch({
      type: "UPDATE_POST_META",
      fields: { [field]: value } as Record<string, unknown>,
    });
  }

  function toggleCategory(catId: number) {
    const current = fm.categoryIds || [];
    const updated = current.includes(catId)
      ? current.filter((c) => c !== catId)
      : [...current, catId];
    update("categoryIds", updated);
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const value = (e.target as HTMLInputElement).value.trim();
      if (value && !(fm.tags || []).includes(value)) {
        update("tags", [...(fm.tags || []), value]);
        (e.target as HTMLInputElement).value = "";
      }
    }
  }

  function removeTag(tag: string) {
    update(
      "tags",
      (fm.tags || []).filter((t) => t !== tag),
    );
  }

  const isLoading = state.metadataAiLoading;
  const bodyImages = state.images.filter((i) => i.type === "body" && i.processed);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white mb-1">Metadata</h2>
          <p className="text-sm text-[var(--muted)]">
            AI has pre-filled SEO fields. Review and edit as needed.
          </p>
        </div>
        {isLoading && (
          <span className="text-xs text-[var(--accent)] animate-pulse">
            AI generating...
          </span>
        )}
      </div>

      {/* Article body + body-image insertion */}
      <ArticleBodyEditor bodyImages={bodyImages} pubDate={pubDate} />

      {/* Title */}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-sm font-medium">Title *</label>
          <span
            className={`text-xs ${(fm.title?.length || 0) >= 50 && (fm.title?.length || 0) <= 70 ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
          >
            {fm.title?.length || 0} chars (50-70 ideal)
          </span>
        </div>
        <input
          type="text"
          value={fm.title || ""}
          onChange={(e) => update("title", e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)]"
        />
      </div>

      {/* Slug */}
      <div>
        <label className="text-sm font-medium mb-1 block">Slug</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugManuallyEdited(true);
              update("_slug", e.target.value);
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm font-mono focus:outline-none focus:border-[var(--primary)]"
          />
          {slugManuallyEdited && (
            <button
              onClick={() => setSlugManuallyEdited(false)}
              className="text-xs text-[var(--primary)] px-2"
            >
              Auto
            </button>
          )}
        </div>
        {isDuplicate && (
          <p className="text-xs text-[var(--danger)] mt-1">
            A post with this slug already exists.
          </p>
        )}
        {urlPreview && (
          <p className="text-xs text-[var(--muted)] mt-1">
            URL: https://orderandmore.com{urlPreview}
          </p>
        )}
      </div>

      {/* Publish Date (author comes from the authenticated WP user) */}
      <div>
        <label className="text-sm font-medium mb-1 block">
          Publish Date *
        </label>
        <input
          type="datetime-local"
          value={
            fm.pubDate
              ? new Date(fm.pubDate).toISOString().slice(0, 16)
              : new Date().toISOString().slice(0, 16)
          }
          onChange={(e) =>
            update("pubDate", new Date(e.target.value).toISOString())
          }
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)]"
        />
        <p className="text-xs text-[var(--muted)] mt-1">
          Author: Patty Powers (from WP_USERNAME)
        </p>
      </div>

      {/* Categories */}
      <div>
        <label className="text-sm font-medium mb-2 block">Categories</label>
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                (fm.categoryIds || []).includes(cat.id)
                  ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                  : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)]"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tags (AI pre-filled) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Tags</label>
          <button
            onClick={() => regenerateField("tags")}
            disabled={regeneratingField === "tags"}
            className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 disabled:opacity-50"
          >
            {regeneratingField === "tags" ? "..." : "Regenerate"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {(fm.tags || []).map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 rounded bg-[var(--accent)]/20 text-[var(--accent)] flex items-center gap-1"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-white"
              >
                x
              </button>
            </span>
          ))}
          {isLoading && (fm.tags || []).length === 0 && (
            <span className="text-xs text-[var(--muted)] animate-pulse">
              AI suggesting tags...
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="Type a tag and press Enter"
          onKeyDown={handleTagKeyDown}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)]"
        />
      </div>

      {/* Description (AI pre-filled) */}
      <AiField
        label="Description *"
        hint="150-160 chars"
        value={fm.description || ""}
        charCount={fm.description?.length || 0}
        charTarget={[150, 160]}
        onChange={(v) => update("description", v)}
        onRegenerate={() => regenerateField("description")}
        isRegenerating={regeneratingField === "description"}
        isLoading={isLoading && !fm.description}
        multiline
      />

      {/* SEO Title (AI pre-filled) */}
      <AiField
        label="SEO Title"
        hint="50-60 chars"
        value={fm.seoTitle || ""}
        charCount={fm.seoTitle?.length || 0}
        charTarget={[50, 60]}
        onChange={(v) => update("seoTitle", v)}
        onRegenerate={() => regenerateField("seoTitle")}
        isRegenerating={regeneratingField === "seoTitle"}
        isLoading={isLoading && !fm.seoTitle}
      />

      {/* SEO Description (AI pre-filled) */}
      <AiField
        label="SEO Description"
        hint="150-160 chars"
        value={fm.seoDescription || ""}
        charCount={fm.seoDescription?.length || 0}
        charTarget={[150, 160]}
        onChange={(v) => update("seoDescription", v)}
        onRegenerate={() => regenerateField("seoDescription")}
        isRegenerating={regeneratingField === "seoDescription"}
        isLoading={isLoading && !fm.seoDescription}
        multiline
      />

      {/* Featured Image Alt */}
      <div>
        <label className="text-sm font-medium mb-1 block">
          Featured Image Alt Text
        </label>
        <input
          type="text"
          value={fm.featuredImageAlt || ""}
          onChange={(e) => update("featuredImageAlt", e.target.value)}
          placeholder="Describe the featured image for accessibility"
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
        />
      </div>

      {/* Draft toggle */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Draft mode</label>
        <button
          onClick={() => update("status", fm.status === "draft" ? "publish" : "draft")}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            (fm.status === "draft") ? "bg-[var(--warning)]" : "bg-[var(--border)]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              (fm.status === "draft") ? "translate-x-5" : ""
            }`}
          />
        </button>
        <span className="text-xs text-[var(--muted)]">
          {(fm.status === "draft") ? "Post will be saved as draft" : "Post will be published"}
        </span>
      </div>
    </div>
  );
}

function ArticleBodyEditor({
  bodyImages,
  pubDate,
}: {
  bodyImages: ClientImage[];
  pubDate: string;
}) {
  const { state, dispatch } = useWizard();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function insertAtCursor(snippet: string) {
    const ta = textareaRef.current;
    const current = state.parsedBody;
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    // Pad with blank lines unless the adjacent content already has them.
    const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const insertion = `${lead}${snippet}${trail}`;
    const next = before + insertion + after;
    dispatch({ type: "UPDATE_PARSED_BODY", body: next });

    // Restore focus with cursor placed after the inserted block.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = before.length + insertion.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium">Article body</label>
        <span className="text-xs text-[var(--muted)]">
          {state.wordCount.toLocaleString()} words · {state.readingTime} min read
        </span>
      </div>
      <div className="grid grid-cols-[1fr_260px] gap-3">
        <textarea
          ref={textareaRef}
          value={state.parsedBody}
          onChange={(e) =>
            dispatch({ type: "UPDATE_PARSED_BODY", body: e.target.value })
          }
          rows={14}
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] resize-y"
        />
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Body images
          </p>
          {bodyImages.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Process images in Step 2 to enable insertion.
            </p>
          ) : (
            bodyImages.map((img) => (
              <BodyImageCard
                key={img.id}
                image={img}
                pubDate={pubDate}
                onInsert={insertAtCursor}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BodyImageCard({
  image,
  pubDate,
  onInsert,
}: {
  image: ClientImage;
  pubDate: string;
  onInsert: (snippet: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  // Once processed, the on-disk filename is locked in repoPath/processedName.
  // Always prefer those over seoFilename, which can drift if the AI
  // re-suggests names after processing.
  const processedBase = image.processedName?.replace(/\.webp$/, "") ?? "";
  const filename = image.processed && image.processedName
    ? image.processedName
    : `${image.seoFilename || "image"}.webp`;
  // After publish, image.wpMediaUrl is the live URL on her WP site. Until
  // then we show the local scratch repoPath for visual reference.
  const path = image.wpMediaUrl
    ? image.wpMediaUrl
    : image.processed && image.repoPath
      ? image.repoPath
      : `/uploads/${filename}`;
  void pubDate;
  const altSource = image.processed
    ? processedBase
    : image.seoFilename || "";
  const altFallback = altSource ? altSource.replace(/-/g, " ") : "";
  const snippet = `![${altFallback}](${path})`;

  async function handleCopy() {
    const ok = await copyToClipboard(snippet);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
      <div className="flex gap-2">
        <div className="w-12 h-12 rounded bg-[var(--border)] overflow-hidden shrink-0">
          {image.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.thumbnailUrl}
              alt={image.originalName}
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--foreground)] truncate font-mono">
            {filename}
          </p>
          <p className="text-[10px] text-[var(--muted)] truncate font-mono">
            {path}
          </p>
        </div>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => onInsert(snippet)}
          className="flex-1 text-[11px] px-2 py-1 rounded bg-[var(--primary)]/20 text-[var(--primary)] hover:bg-[var(--primary)]/30"
        >
          Insert at cursor
        </button>
        <button
          onClick={handleCopy}
          className="text-[11px] px-2 py-1 rounded bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function AiField({
  label,
  hint,
  value,
  charCount,
  charTarget,
  onChange,
  onRegenerate,
  isRegenerating,
  isLoading,
  multiline,
}: {
  label: string;
  hint: string;
  value: string;
  charCount: number;
  charTarget: [number, number];
  onChange: (v: string) => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  isLoading: boolean;
  multiline?: boolean;
}) {
  const inRange = charCount >= charTarget[0] && charCount <= charTarget[1];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium">{label}</label>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${inRange ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
          >
            {charCount} chars ({hint})
          </span>
          <button
            onClick={onRegenerate}
            disabled={isRegenerating}
            className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 disabled:opacity-50"
          >
            {isRegenerating ? "..." : "Regenerate"}
          </button>
        </div>
      </div>
      {isLoading ? (
        <div
          className={`w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] ${multiline ? "h-20" : "h-10"}`}
        >
          <div className="h-3 bg-[var(--border)] rounded animate-pulse w-3/4 mt-1" />
          {multiline && (
            <div className="h-3 bg-[var(--border)] rounded animate-pulse w-1/2 mt-2" />
          )}
        </div>
      ) : multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm resize-none focus:outline-none focus:border-[var(--primary)]"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)]"
        />
      )}
    </div>
  );
}

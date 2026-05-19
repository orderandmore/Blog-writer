"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWizard } from "../WizardProvider";
import { parseMarkdown } from "@/lib/markdown";
import type { ClientImage } from "@/lib/wizard-store";
import {
  ARTICLE_MODELS,
  DEFAULT_ARTICLE_MODEL,
  type ArticleModelId,
} from "@/config/models";

type Mode = "paste" | "generate";

export function StepContent() {
  const { state, dispatch } = useWizard();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [mode, setMode] = useState<Mode>(() =>
    // Auto-select Generate mode when a topic has been loaded and no article
    // has been drafted yet; otherwise default to Paste.
    state.topicNotes && !state.rawMarkdown ? "generate" : "paste",
  );
  const [topicTitle, setTopicTitle] = useState<string>(
    () => state.postMeta.title || state.parsedTitle || "",
  );
  const [topicNotes, setTopicNotes] = useState<string>(
    () => state.topicNotes || "",
  );
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [model, setModel] = useState<ArticleModelId>(DEFAULT_ARTICLE_MODEL);

  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const previousMarkdownRef = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const [linksStatus, setLinksStatus] = useState<{
    count: number;
    updatedAt: string | null;
  } | null>(null);
  const [refreshingLinks, setRefreshingLinks] = useState(false);

  useEffect(() => {
    fetch("/api/internal-links")
      .then((r) => r.json())
      .then((data) => {
        setLinksStatus({
          count: Array.isArray(data.links) ? data.links.length : 0,
          updatedAt: data.updatedAt ?? null,
        });
      })
      .catch(() => {
        /* silent — matches behavior in StepSyndication */
      });
  }, []);

  // Keep the local topic fields synced with the store when a draft loads or
  // when the content step repopulates from an external action. Watches the
  // hydration-sourced fields; local input edits are not echoed back.
  useEffect(() => {
    if (state.topicNotes && !topicNotes) setTopicNotes(state.topicNotes);
    const incomingTitle = state.postMeta.title || state.parsedTitle || "";
    if (incomingTitle && !topicTitle) {
      setTopicTitle(incomingTitle);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.topicNotes, state.postMeta.title, state.parsedTitle]);

  const handleMarkdownChange = useCallback(
    (value: string) => {
      const parsed = parseMarkdown(value);
      dispatch({
        type: "SET_CONTENT",
        rawMarkdown: value,
        parsedTitle: parsed.title,
        parsedBody: parsed.body,
        wordCount: parsed.wordCount,
        readingTime: parsed.readingTime,
        headings: parsed.headings,
      });
    },
    [dispatch],
  );

  async function refreshLinks() {
    setRefreshingLinks(true);
    try {
      const r = await fetch("/api/internal-links/refresh", { method: "POST" });
      const data = await r.json();
      setLinksStatus({ count: data.count, updatedAt: data.updatedAt });
    } finally {
      setRefreshingLinks(false);
    }
  }

  async function generateDraft() {
    if (!topicTitle.trim()) {
      setGenError("Topic title is required.");
      return;
    }
    setGenError(null);
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "articleDraft",
          title: topicTitle.trim(),
          notes: topicNotes,
          model,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Generation failed");

      const newMarkdown = String(result.data || "").trim();
      if (!newMarkdown) throw new Error("Empty response from model");

      // Persist the topic notes (so the draft's topic_notes column keeps them
      // available on future loads) and swap the content.
      dispatch({ type: "SET_TOPIC_NOTES", notes: topicNotes });
      previousMarkdownRef.current = state.rawMarkdown;
      setCanUndo(state.rawMarkdown.length > 0);
      handleMarkdownChange(newMarkdown);
      setMode("paste");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function reviseArticle() {
    const trimmed = instruction.trim();
    if (!trimmed || !state.rawMarkdown) return;
    setReviseError(null);
    setRevising(true);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "articleRevise",
          article: state.rawMarkdown,
          instruction: trimmed,
          model,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Revision failed");

      const newMarkdown = String(result.data || "").trim();
      if (!newMarkdown) throw new Error("Empty response from model");

      previousMarkdownRef.current = state.rawMarkdown;
      setCanUndo(true);
      handleMarkdownChange(newMarkdown);
      setInstruction("");
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setRevising(false);
    }
  }

  function undo() {
    const prev = previousMarkdownRef.current;
    if (prev === null) return;
    handleMarkdownChange(prev);
    previousMarkdownRef.current = null;
    setCanUndo(false);
  }

  const handleImageUpload = useCallback(
    (files: FileList | null) => {
      if (!files) return;

      const newImages: ClientImage[] = Array.from(files).map((file, idx) => ({
        id: `${Date.now()}-${idx}`,
        originalName: file.name,
        type: (state.images.length === 0 && idx === 0 ? "featured" : "body") as
          | "featured"
          | "body",
        originalWidth: 0,
        originalHeight: 0,
        originalSize: file.size,
        processedName: "",
        processedWidth: 0,
        processedHeight: 0,
        processedSize: 0,
        repoPath: "",
        processed: false,
        // cropRect is set by the CropSelector in StepImages once the image
        // bitmap loads; undefined here just means "server falls back to
        // centered cover-fit if the user skips that step entirely".
        file,
        thumbnailUrl: URL.createObjectURL(file),
        seoFilename: file.name
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      }));

      const updated = [...state.images, ...newImages];
      dispatch({ type: "SET_IMAGES", images: updated });

      newImages.forEach((img) => {
        const image = new Image();
        image.onload = () => {
          dispatch({
            type: "UPDATE_IMAGE",
            id: img.id,
            updates: {
              originalWidth: image.width,
              originalHeight: image.height,
            },
          });
        };
        image.src = img.thumbnailUrl;
      });
    },
    [state.images, dispatch],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleImageUpload(e.dataTransfer.files);
    },
    [handleImageUpload],
  );

  const removeImage = useCallback(
    (id: string) => {
      const img = state.images.find((i) => i.id === id);
      if (img?.thumbnailUrl) URL.revokeObjectURL(img.thumbnailUrl);
      dispatch({
        type: "SET_IMAGES",
        images: state.images.filter((i) => i.id !== id),
      });
    },
    [state.images, dispatch],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Content</h2>
        <p className="text-sm text-[var(--muted)]">
          Paste markdown or generate a draft from a topic. Upload images below.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg bg-[var(--surface)] border border-[var(--border)] p-0.5 text-xs">
        <button
          onClick={() => setMode("paste")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            mode === "paste"
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Paste markdown
        </button>
        <button
          onClick={() => setMode("generate")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            mode === "generate"
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--muted)] hover:text-[var(--foreground)]"
          }`}
        >
          Generate draft
        </button>
      </div>

      {mode === "generate" && (
        <div className="space-y-3 p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Topic title
            </label>
            <input
              type="text"
              value={topicTitle}
              onChange={(e) => setTopicTitle(e.target.value)}
              placeholder="e.g. How the 2026 Virginia rebate changes your solar payback"
              className="w-full px-3 py-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
              Notes / outline (optional)
            </label>
            <textarea
              value={topicNotes}
              onChange={(e) => setTopicNotes(e.target.value)}
              placeholder="Bullet outline, stats, key points, source links — Claude will build the article around these."
              rows={6}
              className="w-full px-3 py-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)] resize-y"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={generateDraft}
                disabled={generating || !topicTitle.trim()}
                className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50"
              >
                {generating
                  ? "Drafting with Claude..."
                  : state.rawMarkdown
                    ? "Regenerate draft"
                    : "Generate draft"}
              </button>
              <ModelSelect value={model} onChange={setModel} />
            </div>
            <InternalLinksStatus
              status={linksStatus}
              refreshing={refreshingLinks}
              onRefresh={refreshLinks}
            />
          </div>
          {state.rawMarkdown && mode === "generate" && (
            <p className="text-[11px] text-[var(--muted)]">
              Regenerating will replace the current article (Undo is available
              after).
            </p>
          )}
          {genError && (
            <p className="text-xs text-[var(--danger)]">{genError}</p>
          )}
        </div>
      )}

      {/* Markdown editor */}
      <div>
        <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
          Article Markdown
        </label>
        <textarea
          value={state.rawMarkdown}
          onChange={(e) => handleMarkdownChange(e.target.value)}
          onPaste={() => {
            setTimeout(() => {
              const el = document.querySelector(
                "textarea",
              ) as HTMLTextAreaElement;
              if (el) handleMarkdownChange(el.value);
            }, 0);
          }}
          placeholder="Paste your UpNote markdown here..."
          className="w-full h-80 px-4 py-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] font-mono text-sm resize-y focus:outline-none focus:border-[var(--primary)] placeholder:text-[var(--muted)]"
          spellCheck={false}
        />
      </div>

      {/* Revise with AI */}
      {state.rawMarkdown && (
        <div className="p-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-[var(--foreground)]">
              Revise with AI
            </h3>
            <div className="flex items-center gap-3">
              <ModelSelect value={model} onChange={setModel} />
              {canUndo && (
                <button
                  onClick={undo}
                  className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] underline"
                >
                  Undo last AI change
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !revising) {
                  e.preventDefault();
                  void reviseArticle();
                }
              }}
              placeholder="e.g. tighten the intro · add a stat about Virginia net metering · make it friendlier"
              className="flex-1 px-3 py-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
            />
            <button
              onClick={reviseArticle}
              disabled={revising || !instruction.trim()}
              className="px-4 py-2 rounded bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {revising ? "Applying..." : "Apply"}
            </button>
          </div>
          {reviseError && (
            <p className="text-xs text-[var(--danger)]">{reviseError}</p>
          )}
        </div>
      )}

      {/* Content stats */}
      {state.rawMarkdown && (
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-[var(--muted)]">Words: </span>
            <span className="text-[var(--foreground)] font-medium">
              {state.wordCount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-[var(--muted)]">Reading time: </span>
            <span className="text-[var(--foreground)] font-medium">
              {state.readingTime} min
            </span>
          </div>
          {state.parsedTitle && (
            <div>
              <span className="text-[var(--muted)]">Title: </span>
              <span className="text-[var(--foreground)] font-medium">
                {state.parsedTitle}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Heading outline */}
      {state.headings.length > 0 && (
        <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <p className="text-xs font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">
            Outline
          </p>
          <ul className="space-y-1 text-sm">
            {state.headings.map((h, i) => (
              <li
                key={i}
                style={{ paddingLeft: `${(h.level - 1) * 16}px` }}
                className="text-[var(--foreground)]"
              >
                <span className="text-[var(--muted)] mr-2">
                  {"#".repeat(h.level)}
                </span>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Image upload */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-[var(--foreground)]">
            Images
          </label>
          <a
            href="https://unsplash.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] flex items-center gap-1"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Browse Unsplash
          </a>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-[var(--primary)] bg-[var(--primary)]/5"
              : "border-[var(--border)] hover:border-[var(--muted)]"
          }`}
        >
          <svg
            className="w-8 h-8 mx-auto text-[var(--muted)] mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm text-[var(--muted)]">
            Drop images here or click to browse
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            JPEG, PNG, WebP, HEIC
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            onChange={(e) => handleImageUpload(e.target.files)}
            className="hidden"
          />
        </div>
      </div>

      {/* Uploaded image thumbnails */}
      {state.images.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {state.images.map((img) => (
            <div
              key={img.id}
              className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden"
            >
              <div className="relative aspect-[4/3] bg-[var(--border)]">
                {img.thumbnailUrl && (
                  <img
                    src={img.thumbnailUrl}
                    alt={img.originalName}
                    className="w-full h-full object-cover"
                  />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeImage(img.id);
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-xs hover:bg-black/80"
                >
                  x
                </button>
                <span
                  className={`absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    img.type === "featured"
                      ? "bg-[var(--primary)] text-white"
                      : "bg-black/60 text-white"
                  }`}
                >
                  {img.type === "featured" ? "Featured" : "Body"}
                </span>
              </div>

              <div className="p-2">
                <p className="text-xs text-[var(--foreground)] truncate">
                  {img.originalName}
                </p>
                <p className="text-[10px] text-[var(--muted)] mt-0.5">
                  {img.originalWidth > 0
                    ? `${img.originalWidth}x${img.originalHeight}`
                    : "..."}{" "}
                  &middot; {(img.originalSize / 1024).toFixed(0)} KB
                </p>
                <div className="mt-1.5 flex gap-1">
                  <button
                    onClick={() =>
                      dispatch({
                        type: "UPDATE_IMAGE",
                        id: img.id,
                        updates: { type: "featured" },
                      })
                    }
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      img.type === "featured"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    Featured
                  </button>
                  <button
                    onClick={() =>
                      dispatch({
                        type: "UPDATE_IMAGE",
                        id: img.id,
                        updates: { type: "body" },
                      })
                    }
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      img.type === "body"
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    Body
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelSelect({
  value,
  onChange,
}: {
  value: ArticleModelId;
  onChange: (id: ArticleModelId) => void;
}) {
  const current = ARTICLE_MODELS.find((m) => m.id === value);
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
      <span>Model</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ArticleModelId)}
        className="px-2 py-1 rounded bg-[var(--background)] border border-[var(--border)] text-[11px] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
      >
        {ARTICLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {current?.hint && (
        <span className="hidden md:inline text-[10px] text-[var(--muted)]">
          {current.hint}
        </span>
      )}
    </label>
  );
}

function InternalLinksStatus({
  status,
  refreshing,
  onRefresh,
}: {
  status: { count: number; updatedAt: string | null } | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const caption = status
    ? `${status.count} link${status.count === 1 ? "" : "s"}${
        status.updatedAt ? ` · updated ${fmtRel(status.updatedAt)}` : ""
      }`
    : "Not yet refreshed";
  return (
    <div className="flex flex-col items-end">
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-3 py-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-[11px] font-medium hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        {refreshing ? "Refreshing..." : "Refresh internal links"}
      </button>
      <span className="text-[10px] text-[var(--muted)] mt-0.5">{caption}</span>
    </div>
  );
}

function fmtRel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

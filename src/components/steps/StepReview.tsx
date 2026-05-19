"use client";

import { useState } from "react";
import { useWizard } from "../WizardProvider";
import {
  destinations,
  getDestinationUrl,
  type Destination,
} from "@/config/destinations";
import { generateSlug } from "@/lib/slug";
import { copyRichText, copyToClipboard } from "@/lib/clipboard";
import type { SocialCopyBundle } from "@/lib/schema";

export function StepReview() {
  const { state, dispatch } = useWizard();
  const [activeTab, setActiveTab] = useState("preview");
  const [activeSyndicationTab, setActiveSyndicationTab] = useState(
    destinations[0].id,
  );
  const [publishing, setPublishing] = useState(false);
  const postedTo = new Set(state.postedDestinations);
  const [error, setError] = useState<string | null>(null);
  const [editedCopy, setEditedCopy] = useState<Record<string, string>>({});

  const fm = state.postMeta;
  const slug = fm.title ? generateSlug(fm.title) : "untitled";
  const pubDate = fm.pubDate || new Date().toISOString();
  // WP assigns the real permalink at publish; we synthesize a preview URL
  // from the slug. state.wpLink is the authoritative URL post-publish.
  const postUrl =
    state.wpLink || `https://orderandmore.com/${slug}/`;
  void pubDate;

  const filesToCommit = [
    `src/content/blog/${slug}.md`,
    ...state.images
      .filter((i) => i.processed)
      .flatMap((i) => {
        const main = `public${i.repoPath}`;
        if (i.type === "featured") {
          const social = `public${i.repoPath.replace(/\.webp$/, "-social.webp")}`;
          const socialJpg = `public${i.repoPath.replace(/\.webp$/, "-social.jpg")}`;
          const socialSquare = `public${i.repoPath.replace(/\.webp$/, "-social-square.jpg")}`;
          return [main, social, socialJpg, socialSquare];
        }
        return [main];
      }),
  ];

  async function handlePublish(status: "draft" | "publish") {
    setPublishing(true);
    setError(null);

    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          postMeta: { ...fm, status },
          body: state.parsedBody,
          images: state.images.filter((i) => i.processed),
          draftId: state.draftId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Publish failed");
      }

      const result = await response.json();

      dispatch({
        type: "SET_PUBLISH_STATUS",
        status: "published",
        wpPostId: result.wpPostId,
        wpLink: result.wpLink,
        wpEditUrl: result.editUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      dispatch({ type: "SET_PUBLISH_STATUS", status: "error" });
    } finally {
      setPublishing(false);
    }
  }

  function togglePosted(destId: string) {
    dispatch({ type: "TOGGLE_POSTED_DESTINATION", destId });
  }

  const isPublished = state.publishStatus === "published";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">
          Review & Publish
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Review your post, then publish or create a draft PR.
        </p>
      </div>

      {/* Published confirmation */}
      {isPublished && (
        <div className="p-4 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/30">
          <p className="text-sm font-medium text-[var(--success)]">
            Published successfully!
          </p>
          {state.wpPostId && (
            <p className="text-xs text-[var(--muted)] mt-1">
              WordPress post #{state.wpPostId}
            </p>
          )}
          {state.wpEditUrl && (
            <a
              href={state.wpEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] mt-1 block"
            >
              Edit in WP admin →
            </a>
          )}
          {state.wpLink && (
            <a
              href={state.wpLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] mt-1 block"
            >
              View live post → {state.wpLink}
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* Tabs: Preview | Syndication
         (Files + Frontmatter tabs removed — we publish via WP REST, not
         file commits, and PostMeta is shown inline in Step 3.) */}
      <div className="border-b border-[var(--border)]">
        <div className="flex gap-1">
          {["preview", "syndication"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-[var(--primary)] text-[var(--primary)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === "preview" && (
          <div className="prose max-w-none">
            <div className="p-6 rounded-lg bg-white text-gray-900">
              <h1 className="text-2xl font-bold mb-2">{fm.title || "Untitled"}</h1>
              <p className="text-sm text-gray-500 mb-4">
                Patty Powers &middot;{" "}
                {fm.pubDate
                  ? new Date(fm.pubDate).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "No date"}{" "}
                &middot; {state.readingTime} min read
              </p>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{
                  __html: state.parsedBody
                    ? `<p class="text-gray-600 italic">(Live preview will render markdown here)</p><pre class="text-xs bg-gray-50 p-4 rounded overflow-x-auto">${escapeHtml(state.parsedBody.slice(0, 2000))}${state.parsedBody.length > 2000 ? "\n..." : ""}</pre>`
                    : "<p>No content</p>",
                }}
              />
            </div>
          </div>
        )}

        {activeTab === "syndication" && (
          <div className="space-y-4">
            {/* Syndication tabs */}
            <div className="flex flex-wrap gap-1">
              {destinations.map((dest) => (
                <button
                  key={dest.id}
                  onClick={() => setActiveSyndicationTab(dest.id)}
                  className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
                    activeSyndicationTab === dest.id
                      ? "bg-[var(--primary)] text-white"
                      : "bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {postedTo.has(dest.id) && (
                    <svg
                      className="w-3 h-3 text-[var(--success)]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                  {dest.name}
                </button>
              ))}
            </div>

            {/* Active destination content */}
            {destinations
              .filter((d) => d.id === activeSyndicationTab)
              .map((dest) => {
                const generated =
                  state.socialCopy?.[
                    dest.copyField as keyof SocialCopyBundle
                  ] || "";
                const copy =
                  editedCopy[dest.id] !== undefined
                    ? editedCopy[dest.id]
                    : generated;
                const destUrl = getDestinationUrl(dest);
                const featuredImg = state.images.find(
                  (i) => i.type === "featured" && i.processed,
                );
                const featuredBase =
                  featuredImg?.processedName?.replace(/\.webp$/, "") ||
                  (state.postMeta.title
                    ? generateSlug(state.postMeta.title)
                    : "featured");

                return (
                  <div key={dest.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {dest.name}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {dest.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => togglePosted(dest.id)}
                          className={`text-xs px-2 py-1 rounded ${
                            postedTo.has(dest.id)
                              ? "bg-[var(--success)]/20 text-[var(--success)]"
                              : "bg-[var(--border)] text-[var(--muted)]"
                          }`}
                        >
                          {postedTo.has(dest.id) ? "Posted" : "Mark posted"}
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                      <div className="flex items-center justify-between mb-2">
                        <CharCount
                          value={copy}
                          maxChars={dest.maxChars}
                        />
                        <PostToSiteButton
                          value={copy}
                          destUrl={destUrl}
                          copyMode={dest.copyMode}
                        />
                      </div>
                      {dest.bufferService ? (
                        <textarea
                          value={copy}
                          onChange={(e) =>
                            setEditedCopy((prev) => ({
                              ...prev,
                              [dest.id]: e.target.value,
                            }))
                          }
                          placeholder="(Generate social copy in Step 4 first)"
                          className="w-full text-xs text-[var(--foreground)] bg-[var(--background)] border border-[var(--border)] rounded p-2 font-sans min-h-[8rem] resize-y focus:outline-none focus:border-[var(--primary)]"
                        />
                      ) : (
                        <pre className="text-xs text-[var(--foreground)] whitespace-pre-wrap font-sans max-h-60 overflow-y-auto">
                          {copy || "(Generate social copy in Step 4 first)"}
                        </pre>
                      )}
                    </div>

                    {dest.bufferService && (
                      <BufferSubmitRow
                        dest={dest}
                        text={copy}
                        draftId={state.draftId}
                        isPublished={isPublished}
                        submission={state.bufferSubmissions[dest.id]}
                        onSubmitted={(bufferPostId) => {
                          dispatch({
                            type: "RECORD_BUFFER_SUBMISSION",
                            destId: dest.id,
                            bufferPostId,
                            submittedAt: new Date().toISOString(),
                          });
                        }}
                      />
                    )}

                    {(dest.hasSocialImage) && (
                      <ImageDownloads
                        dest={dest}
                        featuredImage={featuredImg}
                        featuredBase={featuredBase}
                        draftId={state.draftId}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Publish bar */}
      {!isPublished && (
        <div className="flex items-center gap-3 pt-4 border-t border-[var(--border)]">
          <button
            onClick={() => handlePublish("publish")}
            disabled={publishing || !fm.title || !fm.description}
            className="px-6 py-2.5 rounded-lg bg-[var(--success)] text-white text-sm font-medium hover:bg-[var(--success)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? "Publishing..." : "Publish Live"}
          </button>
          <button
            onClick={() => handlePublish("draft")}
            disabled={publishing || !fm.title || !fm.description}
            className="px-6 py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishing ? "Saving..." : "Save as WP Draft"}
          </button>
          {(!fm.title || !fm.description) && (
            <p className="text-xs text-[var(--warning)]">
              Fill in title and description in Step 3 first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CharCount({
  value,
  maxChars,
}: {
  value: string;
  maxChars?: number;
}) {
  if (!maxChars) {
    return (
      <span className="text-[10px] text-[var(--muted)]">{value.length} chars</span>
    );
  }
  const over = value.length > maxChars;
  return (
    <span
      className={`text-[10px] ${over ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
    >
      {value.length} / {maxChars}
    </span>
  );
}

function BufferSubmitRow({
  dest,
  text,
  draftId,
  isPublished,
  submission,
  onSubmitted,
}: {
  dest: Destination;
  text: string;
  draftId: string | null;
  isPublished: boolean;
  submission: { bufferPostId: string; submittedAt: string } | undefined;
  onSubmitted: (bufferPostId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const overLimit = dest.maxChars ? text.length > dest.maxChars : false;
  const blocked = !draftId || !isPublished || !text.trim() || overLimit;

  async function handleSubmit() {
    if (!draftId) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/syndicate/buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          destinationId: dest.id,
          text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Buffer submission failed");
      onSubmitted(data.bufferPostId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Buffer submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submission) {
    return (
      <div className="p-3 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/30 text-xs">
        <p className="font-medium text-[var(--success)]">
          Queued in Buffer ✓
        </p>
        <p className="text-[var(--muted)] mt-0.5">
          Buffer post id:{" "}
          <code className="font-mono">{submission.bufferPostId}</code>
          {" · "}
          {new Date(submission.submittedAt).toLocaleString()}
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">
          Submit to Buffer (adds to your {dest.name} queue with the{" "}
          {dest.socialImageVariant === "square" ? "1080×1080" : "1200×630"} JPG).
        </p>
        <button
          onClick={handleSubmit}
          disabled={blocked || submitting}
          className="text-xs px-3 py-1 rounded bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting…" : "Submit to Buffer"}
        </button>
      </div>
      {!isPublished && (
        <p className="text-[10px] text-[var(--warning)]">
          Publish to GitHub first — Buffer needs the live image URL on virtuesolar.com.
        </p>
      )}
      {overLimit && (
        <p className="text-[10px] text-[var(--danger)]">
          Caption exceeds {dest.maxChars}-char limit.
        </p>
      )}
      {err && (
        <p className="text-[10px] text-[var(--danger)]">{err}</p>
      )}
    </div>
  );
}

function PostToSiteButton({
  value,
  destUrl,
  copyMode,
}: {
  value: string;
  destUrl: string;
  copyMode: "plain" | "rich";
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "done" | "err">(
    "idle",
  );

  async function handleClick() {
    if (!value && !destUrl) return;

    setStatus("copying");
    let copyOk = true;
    if (value) {
      copyOk =
        copyMode === "rich"
          ? await copyRichText(value)
          : await copyToClipboard(value);
    }

    // Open the destination after the clipboard write. Same-gesture click on
    // most browsers keeps the popup allowlist happy.
    if (destUrl) {
      window.open(destUrl, "_blank", "noopener,noreferrer");
    }

    setStatus(copyOk ? "done" : "err");
    setTimeout(() => setStatus("idle"), 2500);
  }

  const hasWork = Boolean(value) || Boolean(destUrl);
  const label =
    status === "copying"
      ? "Opening..."
      : status === "done"
        ? destUrl
          ? "Copied + opened"
          : "Copied!"
        : status === "err"
          ? "Copy failed"
          : destUrl
            ? "Post to site"
            : "Copy";

  return (
    <button
      onClick={handleClick}
      disabled={!hasWork}
      className="text-xs px-3 py-1 rounded bg-[var(--primary)]/20 text-[var(--primary)] hover:bg-[var(--primary)]/30 disabled:opacity-30"
    >
      {label}
    </button>
  );
}

function ImageDownloads({
  dest,
  featuredImage,
  featuredBase,
  draftId,
}: {
  dest: Destination;
  featuredImage:
    | import("@/lib/wizard-store").ClientImage
    | undefined;
  featuredBase: string;
  draftId: string | null;
}) {
  if (!featuredImage || !draftId) {
    return (
      <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
        <p className="text-xs text-[var(--muted)]">
          Process a featured image in Step 2 to get downloadable JPGs.
        </p>
      </div>
    );
  }

  const base = `/api/drafts/${encodeURIComponent(
    draftId,
  )}/scratch/${encodeURIComponent(featuredImage.id)}`;
  const isSquare = dest.socialImageVariant === "square";
  const socialKey = isSquare ? "social-square.jpg" : "social.jpg";
  const socialDims = isSquare ? "1080x1080" : "1200x630";
  const socialThumbClass = isSquare ? "w-14 h-14" : "w-20 h-11";

  return (
    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
      {dest.hasSocialImage && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${base}-${socialKey}`}
            alt={`${dest.name} social preview`}
            className={`${socialThumbClass} rounded object-cover bg-[var(--border)] shrink-0`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[var(--foreground)]">
              Social image ({socialDims} JPG)
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              Upload with your {dest.name} post.
            </p>
          </div>
          <a
            href={`${base}-${socialKey}?download=${encodeURIComponent(
              `${featuredBase}-${socialKey}`,
            )}`}
            className="text-xs px-2 py-1 rounded bg-[var(--primary)]/20 text-[var(--primary)] hover:bg-[var(--primary)]/30"
          >
            Download JPG
          </a>
        </div>
      )}
    </div>
  );
}

function buildFrontmatterPreview(
  fm: Record<string, unknown>,
): string {
  const lines: string[] = ["---"];
  const fields = [
    "title",
    "description",
    "pubDate",
    "author",
    "categories",
    "tags",
    "featuredImage",
    "featuredImageAlt",
    "draft",
    "seoTitle",
    "seoDescription",
  ];

  for (const key of fields) {
    const value = fm[key];
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      value.forEach((v) => lines.push(`  - "${v}"`));
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: "${value}"`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

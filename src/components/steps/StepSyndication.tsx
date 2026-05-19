"use client";

import { useEffect, useState } from "react";
import { useWizard } from "../WizardProvider";
import { generateSlug } from "@/lib/slug";
import { copyRichText, copyToClipboard } from "@/lib/clipboard";

type LinksStatus = {
  count: number;
  updatedAt: string | null;
};

export function StepSyndication() {
  const { state, dispatch } = useWizard();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refreshingLinks, setRefreshingLinks] = useState(false);
  const [linksStatus, setLinksStatus] = useState<LinksStatus | null>(null);
  const [linksError, setLinksError] = useState<string | null>(null);

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
        // Silent — UI just shows "no links yet"
      });
  }, []);

  async function refreshInternalLinks() {
    setRefreshingLinks(true);
    setLinksError(null);
    try {
      const response = await fetch("/api/internal-links/refresh", {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Refresh failed");
      }
      setLinksStatus({
        count: data.count,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      setLinksError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingLinks(false);
    }
  }

  async function generateAll() {
    setGenerating(true);
    setError(null);
    setWarnings([]);

    try {
      const slug = state.postMeta.title
        ? generateSlug(state.postMeta.title)
        : "untitled";
      const pubDate = state.postMeta.pubDate || new Date().toISOString();
      // Use the live WP permalink once we have one; before publish, fall back
      // to a slug-based preview URL.
      const postUrl =
        state.wpLink || `https://orderandmore.com/${slug}/`;
      void pubDate;

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: "socialAndPress",
          title: state.postMeta.title || "",
          body: state.parsedBody,
          url: postUrl,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Generation failed");
      }

      if (result.data) {
        dispatch({ type: "SET_SOCIAL_COPY", copy: result.data });
      }
      if (Array.isArray(result.warnings)) {
        setWarnings(result.warnings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const linksCaption = linksStatus
    ? `${linksStatus.count} link${linksStatus.count === 1 ? "" : "s"}${
        linksStatus.updatedAt
          ? ` · updated ${formatRelativeTime(linksStatus.updatedAt)}`
          : ""
      }`
    : "Not yet refreshed";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">
          Syndication Copy
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Generate social media posts and a press release in one go. Internal
          links are pulled from a local cache of the Astro repo — refresh after
          you {`'git pull'`} the site.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {!state.rawMarkdown && (
        <div className="text-center py-8 text-[var(--muted)]">
          <p>No article content found. Go back to Step 1.</p>
        </div>
      )}

      {state.rawMarkdown && (
        <>
          {/* Action row */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generateAll}
              disabled={generating}
              className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50"
            >
              {generating
                ? "Generating..."
                : "Generate Social + Press Release"}
            </button>
            <div className="flex flex-col">
              <button
                onClick={refreshInternalLinks}
                disabled={refreshingLinks}
                className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-xs font-medium hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                {refreshingLinks ? "Refreshing..." : "Refresh Internal Links"}
              </button>
              <span className="text-[10px] text-[var(--muted)] mt-0.5">
                {linksCaption}
              </span>
              {linksError && (
                <span className="text-[10px] text-[var(--danger)] mt-0.5">
                  {linksError}
                </span>
              )}
            </div>
          </div>

          {/* Social copy outputs */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[var(--foreground)]">
              Social Posts
            </h3>

            <CopyBlock
              label="Google Business Profile"
              hint="No links allowed"
              value={state.socialCopy?.gmb || ""}
              maxChars={1500}
              warning={findWarning(warnings, "gmb")}
            />
            <CopyBlock
              label="Facebook"
              value={state.socialCopy?.facebook || ""}
              maxChars={500}
              warning={findWarning(warnings, "facebook")}
            />
            <CopyBlock
              label="Instagram"
              hint="No hashtags, no links"
              value={state.socialCopy?.instagram || ""}
            />
          </div>

          {/* Pinterest pin */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[var(--foreground)]">
              Pinterest
            </h3>
            <CopyBlock
              label="Pin description"
              hint="Pinterest is a search engine — keyword-rich, ≤500 chars, URL at the end."
              value={state.socialCopy?.pinterest || ""}
              maxChars={500}
              warning={findWarning(warnings, "pinterest")}
            />
          </div>
        </>
      )}
    </div>
  );
}

function findWarning(warnings: string[], field: string): string | undefined {
  return warnings.find((w) => w.startsWith(`${field} `));
}

function CopyBlock({
  label,
  hint,
  value,
  maxChars,
  tall,
  warning,
  richText,
}: {
  label: string;
  hint?: string;
  value: string;
  maxChars?: number;
  tall?: boolean;
  warning?: string;
  richText?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    const ok = richText
      ? await copyRichText(value)
      : await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const overLimit = maxChars && value.length > maxChars;

  return (
    <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--foreground)]">
            {label}
          </span>
          {hint && (
            <span className="text-[10px] text-[var(--muted)]">{hint}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {maxChars && value && (
            <span
              className={`text-xs ${overLimit ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
            >
              {value.length}/{maxChars}
            </span>
          )}
          <button
            onClick={copy}
            disabled={!value}
            className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className={`text-xs text-[var(--foreground)] whitespace-pre-wrap font-sans ${tall ? "max-h-48 overflow-y-auto" : ""}`}
      >
        {value || "(Click generate above)"}
      </pre>
      {warning && (
        <p className="text-[11px] text-[var(--danger)] mt-2">
          Over limit after retry: {warning}
        </p>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PromptEntry = {
  key: string;
  default: string;
  override: string | null;
  updatedAt: string | null;
};

const GROUPS: Array<{ label: string; match: (key: string) => boolean }> = [
  { label: "Brand", match: (k) => k === "brand" },
  { label: "Metadata", match: (k) => k.startsWith("metadata-batch") },
  {
    label: "SEO fields",
    match: (k) =>
      k.startsWith("description") ||
      k.startsWith("seoTitle") ||
      k.startsWith("seoDescription") ||
      k.startsWith("tags"),
  },
  { label: "Images", match: (k) => k.startsWith("image-filenames") },
  {
    label: "Social prompts",
    match: (k) =>
      k === "socialAndPress.system" || k === "socialAndPress.user",
  },
  {
    label: "Social schema (per platform)",
    match: (k) => k.startsWith("socialAndPress.schema."),
  },
];

function groupKeys(entries: PromptEntry[]) {
  const buckets: Array<{ label: string; keys: PromptEntry[] }> = GROUPS.map(
    (g) => ({ label: g.label, keys: [] }),
  );
  const other: PromptEntry[] = [];

  for (const entry of entries) {
    const idx = GROUPS.findIndex((g) => g.match(entry.key));
    if (idx >= 0) buckets[idx].keys.push(entry);
    else other.push(entry);
  }
  if (other.length) buckets.push({ label: "Other", keys: other });
  return buckets.filter((b) => b.keys.length > 0);
}

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/prompts")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts || []);
        if (data.prompts?.[0]) setSelected(data.prompts[0].key);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const current = useMemo(
    () => prompts.find((p) => p.key === selected) ?? null,
    [prompts, selected],
  );

  const currentValue = current?.override ?? current?.default ?? "";
  const isOverridden = current?.override !== null && current?.override !== undefined;
  const isDirty = current ? draft !== currentValue : false;

  useEffect(() => {
    if (current) setDraft(current.override ?? current.default);
  }, [current?.key, current?.override, current?.default, current]);

  const grouped = useMemo(() => groupKeys(prompts), [prompts]);

  async function save() {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/prompts/${encodeURIComponent(current.key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: draft }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      setPrompts((prev) =>
        prev.map((p) =>
          p.key === current.key
            ? { ...p, override: draft, updatedAt: new Date().toISOString() }
            : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/prompts/${encodeURIComponent(current.key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: null }),
        },
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Reset failed");
      }
      setPrompts((prev) =>
        prev.map((p) =>
          p.key === current.key
            ? { ...p, override: null, updatedAt: null }
            : p,
        ),
      );
      setDraft(current.default);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen">
      <aside className="w-72 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-white">Settings</h1>
            <p className="text-xs text-[var(--muted)]">AI prompts</p>
          </div>
          <Link
            href="/"
            className="text-xs text-[var(--primary)] hover:underline"
          >
            &larr; Dashboard
          </Link>
        </div>

        {loading && (
          <p className="text-xs text-[var(--muted)]">Loading...</p>
        )}

        <nav className="flex-1 space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] px-2 mb-1">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.keys.map((entry) => {
                  const isSelected = selected === entry.key;
                  const hasOverride = entry.override !== null;
                  return (
                    <li key={entry.key}>
                      <button
                        onClick={() => setSelected(entry.key)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors flex items-center justify-between gap-2 ${
                          isSelected
                            ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                            : "text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        <span className="truncate">{entry.key}</span>
                        {hasOverride && (
                          <span
                            className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                            title="Customized"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          {!current && !loading && (
            <p className="text-sm text-[var(--muted)]">
              No prompts found.
            </p>
          )}

          {current && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white font-mono">
                  {current.key}
                </h2>
                <p className="text-xs text-[var(--muted)] mt-1">
                  {isOverridden
                    ? `Customized${current.updatedAt ? ` · updated ${formatRelativeTime(current.updatedAt)}` : ""}`
                    : "Using default"}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
                  {error}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">
                  Prompt body
                </p>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={20}
                  spellCheck={false}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
                />
                <p className="text-[10px] text-[var(--muted)] mt-1">
                  Template variables like{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--surface)]">
                    {`{{title}}`}
                  </code>
                  ,{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--surface)]">
                    {`{{body}}`}
                  </code>
                  ,{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--surface)]">
                    {`{{brandRules}}`}
                  </code>{" "}
                  are substituted at request time. Keep placeholder names as-is
                  or omit them.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={save}
                  disabled={saving || !isDirty}
                  className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? "Saving..." : "Save override"}
                </button>
                <button
                  onClick={resetToDefault}
                  disabled={saving || !isOverridden}
                  className="px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reset to default
                </button>
                {isDirty && (
                  <span className="text-xs text-[var(--warning)]">
                    Unsaved changes
                  </span>
                )}
              </div>

              <details className="pt-2">
                <summary className="text-xs text-[var(--muted)] cursor-pointer hover:text-[var(--foreground)]">
                  Show shipped default
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--foreground)] whitespace-pre-wrap font-mono overflow-x-auto">
                  {current.default}
                </pre>
              </details>
            </div>
          )}
        </div>
      </main>
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Topic = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  draft_id: string | null;
  created_at: string;
  updated_at: string;
};

type DraftSummary = {
  id: string;
  title: string | null;
  slug: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  imageCount: number;
  progress: {
    content: boolean;
    images: boolean;
    metadata: boolean;
    social: boolean;
    published: boolean;
  };
  syndicated: { posted: number; total: number };
};

type DraftImage = {
  id: string;
  processedName?: string;
  type: "featured" | "body";
  repoPath?: string;
  processed?: boolean;
};

export default function Dashboard() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openImages, setOpenImages] = useState<string | null>(null);
  const [imagesById, setImagesById] = useState<Record<string, DraftImage[]>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts");
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  function handleDraftStartedFromTopic() {
    // A new draft was minted from a topic — refresh so it appears in the drafts
    // table immediately.
    void load();
  }

  async function toggleImages(id: string) {
    if (openImages === id) {
      setOpenImages(null);
      return;
    }
    setOpenImages(id);
    if (!imagesById[id]) {
      const res = await fetch(`/api/drafts/${encodeURIComponent(id)}`);
      if (res.ok) {
        const { draft } = await res.json();
        setImagesById((prev) => ({ ...prev, [id]: draft.images || [] }));
      }
    }
  }

  async function deleteDraft(id: string) {
    if (!confirm("Delete this draft and its processed images?")) return;
    const res = await fetch(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="max-w-6xl mx-auto p-8">
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Blog Portal</h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              Drafts auto-save. Resume any row to pick up where you left off.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/images"
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Image tool
            </Link>
            <Link
              href="/settings"
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Settings
            </Link>
            <Link
              href="/compose"
              className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)]"
            >
              + New post
            </Link>
          </div>
        </header>

        {error && (
          <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)] mb-4">
            {error}
          </div>
        )}

        <TopicsPanel onDraftStarted={handleDraftStartedFromTopic} />

        {loading && drafts.length === 0 && (
          <p className="text-sm text-[var(--muted)]">Loading...</p>
        )}

        {!loading && drafts.length === 0 && (
          <div className="p-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-center">
            <p className="text-sm text-[var(--muted)] mb-3">
              No drafts yet.
            </p>
            <Link
              href="/compose"
              className="text-sm text-[var(--primary)] hover:underline"
            >
              Start your first post &rarr;
            </Link>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-hover)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
                <tr>
                  <th className="text-left px-4 py-2">Post</th>
                  <th className="text-left px-4 py-2">Progress</th>
                  <th className="text-left px-4 py-2">Syndicated</th>
                  <th className="text-left px-4 py-2">Updated</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <DraftRow
                    key={d.id}
                    draft={d}
                    expanded={openImages === d.id}
                    images={imagesById[d.id]}
                    onToggleImages={() => toggleImages(d.id)}
                    onDelete={() => deleteDraft(d.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function DraftRow({
  draft,
  expanded,
  images,
  onToggleImages,
  onDelete,
}: {
  draft: DraftSummary;
  expanded: boolean;
  images: DraftImage[] | undefined;
  onToggleImages: () => void;
  onDelete: () => void;
}) {
  const p = draft.progress;
  const steps = [
    { key: "content", label: "Content", on: p.content },
    { key: "images", label: "Images", on: p.images },
    { key: "metadata", label: "Meta", on: p.metadata },
    { key: "social", label: "Social", on: p.social },
    { key: "publish", label: "Published", on: p.published },
  ];

  const resumeHref = `/compose?draft=${encodeURIComponent(draft.id)}`;
  const title = draft.title || draft.slug || `Untitled · ${draft.id.slice(0, 6)}`;

  return (
    <>
      <tr className="border-t border-[var(--border)] hover:bg-[var(--surface-hover)]">
        <td className="px-4 py-3">
          <Link
            href={resumeHref}
            className="text-[var(--foreground)] hover:text-[var(--primary)] font-medium"
          >
            {title}
          </Link>
          {draft.slug && draft.slug !== title && (
            <p className="text-xs text-[var(--muted)] font-mono mt-0.5">
              {draft.slug}
            </p>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {steps.map((s) => (
              <span
                key={s.key}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  s.on
                    ? "bg-[var(--success)]/20 text-[var(--success)]"
                    : "bg-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {s.on ? "✓" : "○"} {s.label}
              </span>
            ))}
          </div>
        </td>
        <td className="px-4 py-3">
          {p.social || p.published ? (
            <span className="text-xs text-[var(--foreground)]">
              {draft.syndicated.posted} / {draft.syndicated.total}
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-[var(--muted)]">
          {formatRelativeTime(draft.updatedAt)}
        </td>
        <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
          <Link
            href={resumeHref}
            className="text-xs text-[var(--primary)] hover:underline"
          >
            Resume
          </Link>
          {draft.imageCount > 0 && (
            <button
              onClick={onToggleImages}
              className="text-xs text-[var(--foreground)] hover:text-[var(--primary)]"
            >
              {expanded ? "Hide" : "Images"} ({draft.imageCount})
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-xs text-[var(--danger)] hover:underline"
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--background)]">
          <td colSpan={5} className="px-4 py-3">
            <ImageList draftId={draft.id} images={images} />
          </td>
        </tr>
      )}
    </>
  );
}

function ImageList({
  draftId,
  images,
}: {
  draftId: string;
  images: DraftImage[] | undefined;
}) {
  if (!images) {
    return <p className="text-xs text-[var(--muted)]">Loading images...</p>;
  }
  const processed = images.filter((i) => i.processed);
  if (processed.length === 0) {
    return (
      <p className="text-xs text-[var(--muted)]">No processed images yet.</p>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-3">
      {processed.map((img) => {
        const src = `/api/drafts/${encodeURIComponent(draftId)}/scratch/${encodeURIComponent(img.id)}-processed`;
        const dlName = img.processedName || `${img.id}.webp`;
        return (
          <div
            key={img.id}
            className="p-2 rounded bg-[var(--surface)] border border-[var(--border)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={img.processedName || img.id}
              className="w-full h-24 object-cover rounded mb-2"
            />
            <p className="text-[10px] text-[var(--muted)] font-mono truncate mb-1">
              {img.type === "featured" ? "★ " : ""}
              {img.processedName || img.id}
            </p>
            <div className="flex flex-col gap-1">
              <a
                href={`${src}?download=${encodeURIComponent(dlName)}`}
                className="text-[11px] text-[var(--primary)] hover:underline"
              >
                Download
              </a>
              {img.type === "featured" && (
                <>
                  <a
                    href={`/api/drafts/${encodeURIComponent(draftId)}/scratch/${encodeURIComponent(img.id)}-social.jpg?download=${encodeURIComponent(dlName.replace(/\.webp$/, "-social.jpg"))}`}
                    className="text-[11px] text-[var(--primary)] hover:underline"
                  >
                    Download social wide (1200×630 JPG)
                  </a>
                  <a
                    href={`/api/drafts/${encodeURIComponent(draftId)}/scratch/${encodeURIComponent(img.id)}-social-square.jpg?download=${encodeURIComponent(dlName.replace(/\.webp$/, "-social-square.jpg"))}`}
                    className="text-[11px] text-[var(--primary)] hover:underline"
                  >
                    Download social square (1080×1080 JPG)
                  </a>
                  <a
                    href={`/api/drafts/${encodeURIComponent(draftId)}/scratch/${encodeURIComponent(img.id)}-press.jpg?download=${encodeURIComponent(dlName.replace(/\.webp$/, "-press.jpg"))}`}
                    className="text-[11px] text-[var(--primary)] hover:underline"
                  >
                    Download press (400×400 JPG)
                  </a>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function TopicsPanel({ onDraftStarted }: { onDraftStarted: () => void }) {
  const router = useRouter();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/topics");
      const data = await res.json();
      setTopics(data.topics || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function addTopic() {
    if (!newTitle.trim()) return;
    setAdding(true);
    setErr(null);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), notes: newNotes }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setNewTitle("");
      setNewNotes("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function startDraft(topicId: string) {
    setBusyId(topicId);
    setErr(null);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", fromTopicId: topicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const { id } = await res.json();
      onDraftStarted();
      router.push(`/compose?draft=${encodeURIComponent(id)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusyId(null);
    }
  }

  async function archive(topicId: string) {
    setBusyId(topicId);
    try {
      await fetch(`/api/topics/${encodeURIComponent(topicId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(topicId: string) {
    if (!confirm("Delete this topic?")) return;
    setBusyId(topicId);
    try {
      await fetch(`/api/topics/${encodeURIComponent(topicId)}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const open = topics.filter((t) => t.status !== "archived");
  const archived = topics.filter((t) => t.status === "archived");

  return (
    <section className="mb-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Topics</h2>
        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider">
          {open.length} open{archived.length ? ` · ${archived.length} archived` : ""}
        </span>
      </div>

      {err && (
        <div className="mb-3 p-2 rounded bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
          {err}
        </div>
      )}

      <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-1.5">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New topic title"
            className="w-full px-3 py-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)]"
          />
          <textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes, outline, source links (optional)"
            rows={2}
            className="w-full px-3 py-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--primary)] resize-y"
          />
        </div>
        <button
          onClick={addTopic}
          disabled={adding || !newTitle.trim()}
          className="self-start px-3 py-1.5 rounded bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add topic"}
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-[var(--muted)]">Loading topics...</p>
      ) : open.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">No topics yet.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((t) => (
            <TopicRow
              key={t.id}
              topic={t}
              busy={busyId === t.id}
              onStartDraft={() => startDraft(t.id)}
              onArchive={() => archive(t.id)}
              onDelete={() => remove(t.id)}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="text-[10px] text-[var(--muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--foreground)]">
            Archived ({archived.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {archived.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between text-xs text-[var(--muted)]"
              >
                <span>{t.title}</span>
                <button
                  onClick={() => remove(t.id)}
                  className="text-[var(--danger)] hover:underline"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function TopicRow({
  topic,
  busy,
  onStartDraft,
  onArchive,
  onDelete,
}: {
  topic: Topic;
  busy: boolean;
  onStartDraft: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="p-2 rounded bg-[var(--background)] border border-[var(--border)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--foreground)] truncate">
            {topic.title}
          </p>
          {topic.notes && (
            <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-2 whitespace-pre-wrap">
              {topic.notes}
            </p>
          )}
          <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--muted)]">
            <span>{formatRelativeTime(topic.updated_at)}</span>
            {topic.draft_id && (
              <Link
                href={`/compose?draft=${encodeURIComponent(topic.draft_id)}`}
                className="text-[var(--primary)] hover:underline"
              >
                Resume draft
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onStartDraft}
            disabled={busy || Boolean(topic.draft_id)}
            className="text-xs px-2 py-1 rounded bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-50"
          >
            {topic.draft_id ? "Drafted" : busy ? "..." : "Start draft"}
          </button>
          <button
            onClick={onArchive}
            disabled={busy}
            className="text-[10px] text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Archive
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-[10px] text-[var(--danger)] hover:underline"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

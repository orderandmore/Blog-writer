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
import type { ReviewStatus, ClientImage } from "@/lib/wizard-store";
import type { BufferMode } from "@/lib/buffer";

export function StepReview() {
  const { state, dispatch } = useWizard();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-destination Buffer errors collected during the orchestrated submit, so
  // one channel failing doesn't hide the others' success.
  const [bufferErrors, setBufferErrors] = useState<Record<string, string>>({});
  // How each channel actually landed in Buffer ("queue" | "scheduled" |
  // "draft"), as resolved server-side from the live WP status. Drives the
  // status label so it reflects what really happened, not a stale guess.
  const [bufferModes, setBufferModes] = useState<Record<string, BufferMode>>(
    {},
  );
  // Scheduling: a local datetime-local value (browser local time). Defaults
  // to ~tomorrow 9am so the picker isn't empty. Only used for "Schedule".
  const [scheduledFor, setScheduledFor] = useState<string>(defaultScheduleLocal);
  // The WP status returned by the publish call ("publish" | "draft" |
  // "future"), used to tailor the success message + Buffer summary wording.
  const [resultStatus, setResultStatus] = useState<string | null>(null);

  const fm = state.postMeta;
  const slug = fm.title ? generateSlug(fm.title) : "untitled";

  // Buffer destinations gate the final actions; non-Buffer ones (GMB) are
  // manual copy/paste and shown as reference cards.
  const bufferDestinations = destinations.filter((d) => d.bufferService);
  const manualDestinations = destinations.filter((d) => !d.bufferService);

  // datetime-local gives "YYYY-MM-DDTHH:mm" in the browser's local zone.
  // new Date() interprets that as local time; toISOString() converts to a
  // proper UTC ISO string (with Z) — what the publish route + Buffer want.
  const scheduledIso =
    scheduledFor && !Number.isNaN(new Date(scheduledFor).getTime())
      ? new Date(scheduledFor).toISOString()
      : "";
  const scheduleInFuture =
    !!scheduledFor && new Date(scheduledFor).getTime() > Date.now();

  const isPublished = state.publishStatus === "published";

  const reviewOf = (destId: string): ReviewStatus | undefined =>
    state.socialReview[destId];
  const copyOf = (dest: Destination): string =>
    state.socialCopy?.[dest.copyField as keyof SocialCopyBundle] || "";

  // Every Buffer destination must be approved or skipped before publishing.
  const pendingBuffer = bufferDestinations.filter((d) => !reviewOf(d.id));
  const allBufferResolved = pendingBuffer.length === 0;
  const approvedDestinations = bufferDestinations.filter(
    (d) => reviewOf(d.id) === "approved",
  );

  const hasMeta = !!fm.title && !!fm.description;
  const canPublish = hasMeta && allBufferResolved && !publishing;

  function updateCopy(dest: Destination, value: string) {
    dispatch({
      type: "SET_SOCIAL_COPY",
      copy: { ...(state.socialCopy ?? {}), [dest.copyField]: value },
    });
  }

  function setReview(destId: string, status: ReviewStatus | null) {
    dispatch({ type: "SET_SOCIAL_REVIEW", destId, status });
  }

  /** Submit one destination to Buffer. The server resolves mode + timing from
   * the live WP post status, so we only pass a stagger index for spacing.
   * Errors are collected per-destination rather than thrown, so one failure
   * doesn't abort the rest. */
  async function submitOneBuffer(dest: Destination, staggerIndex: number) {
    if (!state.draftId) return;
    try {
      const res = await fetch("/api/syndicate/buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: state.draftId,
          destinationId: dest.id,
          text: copyOf(dest),
          staggerIndex,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Buffer submission failed");
      if (data.mode) {
        setBufferModes((prev) => ({ ...prev, [dest.id]: data.mode }));
      }
      dispatch({
        type: "RECORD_BUFFER_SUBMISSION",
        destId: dest.id,
        bufferPostId: data.bufferPostId,
        submittedAt: new Date().toISOString(),
      });
      setBufferErrors((prev) => {
        const next = { ...prev };
        delete next[dest.id];
        return next;
      });
    } catch (e) {
      setBufferErrors((prev) => ({
        ...prev,
        [dest.id]: e instanceof Error ? e.message : "Buffer submission failed",
      }));
    }
  }

  async function handleFinalAction(action: "publish" | "draft" | "future") {
    if (action === "future" && !scheduleInFuture) return;
    setPublishing(true);
    setError(null);
    setBufferErrors({});

    try {
      const postMeta: Record<string, unknown> = { ...fm, status: action };
      if (action === "future") {
        // The publish route uses meta.pubDate as WP's date_gmt when status is
        // "future". (scheduledIso is already UTC.)
        postMeta.pubDate = scheduledIso;
      }

      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          postMeta,
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
      const wpStatus = result.wpStatus ?? action;
      setResultStatus(wpStatus);
      dispatch({
        type: "SET_PUBLISH_STATUS",
        status: "published",
        wpPostId: result.wpPostId,
        wpLink: result.wpLink,
        wpEditUrl: result.editUrl,
        wpStatus,
        wpScheduledGmt: result.wpDateGmt ?? null,
      });

      // WordPress is live/scheduled/drafted — now fan out to Buffer for every
      // approved channel. The server reads WP's actual status to pick the mode
      // and the time; we just pass the stagger slot.
      for (let i = 0; i < approvedDestinations.length; i++) {
        await submitOneBuffer(approvedDestinations[i], i);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
      dispatch({ type: "SET_PUBLISH_STATUS", status: "error" });
    } finally {
      setPublishing(false);
    }
  }

  // (Re-)send a single destination to Buffer after publish. Works for failed
  // sends, for channels skipped at publish time, and for re-pushing one that
  // already went through. The server re-checks the live WP status each time, so
  // an already-published article queues while a still-scheduled one schedules
  // after its go-live — no reliance on stale client state.
  async function resendBuffer(dest: Destination) {
    const index = bufferDestinations.findIndex((d) => d.id === dest.id);
    setPublishing(true);
    try {
      await submitOneBuffer(dest, Math.max(0, index));
    } finally {
      setPublishing(false);
    }
  }

  const featuredImg = state.images.find(
    (i) => i.type === "featured" && i.processed,
  );
  const featuredBase =
    featuredImg?.processedName?.replace(/\.webp$/, "") ||
    (fm.title ? generateSlug(fm.title) : "featured");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">
          Review social posts & publish
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Review each social post below — edit the copy, then approve it for
          Buffer or skip it. Once every channel is decided, publish now,
          schedule it, or save everything as drafts.
        </p>
      </div>

      {/* Result confirmation */}
      {isPublished && (
        <div className="p-4 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/30 space-y-1">
          <p className="text-sm font-medium text-[var(--success)]">
            {resultStatus === "future"
              ? "Scheduled! WordPress will publish at the chosen time, and approved socials are scheduled to follow."
              : resultStatus === "draft"
                ? "Saved as a WordPress draft, with approved socials saved as Buffer drafts."
                : "Published! WordPress is live and approved socials are queued in Buffer."}
          </p>
          {state.wpPostId && (
            <p className="text-xs text-[var(--muted)]">
              WordPress post #{state.wpPostId}
            </p>
          )}
          {state.wpEditUrl && (
            <a
              href={state.wpEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] block"
            >
              Edit in WP admin →
            </a>
          )}
          {state.wpLink && (
            <a
              href={state.wpLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--primary)] block"
            >
              View post → {state.wpLink}
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* Buffer review cards */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--foreground)]">
          Buffer channels
          {!isPublished && (
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              {approvedDestinations.length} approved ·{" "}
              {pendingBuffer.length} pending
            </span>
          )}
        </h3>
        {bufferDestinations.map((dest) => (
          <ReviewCard
            key={dest.id}
            dest={dest}
            copy={copyOf(dest)}
            onCopyChange={(v) => updateCopy(dest, v)}
            reviewStatus={reviewOf(dest.id)}
            onApprove={() => setReview(dest.id, "approved")}
            onSkip={() => setReview(dest.id, "skipped")}
            onReset={() => setReview(dest.id, null)}
            isPublished={isPublished}
            wpStatus={state.wpStatus ?? resultStatus}
            resolvedMode={bufferModes[dest.id]}
            submission={state.bufferSubmissions[dest.id]}
            bufferError={bufferErrors[dest.id]}
            onResend={() => resendBuffer(dest)}
            sending={publishing}
            featuredImg={featuredImg}
            featuredBase={featuredBase}
            draftId={state.draftId}
          />
        ))}
      </div>

      {/* Manual (non-Buffer) destinations — GMB. Reference only. */}
      {manualDestinations.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Manual posting
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              copy &amp; paste — not sent to Buffer
            </span>
          </h3>
          {manualDestinations.map((dest) => (
            <ReviewCard
              key={dest.id}
              dest={dest}
              copy={copyOf(dest)}
              onCopyChange={(v) => updateCopy(dest, v)}
              reviewStatus={undefined}
              onApprove={() => {}}
              onSkip={() => {}}
              onReset={() => {}}
              isPublished={isPublished}
              wpStatus={state.wpStatus ?? resultStatus}
              submission={undefined}
              bufferError={undefined}
              onResend={() => {}}
              sending={publishing}
              featuredImg={featuredImg}
              featuredBase={featuredBase}
              draftId={state.draftId}
            />
          ))}
        </div>
      )}

      {/* Publish bar */}
      {!isPublished && (
        <div className="pt-4 border-t border-[var(--border)] space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleFinalAction("publish")}
              disabled={!canPublish}
              className="px-6 py-2.5 rounded-lg bg-[var(--success)] text-white text-sm font-medium hover:bg-[var(--success)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishing ? "Publishing..." : "Publish Live"}
            </button>
            <button
              onClick={() => handleFinalAction("draft")}
              disabled={!canPublish}
              className="px-6 py-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishing ? "Saving..." : "Save as Drafts"}
            </button>
          </div>

          {/* Schedule row */}
          <div className="p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-3">
            <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block">
              Schedule for
            </label>
            <SchedulePicker value={scheduledFor} onChange={setScheduledFor} />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => handleFinalAction("future")}
                disabled={!canPublish || !scheduleInFuture}
                className="px-6 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !scheduleInFuture
                    ? "Pick a date and time in the future"
                    : undefined
                }
              >
                {publishing ? "Scheduling..." : "Schedule"}
              </button>
              <p className="text-xs text-[var(--muted)] flex-1 min-w-[12rem]">
                WordPress auto-publishes at this time (your site&rsquo;s
                timezone). Approved socials are scheduled in Buffer about a day
                later, so the article is safely live first, staggered 30 min
                apart.
              </p>
            </div>
          </div>

          {!hasMeta && (
            <p className="text-xs text-[var(--warning)]">
              Fill in title and description in Step 3 first.
            </p>
          )}
          {hasMeta && !allBufferResolved && (
            <p className="text-xs text-[var(--warning)]">
              Approve or skip every Buffer channel above first (
              {pendingBuffer.map((d) => d.name).join(", ")}).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** datetime-local default: tomorrow at 09:00 in the browser's local zone,
 * formatted as "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> wants). */
function defaultScheduleLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse "YYYY-MM-DDTHH:mm" (local) into parts. minutes = minutes-of-day. */
function parseLocalDateTime(
  value: string,
): { year: number; month: number; day: number; minutes: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    minutes: Number(m[4]) * 60 + Number(m[5]),
  };
}

function formatLocalDateTime(
  year: number,
  month: number,
  day: number,
  minutes: number,
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function timeLabel(minutes: number): string {
  let hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  return `${hh}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** Calendar (click a day) + 30-min time dropdown. Reads/writes the same
 * "YYYY-MM-DDTHH:mm" local string the wizard already uses, so scheduling
 * logic upstream is unchanged. */
function SchedulePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const parsed =
    parseLocalDateTime(value) ?? parseLocalDateTime(defaultScheduleLocal())!;
  const [view, setView] = useState({ year: parsed.year, month: parsed.month });

  const now = new Date();
  const todayY = now.getFullYear();
  const todayM = now.getMonth();
  const todayD = now.getDate();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const atCurrentMonth = view.year === todayY && view.month === todayM;
  const isSelectedToday =
    parsed.year === todayY && parsed.month === todayM && parsed.day === todayD;

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const timeOptions: number[] = [];
  for (let t = 0; t < 24 * 60; t += 30) timeOptions.push(t);

  const readable = new Date(
    parsed.year,
    parsed.month,
    parsed.day,
    Math.floor(parsed.minutes / 60),
    parsed.minutes % 60,
  ).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-wrap gap-4">
      {/* Calendar */}
      <div className="w-60 rounded-lg bg-[var(--background)] border border-[var(--border)] p-3">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={atCurrentMonth}
            className="px-2 py-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="text-xs font-medium text-[var(--foreground)]">
            {MONTHS[view.month]} {view.year}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="px-2 py-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-[10px] text-[var(--muted)] py-1">
              {w}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`e${i}`} />;
            const isPast =
              view.year === todayY && view.month === todayM && day < todayD;
            const isSelected =
              day === parsed.day &&
              view.year === parsed.year &&
              view.month === parsed.month;
            const isToday =
              view.year === todayY && view.month === todayM && day === todayD;
            return (
              <button
                key={day}
                type="button"
                disabled={isPast}
                onClick={() =>
                  onChange(
                    formatLocalDateTime(
                      view.year,
                      view.month,
                      day,
                      parsed.minutes,
                    ),
                  )
                }
                className={`text-xs rounded py-1 ${
                  isSelected
                    ? "bg-[var(--primary)] text-white"
                    : isPast
                      ? "text-[var(--muted)] opacity-40 cursor-not-allowed"
                      : "text-[var(--foreground)] hover:bg-[var(--surface)]"
                } ${isToday && !isSelected ? "ring-1 ring-[var(--primary)]/50" : ""}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time + readout */}
      <div className="space-y-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--muted)] block mb-1">
            Time
          </label>
          <select
            value={parsed.minutes}
            onChange={(e) =>
              onChange(
                formatLocalDateTime(
                  parsed.year,
                  parsed.month,
                  parsed.day,
                  Number(e.target.value),
                ),
              )
            }
            className="px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] text-sm focus:outline-none focus:border-[var(--primary)]"
          >
            {timeOptions.map((t) => (
              <option
                key={t}
                value={t}
                disabled={isSelectedToday && t <= nowMinutes}
              >
                {timeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-[var(--muted)]">{readable}</p>
      </div>
    </div>
  );
}

function ReviewCard({
  dest,
  copy,
  onCopyChange,
  reviewStatus,
  onApprove,
  onSkip,
  onReset,
  isPublished,
  wpStatus,
  resolvedMode,
  submission,
  bufferError,
  onResend,
  sending,
  featuredImg,
  featuredBase,
  draftId,
}: {
  dest: Destination;
  copy: string;
  onCopyChange: (value: string) => void;
  reviewStatus: ReviewStatus | undefined;
  onApprove: () => void;
  onSkip: () => void;
  onReset: () => void;
  isPublished: boolean;
  wpStatus: string | null;
  resolvedMode?: BufferMode;
  submission: { bufferPostId: string; submittedAt: string } | undefined;
  bufferError: string | undefined;
  onResend: () => void;
  sending: boolean;
  featuredImg: ClientImage | undefined;
  featuredBase: string;
  draftId: string | null;
}) {
  const destUrl = getDestinationUrl(dest);
  const isBuffer = !!dest.bufferService;
  const overLimit = dest.maxChars ? copy.length > dest.maxChars : false;
  const empty = !copy.trim();

  // Border tint reflects the review decision (Buffer channels only).
  const tint =
    !isBuffer || isPublished
      ? "border-[var(--border)]"
      : reviewStatus === "approved"
        ? "border-[var(--success)]/50"
        : reviewStatus === "skipped"
          ? "border-[var(--border)] opacity-70"
          : "border-[var(--warning)]/40";

  return (
    <div className={`rounded-lg border ${tint} bg-[var(--surface)] p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {dest.name}
          </p>
          <p className="text-xs text-[var(--muted)]">{dest.description}</p>
        </div>
        {/* Approve / Skip controls (Buffer channels, pre-publish) */}
        {isBuffer && !isPublished && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={onApprove}
              disabled={empty || overLimit}
              title={
                empty
                  ? "Add copy first"
                  : overLimit
                    ? `Over the ${dest.maxChars}-char limit`
                    : undefined
              }
              className={`text-xs px-2.5 py-1 rounded ${
                reviewStatus === "approved"
                  ? "bg-[var(--success)] text-white"
                  : "bg-[var(--success)]/15 text-[var(--success)] hover:bg-[var(--success)]/25"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {reviewStatus === "approved" ? "Approved ✓" : "Approve"}
            </button>
            <button
              onClick={onSkip}
              className={`text-xs px-2.5 py-1 rounded ${
                reviewStatus === "skipped"
                  ? "bg-[var(--border)] text-[var(--foreground)]"
                  : "bg-[var(--border)]/60 text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {reviewStatus === "skipped" ? "Skipped" : "Skip"}
            </button>
            {reviewStatus && (
              <button
                onClick={onReset}
                title="Clear decision"
                className="text-xs px-1.5 py-1 rounded text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                ↺
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <CharCount value={copy} maxChars={dest.maxChars} />
          <PostToSiteButton
            value={copy}
            destUrl={destUrl}
            copyMode={dest.copyMode}
          />
        </div>
        <textarea
          value={copy}
          onChange={(e) => onCopyChange(e.target.value)}
          placeholder="(Generate social copy in Step 4, or write it here)"
          className="w-full text-xs text-[var(--foreground)] bg-[var(--background)] border border-[var(--border)] rounded p-2 font-sans min-h-[8rem] resize-y focus:outline-none focus:border-[var(--primary)]"
        />
      </div>

      {/* Buffer submission status + (re-)send (post-publish) */}
      {isBuffer && isPublished && (
        <BufferStatus
          dest={dest}
          submission={submission}
          reviewStatus={reviewStatus}
          wpStatus={wpStatus}
          resolvedMode={resolvedMode}
          bufferError={bufferError}
          onResend={onResend}
          sending={sending}
          disabled={!copy.trim() || overLimit}
        />
      )}

      {/* GMB / manual note */}
      {!isBuffer && (
        <p className="text-[10px] text-[var(--muted)]">
          Post manually to {dest.name} using the copy button above.
        </p>
      )}

      {dest.hasSocialImage && (
        <ImageDownloads
          dest={dest}
          featuredImage={featuredImg}
          featuredBase={featuredBase}
          draftId={draftId}
        />
      )}
    </div>
  );
}

function BufferStatus({
  dest,
  submission,
  reviewStatus,
  wpStatus,
  resolvedMode,
  bufferError,
  onResend,
  sending,
  disabled,
}: {
  dest: Destination;
  submission: { bufferPostId: string; submittedAt: string } | undefined;
  reviewStatus: ReviewStatus | undefined;
  wpStatus: string | null;
  resolvedMode?: BufferMode;
  bufferError: string | undefined;
  onResend: () => void;
  sending: boolean;
  disabled: boolean;
}) {
  // Prefer the mode the server actually used; fall back to the WP status only
  // before a (re-)send has reported back.
  const effectiveMode: BufferMode =
    resolvedMode ??
    (wpStatus === "future" ? "scheduled" : wpStatus === "draft" ? "draft" : "queue");
  const verb =
    effectiveMode === "scheduled"
      ? "Scheduled in Buffer"
      : effectiveMode === "draft"
        ? "Saved as Buffer draft"
        : "Queued in Buffer";

  // A (re-)send button is always available after publish — for failed sends,
  // for channels skipped at publish time, and to re-push one that went through.
  const sendLabel = sending
    ? "Sending…"
    : submission
      ? `Re-send to ${dest.name}`
      : `Send to ${dest.name}`;

  return (
    <div className="space-y-2">
      {submission && (
        <div className="p-2.5 rounded bg-[var(--success)]/10 border border-[var(--success)]/30 text-[10px]">
          <p className="font-medium text-[var(--success)]">{verb} ✓</p>
          <p className="text-[var(--muted)] mt-0.5">
            Buffer post id:{" "}
            <code className="font-mono">{submission.bufferPostId}</code>
            {" · "}
            {new Date(submission.submittedAt).toLocaleString()}
          </p>
        </div>
      )}

      {!submission && reviewStatus === "skipped" && (
        <p className="text-[10px] text-[var(--muted)]">
          Skipped at publish — not sent to Buffer. You can still send it now.
        </p>
      )}

      {bufferError && (
        <p className="text-[10px] text-[var(--danger)]">
          Buffer failed: {bufferError}
        </p>
      )}

      <button
        onClick={onResend}
        disabled={sending || disabled}
        title={disabled ? "Add copy within the character limit first" : undefined}
        className="text-[10px] px-2 py-1 rounded bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sendLabel}
      </button>
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
  featuredImage: ClientImage | undefined;
  featuredBase: string;
  draftId: string | null;
}) {
  if (!featuredImage || !draftId) {
    return (
      <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
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
    <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
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
            {dest.bufferService
              ? `Sent to Buffer automatically with this ${dest.name} post.`
              : `Upload with your ${dest.name} post.`}
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
    </div>
  );
}

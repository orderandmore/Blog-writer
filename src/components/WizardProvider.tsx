"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  wizardReducer,
  initialWizardState,
  type WizardState,
  type WizardAction,
  type ClientImage,
} from "@/lib/wizard-store";
import type { ImageMeta } from "@/lib/schema";

const WizardContext = createContext<{
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
} | null>(null);

const AUTOSAVE_DEBOUNCE_MS = 1000;

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  const searchParams = useSearchParams();
  const draftIdFromUrl = searchParams.get("draft");

  const hydratingRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const justLoadedRef = useRef(false);
  const creatingDraftRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedRef = useRef<string>("");

  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (!draftIdFromUrl) {
      hasHydratedRef.current = true;
      return;
    }

    hydratingRef.current = true;
    fetch(`/api/drafts/${encodeURIComponent(draftIdFromUrl)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ draft }) => {
        const images: ClientImage[] = (
          (draft.images as ImageMeta[]) || []
        ).map((meta) => ({
          ...meta,
          file: null,
          thumbnailUrl: meta.processed
            ? `/api/drafts/${draft.id}/scratch/${meta.id}-processed`
            : "",
          seoFilename: (meta.processedName || "").replace(/\.[^.]+$/, ""),
        }));

        // Draft's `frontmatter` column carries the postMeta JSON (column kept
        // for migration compat; the shape changed but the storage didn't).
        const basePostMeta = (draft.frontmatter as Record<string, unknown>) || {
          status: "draft",
          categoryIds: [],
          tags: [],
        };
        const seededTitle =
          (basePostMeta.title as string) ||
          (draft.title as string) ||
          (draft.parsed_title as string) ||
          "";
        const postMeta = seededTitle
          ? { ...basePostMeta, title: seededTitle }
          : basePostMeta;

        justLoadedRef.current = true;
        dispatch({
          type: "LOAD_DRAFT",
          state: {
            draftId: draft.id,
            topicId: draft.topic_id ?? null,
            topicNotes: draft.topic_notes ?? null,
            rawMarkdown: draft.markdown || "",
            parsedTitle: draft.parsed_title ?? null,
            parsedBody: draft.parsed_body ?? "",
            wordCount: countWords(draft.parsed_body ?? draft.markdown ?? ""),
            readingTime: readingTimeFor(
              draft.parsed_body ?? draft.markdown ?? "",
            ),
            headings: [],
            postMeta,
            images,
            socialCopy: draft.social_copy ?? null,
            postedDestinations: draft.posted_destinations ?? [],
            bufferSubmissions: draft.buffer_submissions ?? {},
            socialReview: draft.social_review ?? {},
            currentStep: draft.current_step ?? 1,
            metadataAiDone: Boolean(postMeta.description),
            publishStatus:
              draft.status === "published" ? "published" : "idle",
            wpPostId: (draft.wp_post_id as number) ?? null,
            wpLink: (draft.wp_link as string) ?? null,
          },
        });
      })
      .catch(() => {
        // not found / load failed — start fresh
      })
      .finally(() => {
        hydratingRef.current = false;
        hasHydratedRef.current = true;
      });
  }, [draftIdFromUrl]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    if (hydratingRef.current) return;

    const hasContent =
      state.rawMarkdown.length > 0 ||
      Boolean(state.postMeta.title) ||
      state.images.length > 0;
    if (!hasContent) return;

    if (justLoadedRef.current) {
      justLoadedRef.current = false;
      lastSerializedRef.current = JSON.stringify(buildPayload(state));
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist(state);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };

    async function persist(s: WizardState) {
      const payload = buildPayload(s);
      const serialized = JSON.stringify(payload);
      if (serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;

      let id = s.draftId;

      if (!id) {
        if (creatingDraftRef.current) return;
        creatingDraftRef.current = true;
        try {
          const res = await fetch("/api/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create" }),
          });
          if (!res.ok) throw new Error("create failed");
          const { id: newId } = await res.json();
          id = newId;
          dispatch({ type: "SET_DRAFT_ID", id: newId });
        } catch {
          creatingDraftRef.current = false;
          return;
        }
        creatingDraftRef.current = false;
      }

      if (!id) return;
      await fetch(`/api/drafts/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: serialized,
      }).catch(() => {});
    }
  }, [state]);

  return (
    <WizardContext.Provider value={{ state, dispatch }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}

function buildPayload(s: WizardState) {
  const images = s.images.map((img) => {
    const { file: _f, thumbnailUrl: _t, ...rest } = img;
    void _f;
    void _t;
    return rest;
  });

  return {
    title: s.postMeta.title ?? null,
    slug: (s.postMeta as Record<string, unknown>).slug ?? null,
    markdown: s.rawMarkdown,
    parsed_title: s.parsedTitle,
    parsed_body: s.parsedBody,
    frontmatter: s.postMeta,
    images,
    social_copy: s.socialCopy,
    posted_destinations: s.postedDestinations,
    social_review: s.socialReview,
    current_step: s.currentStep,
    topic_id: s.topicId,
    topic_notes: s.topicNotes,
    status: s.publishStatus === "published" ? "published" : "draft",
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function readingTimeFor(text: string): number {
  return Math.max(1, Math.ceil(countWords(text) / 200));
}

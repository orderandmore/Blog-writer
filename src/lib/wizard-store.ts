/**
 * Wizard state management. React context + useReducer for the 5-step flow,
 * state auto-saved to the server.
 */

import type { PostMeta, ImageMeta, SocialCopyBundle } from "./schema";

export const STEPS = [
  { id: 1, label: "Content", description: "Paste markdown or draft with AI" },
  { id: 2, label: "Images", description: "Upload, name, and process images" },
  { id: 3, label: "Metadata", description: "AI-assisted title, SEO, categories" },
  { id: 4, label: "Syndication", description: "Social copy for FB / IG / X / Pinterest" },
  { id: 5, label: "Review", description: "Preview & publish to WordPress" },
] as const;

/** Client-side image data (includes File object + thumbnail URL). */
export interface ClientImage extends ImageMeta {
  file: File | null;
  thumbnailUrl: string;
  seoFilename: string;
}

export interface WizardState {
  currentStep: number;
  draftId: string | null;

  topicId: string | null;
  topicNotes: string | null;

  // Step 1
  rawMarkdown: string;
  parsedTitle: string | null;
  parsedBody: string;
  wordCount: number;
  readingTime: number;
  headings: Array<{ level: number; text: string }>;

  // Step 2
  images: ClientImage[];

  // Step 3 — postMeta replaces frontmatter
  postMeta: Partial<PostMeta>;
  metadataAiLoading: boolean;
  metadataAiDone: boolean;

  // Step 4
  socialCopy: Partial<SocialCopyBundle> | null;

  // Step 5
  publishStatus: "idle" | "publishing" | "published" | "error";
  wpPostId: number | null;
  wpLink: string | null;
  wpEditUrl: string | null;
  postedDestinations: string[];
  bufferSubmissions: Record<string, { bufferPostId: string; submittedAt: string }>;
}

export type WizardAction =
  | { type: "SET_STEP"; step: number }
  | { type: "SET_DRAFT_ID"; id: string }
  | { type: "SET_TOPIC_NOTES"; notes: string }
  | {
      type: "SET_CONTENT";
      rawMarkdown: string;
      parsedTitle: string | null;
      parsedBody: string;
      wordCount: number;
      readingTime: number;
      headings: Array<{ level: number; text: string }>;
    }
  | { type: "UPDATE_POST_META"; fields: Partial<PostMeta> }
  | { type: "UPDATE_PARSED_BODY"; body: string }
  | { type: "SET_IMAGES"; images: ClientImage[] }
  | { type: "UPDATE_IMAGE"; id: string; updates: Partial<ClientImage> }
  | { type: "SET_SOCIAL_COPY"; copy: Partial<SocialCopyBundle> }
  | { type: "SET_METADATA_AI_LOADING"; loading: boolean }
  | { type: "SET_METADATA_AI_DONE" }
  | {
      type: "SET_PUBLISH_STATUS";
      status: WizardState["publishStatus"];
      wpPostId?: number;
      wpLink?: string;
      wpEditUrl?: string;
    }
  | { type: "TOGGLE_POSTED_DESTINATION"; destId: string }
  | {
      type: "RECORD_BUFFER_SUBMISSION";
      destId: string;
      bufferPostId: string;
      submittedAt: string;
    }
  | { type: "LOAD_DRAFT"; state: Partial<WizardState> }
  | { type: "RESET_WIZARD" };

export const initialWizardState: WizardState = {
  currentStep: 1,
  draftId: null,
  topicId: null,
  topicNotes: null,
  rawMarkdown: "",
  parsedTitle: null,
  parsedBody: "",
  wordCount: 0,
  readingTime: 0,
  headings: [],
  postMeta: {
    status: "draft",
    categoryIds: [],
    tags: [],
  },
  images: [],
  metadataAiLoading: false,
  metadataAiDone: false,
  socialCopy: null,
  publishStatus: "idle",
  wpPostId: null,
  wpLink: null,
  wpEditUrl: null,
  postedDestinations: [],
  bufferSubmissions: {},
};

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, currentStep: action.step };

    case "SET_DRAFT_ID":
      return { ...state, draftId: action.id };

    case "SET_TOPIC_NOTES":
      return { ...state, topicNotes: action.notes };

    case "SET_CONTENT":
      return {
        ...state,
        rawMarkdown: action.rawMarkdown,
        parsedTitle: action.parsedTitle,
        parsedBody: action.parsedBody,
        wordCount: action.wordCount,
        readingTime: action.readingTime,
        headings: action.headings,
        postMeta: {
          ...state.postMeta,
          title: state.postMeta.title || action.parsedTitle || "",
        },
      };

    case "UPDATE_POST_META":
      return { ...state, postMeta: { ...state.postMeta, ...action.fields } };

    case "UPDATE_PARSED_BODY": {
      const words = action.body
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
      return {
        ...state,
        parsedBody: action.body,
        wordCount: words,
        readingTime: Math.max(1, Math.ceil(words / 200)),
      };
    }

    case "SET_IMAGES":
      return { ...state, images: action.images };

    case "UPDATE_IMAGE": {
      const images = state.images.map((img) =>
        img.id === action.id ? { ...img, ...action.updates } : img,
      );
      return { ...state, images };
    }

    case "SET_SOCIAL_COPY":
      return { ...state, socialCopy: action.copy };

    case "SET_METADATA_AI_LOADING":
      return { ...state, metadataAiLoading: action.loading };

    case "SET_METADATA_AI_DONE":
      return { ...state, metadataAiLoading: false, metadataAiDone: true };

    case "SET_PUBLISH_STATUS":
      return {
        ...state,
        publishStatus: action.status,
        wpPostId: action.wpPostId ?? state.wpPostId,
        wpLink: action.wpLink ?? state.wpLink,
        wpEditUrl: action.wpEditUrl ?? state.wpEditUrl,
      };

    case "RECORD_BUFFER_SUBMISSION":
      return {
        ...state,
        bufferSubmissions: {
          ...state.bufferSubmissions,
          [action.destId]: {
            bufferPostId: action.bufferPostId,
            submittedAt: action.submittedAt,
          },
        },
      };

    case "TOGGLE_POSTED_DESTINATION": {
      const has = state.postedDestinations.includes(action.destId);
      const next = has
        ? state.postedDestinations.filter((d) => d !== action.destId)
        : [...state.postedDestinations, action.destId];
      return { ...state, postedDestinations: next };
    }

    case "LOAD_DRAFT":
      return { ...state, ...action.state };

    case "RESET_WIZARD":
      return { ...initialWizardState };

    default:
      return state;
  }
}

/**
 * Models surfaced in the article draft + revise UI.
 *
 * Update this list when Anthropic ships a newer model in any of the three
 * tiers. The id strings are what the API expects; if a model is retired,
 * remove it here and the dropdown will stop offering it.
 */
export const ARTICLE_MODELS = [
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    hint: "Best quality, slowest",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    hint: "Balanced — default",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    hint: "Fastest, cheapest",
  },
] as const;

export type ArticleModelId = (typeof ARTICLE_MODELS)[number]["id"];

// Article drafting uses the best-quality model by default — voice fidelity
// matters more than cost on this single call. Cheap ops (SEO meta, slugs,
// tags, alt text, social copy) use LLM_MODEL from env, defaulting to Sonnet.
// Per-post override is available in the Content step UI.
export const DEFAULT_ARTICLE_MODEL: ArticleModelId = "claude-opus-4-7";

export function isArticleModel(value: unknown): value is ArticleModelId {
  return (
    typeof value === "string" &&
    ARTICLE_MODELS.some((m) => m.id === value)
  );
}

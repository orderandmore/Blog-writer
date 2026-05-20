import fs from "fs";
import path from "path";
import { getPromptOverride } from "./db";

/**
 * Prompt registry for Patty's blog (orderandmore.com). Every prompt the AI
 * route uses is keyed here. Each key has a default baked in at ship time; an
 * optional override in the Postgres `prompt_overrides` table wins when
 * present. The Settings UI reads/writes those overrides.
 *
 * Template variables like {{title}}, {{body}}, {{brandRules}} are substituted
 * by `renderPrompt()` after resolution.
 *
 * NOTE: resolvePrompt and renderPrompt are async — they touch the DB. All
 * callers must await.
 */

// brand.md lives on disk; loader is sync for first-boot. Override flow goes
// through the DB.
function loadBrandDefault(): string {
  try {
    const p = path.join(process.cwd(), "prompts", "brand.md");
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf-8");
      return content.replace(/^---[\s\S]*?---\n*/m, "").trim();
    }
  } catch {}
  return "";
}

// Voice samples (excerpts pulled from her existing posts) are loaded once at
// boot for use in articleDraft / articleRevise prompts. Inject 2-3 short
// excerpts inline as few-shot anchors.
function loadVoiceSamplesBlock(): string {
  try {
    const p = path.join(process.cwd(), "data", "voice-samples.json");
    if (!fs.existsSync(p)) return "";
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as {
      excerpts?: Array<{ purpose: string; text: string }>;
      samples?: Array<{
        title: string;
        excerpts: Record<string, string>;
      }>;
    };

    const lines: string[] = [];
    if (data.excerpts && data.excerpts.length > 0) {
      for (const e of data.excerpts.slice(0, 6)) {
        lines.push(`[${e.purpose}] ${e.text}`);
      }
    } else if (data.samples) {
      for (const s of data.samples.slice(0, 3)) {
        const opener = s.excerpts?.opener;
        const anecdote =
          s.excerpts?.personalAnecdote || s.excerpts?.longPersonalAnecdote;
        if (opener) lines.push(`[opener] ${opener}`);
        if (anecdote) lines.push(`[anecdote] ${anecdote}`);
      }
    }
    if (lines.length === 0) return "";
    return `\n\nVoice samples from Patty's existing posts — match this cadence, register, and use of personal stories:\n\n${lines.join("\n\n")}`;
  } catch {
    return "";
  }
}

const BRAND_DEFAULT = loadBrandDefault();
const VOICE_BLOCK = loadVoiceSamplesBlock();

const DEFAULTS: Record<string, string> = {
  brand: BRAND_DEFAULT,

  // metadata-batch (all SEO fields in one call)
  "metadata-batch.system":
    "You are an SEO assistant writing for Patty Powers' home organizing blog at orderandmore.com (Littleton, Colorado). {{brandRules}}\n\nReturn ONLY valid JSON. No markdown, no explanation.",
  "metadata-batch.user":
    'Generate post metadata for this article.\n\nTitle: {{title}}\n\nArticle:\n{{body}}\n\nReturn a JSON object with these exact keys:\n- "description": 150-160 character meta description in Patty\'s voice (first-person ok if it fits naturally). Used as the WordPress post excerpt AND meta description.\n- "seoTitle": 50-60 character SEO title. Patty\'s existing posts often include "Littleton, Colorado" when topically relevant; do not append a brand suffix.\n- "seoDescription": 150-160 character search-result snippet optimized for click-through. May echo description but should not be identical.\n- "tags": array of 3-5 tags. Match her existing convention — single word or camelCase, lowercase ok: examples are "DeclutteringService", "Homeorganizing", "LittletonProfessionalOrganizer", "Downsizing", "Closetorganizer". Don\'t default to hyphenated slugs.\n- "focusKeyword": 1-3 word focus keyword phrase for Yoast/RankMath if present (e.g. "decluttering paperwork", "home organizing Littleton").',

  // description (individual regen)
  "description.system":
    "You are writing a meta description for Patty Powers' home organizing blog. {{brandRules}}\n\nReturn ONLY the description text, nothing else.",
  "description.user":
    "Write a 150-160 character meta description for this blog post. This will be used as both the WordPress excerpt and SEO meta description.\n\nTitle: {{title}}\n\nArticle:\n{{body}}",

  // seoTitle
  "seoTitle.system":
    "You are writing an SEO title for Patty Powers' home organizing blog. {{brandRules}}\n\nReturn ONLY the title text, nothing else. Do NOT append a brand suffix unless the user prompt explicitly asks for one.",
  "seoTitle.user":
    'Write a 50-60 character SEO title for this blog post. If the topic has a clear location angle, including "Littleton, Colorado" or "Littleton" is welcome but not required.\n\nTitle: {{title}}\n\nArticle (first 500 words):\n{{body}}',

  // seoDescription
  "seoDescription.system":
    "You are writing an SEO description for Patty Powers' home organizing blog. {{brandRules}}\n\nReturn ONLY the description text, nothing else.",
  "seoDescription.user":
    "Write a 150-160 character SEO meta description for this blog post. Optimize for click-through from search results.\n\nTitle: {{title}}\n\nArticle:\n{{body}}",

  // tags
  "tags.system":
    "You are tagging a post for Patty's home organizing blog. {{brandRules}}\n\nReturn ONLY a JSON array of strings, nothing else.",
  "tags.user":
    'Suggest 3-5 tags for this blog post. Match Patty\'s existing convention — camelCase or run-together lowercase: e.g. "DeclutteringService", "Homeorganizing", "LittletonProfessionalOrganizer", "Closetorganizer". Don\'t hyphenate.\n\nTitle: {{title}}\n\nArticle (first 500 words):\n{{body}}',

  // image-filenames (suggest SEO filenames for uploaded images)
  "image-filenames.system":
    "You suggest SEO-friendly image filenames for Patty's organizing blog. Return ONLY a JSON array of strings, nothing else.",
  "image-filenames.user":
    'Suggest descriptive filenames for {{imageCount}} images in a home-organizing blog post.\n\nTitle: {{title}}\nImage types: {{imageTypes}}\n\nArticle excerpt:\n{{body}}\n\nReturn a JSON array of {{imageCount}} filename strings (lowercase, hyphenated, 3-6 words, no extension). Featured images should be topical/general; body images can be specific to the section they illustrate. Example: ["organized-pantry-littleton-colorado", "labeled-spice-jars-lazy-susan"]',

  // alt-text (NEW — generate accessible alt text for uploaded images)
  "alt-text.system":
    "You write accessible image alt text for Patty's home organizing blog. Return ONLY a JSON array of strings, one alt-text per image, nothing else.",
  "alt-text.user":
    'Write alt text for {{imageCount}} images in this blog post. Each alt should describe what is visually in the image in 8-15 words — concrete and specific. Don\'t start with "Image of" or "Photo of". If a filename hint is provided, use it as inspiration but describe the actual subject.\n\nTitle: {{title}}\nFilename hints: {{filenames}}\nArticle excerpt:\n{{body}}\n\nReturn a JSON array of {{imageCount}} alt-text strings.',

  // socialAndPress (key name kept for migration compat) — produces only
  // social copy for Facebook, Instagram, LinkedIn, GMB. No press releases.
  "socialAndPress.system":
    "You write social media copy for Patty Powers' home organizing business (Order and More LLC, Littleton, Colorado). {{brandRules}}\n\nNo hashtags on any platform. Stay strictly within the character limits noted per platform — count URLs toward the total where the platform description says so. STRICT compliance with the GMB limit (1500 chars) is critical — aim for ~800-1000 chars there, never exceed 1450.\n\nThe article URL provided in the user prompt ({{url}}) is the canonical permalink. When a platform requires a URL, use exactly that URL verbatim — no shorteners. Facebook and LinkedIn MUST contain this exact URL at the end. Where the URL appears at the end (Facebook, LinkedIn), reserve room for its full length within the character limit and shorten the body if needed — the link must never be cut off. Instagram and GMB do NOT include URLs.",
  "socialAndPress.user":
    "Generate social media copy for this blog post.\n\nTitle: {{title}}\nArticle URL: {{url}}\nContact: {{contactName}}, {{contactEmail}}{{contactPhoneSuffix}}\n\nArticle:\n{{body}}{{linksBlock}}",

  // articleDraft — full Markdown post from a topic + notes
  "articleDraft.system":
    "You are drafting a blog post for Patty Powers, professional home organizer in Littleton, Colorado, writing in HER voice. {{brandRules}}{{voiceSamples}}\n\nWrite a complete Markdown post: one `#` H1 title, a 2-3 paragraph intro, then 4-6 `##` H2 sections, finishing with a CTA-style closing H2 (e.g. \"Ready to Tackle Your Pantry?\"). Use **bold** for tip headings inside sections (Pro Tip:, My favorite trick:, etc.). Weave 2-4 internal links from the provided list as inline `[text](url)` Markdown — never as a bare list at the end. Include 1-2 conversational asides (e.g. \"Nope, that's a trick, lol!\", \"Game changer!\", \"I'll get off my soapbox now\") only where they earn their place. Anchor at least one paragraph in a personal-experience frame (\"In my own house...\", \"Many of my clients in Littleton...\"). Word count: 700-1100. Return ONLY the Markdown — no preamble, no code fences.",
  "articleDraft.user":
    "Topic: {{title}}\n\nNotes / outline:\n{{notes}}{{linksBlock}}\n\nDraft the post now. Start with `# {{title}}` (or a tightened title you derive from the topic).",

  // articleRevise — apply a single instruction to the current article body
  "articleRevise.system":
    "You are revising a Patty Powers home organizing blog post. {{brandRules}}{{voiceSamples}}\n\nApply the user's instruction. Keep what the instruction doesn't affect. Preserve the Markdown structure (heading hierarchy, inline link syntax, paragraph breaks). You may add new internal links from the provided list when the instruction implies it. Return ONLY the full revised Markdown — no commentary, no fences.",
  "articleRevise.user":
    "Instruction: {{instruction}}{{linksBlock}}\n\nCurrent article:\n\n{{article}}",

  // socialAndPress tool schema — keep platform-specific guidance as separate
  // keys so the Settings UI can edit them granularly.
  "socialAndPress.schema.gmb":
    "Google Business Profile post. AIM for 800-1000 chars; HARD CAP 1450 chars (max 1500 — never exceed). No hashtags. NO links — GMB strips them. Soft Patty-voice CTA at the end inviting Littleton-area contact. If you would write past 1100 chars, stop and tighten the paragraph — never overshoot.",
  "socialAndPress.schema.facebook":
    "Facebook caption in Patty's voice, max 500 chars, conversational. Must include the exact article URL ({{url}} in the user prompt) verbatim at the end. No hashtags.",
  "socialAndPress.schema.instagram":
    "Instagram caption in Patty's voice, conversational and image-companion-style. No hashtags. No URL (IG doesn't make links clickable).",
  "socialAndPress.schema.linkedin":
    "LinkedIn post in Patty's voice. AIM for 500-600 characters TOTAL including the trailing URL; HARD CAP 680 (never reach 700). The exact article URL ({{url}}) goes verbatim on the last line and COUNTS toward that total — leave room for it so it can never be truncated. Treat ~600 as a ceiling, not a target: if the draft runs long, cut a sentence rather than risk dropping the link. More professional and substantive than Facebook — share one clear insight or takeaway from the article, suitable for busy professionals and parents. No hashtags.",
};

export type PromptKey = keyof typeof DEFAULTS;

export function listPromptKeys(): string[] {
  return Object.keys(DEFAULTS);
}

export function getPromptDefault(key: string): string | null {
  return DEFAULTS[key] ?? null;
}

export async function resolvePrompt(key: string): Promise<string> {
  const override = await getPromptOverride(key);
  if (override !== null) return override;
  return DEFAULTS[key] ?? "";
}

export async function renderPrompt(
  key: string,
  vars: Record<string, string> = {},
): Promise<string> {
  let template = await resolvePrompt(key);
  // Auto-inject voiceSamples placeholder when present in the template
  const allVars: Record<string, string> = {
    voiceSamples: VOICE_BLOCK,
    ...vars,
  };
  for (const [name, value] of Object.entries(allVars)) {
    template = template.split(`{{${name}}}`).join(value);
  }
  return template;
}

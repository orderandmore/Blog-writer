#!/usr/bin/env node
/**
 * Voice extractor. Pulls ~15 of Patty's most recent posts from orderandmore.com,
 * strips HTML to plain text, and asks Claude Opus to produce:
 *
 *   1. An updated prompts/brand.md (10-15 numbered rules capturing voice)
 *   2. data/voice-samples.json (raw excerpts for few-shot anchoring in prompts)
 *
 * Run once during setup, or any time Patty's voice noticeably shifts and you
 * want to refresh the brand rules.
 *
 *   node scripts/extract-voice.mjs
 *   node scripts/extract-voice.mjs --dry-run  # don't overwrite prompts/brand.md
 *
 * Requires ANTHROPIC_API_KEY in .env or .env.local. ~$0.10 per run with Opus.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// Hand-parse .env files so we don't need a dotenv dep.
for (const file of [".env.local", ".env"]) {
  const p = path.join(rootDir, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const dryRun = process.argv.includes("--dry-run");
const SITE = process.env.WP_SITE_URL ?? "https://orderandmore.com";
const POST_COUNT = 15;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Add it to .env.local and retry.");
  process.exit(1);
}

console.log(`Fetching ${POST_COUNT} recent posts from ${SITE} ...`);

const res = await fetch(
  `${SITE}/wp-json/wp/v2/posts?per_page=${POST_COUNT}&_fields=id,title,slug,content,excerpt,link,date`,
);
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const posts = await res.json();
console.log(`Got ${posts.length} posts.`);

function stripHtml(html) {
  return html
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const cleanedPosts = posts.map((p) => ({
  title: p.title.rendered,
  slug: p.slug,
  date: p.date,
  link: p.link,
  excerpt: stripHtml(p.excerpt.rendered),
  text: stripHtml(p.content.rendered),
}));

const corpus = cleanedPosts
  .map(
    (p, i) =>
      `\n---\nPost ${i + 1}: ${p.title}\nURL: ${p.link}\nDate: ${p.date}\n\n${p.text}\n`,
  )
  .join("\n");

const META_PROMPT = `You are analyzing 15 blog posts written by Patty Powers, owner of Order and More LLC, a home organizing/decluttering business in Littleton, Colorado. I need you to extract her writing voice into a brand rules document that an AI will use to generate new posts in her voice.

Return STRICT JSON with this shape:

{
  "brandMd": "Markdown content for prompts/brand.md — 10 to 15 numbered rules, each with a brief explanation. Frontmatter not required.",
  "voiceSamples": [
    { "purpose": "opener", "text": "..." },
    { "purpose": "personalAnecdote", "text": "..." },
    { "purpose": "midSectionAside", "text": "..." },
    { "purpose": "closingCta", "text": "..." }
  ]
}

For brandMd, derive rules from EVIDENCE in the posts. Cover: person/POV, anecdote frequency, signature phrases, banned phrases, structure (H1/H2/lists/CTAs), tone toward reader, location anchoring, specificity (numbers vs vague), bold/em-dash conventions, hashtag/emoji policy, target word count, audience description. Quote signature phrases verbatim where possible. Banned-phrase examples should be REAL things AI tends to write that don't match her voice.

For voiceSamples, pick 4-6 of the strongest 2-4 sentence excerpts spanning her range: a vivid opener, a personal anecdote, a mid-section aside ("lol", "Game changer!", etc.), a closing CTA, optionally a numbered-list entry with a "Pro Tip:" or similar.

Source corpus (15 posts) follows below the line.
${"=".repeat(60)}
${corpus}
`;

console.log("Calling Claude Opus 4.7 ...");

const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    messages: [{ role: "user", content: META_PROMPT }],
  }),
});

if (!anthropicRes.ok) {
  console.error(`Anthropic error: ${anthropicRes.status}`);
  console.error(await anthropicRes.text());
  process.exit(1);
}

const data = await anthropicRes.json();
const raw = data.content?.[0]?.text ?? "";
const match = raw.match(/\{[\s\S]*\}/);
if (!match) {
  console.error("Could not extract JSON from model response. Full response:");
  console.error(raw);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(match[0]);
} catch (e) {
  console.error("JSON parse failed:", e.message);
  console.error("Raw:", match[0].slice(0, 500));
  process.exit(1);
}

const brandPath = path.join(rootDir, "prompts", "brand.md");
const samplesPath = path.join(rootDir, "data", "voice-samples.json");

const samplesOut = {
  extractedAt: new Date().toISOString().slice(0, 10),
  source: `${SITE}/wp-json/wp/v2/posts`,
  postCount: cleanedPosts.length,
  purpose:
    "Few-shot voice anchors for AI prompts. articleDraft and articleRevise may inject 2-3 short excerpts inline to ground generation in Patty's real cadence.",
  excerpts: parsed.voiceSamples,
  sourcePosts: cleanedPosts.map((p) => ({
    title: p.title,
    slug: p.slug,
    link: p.link,
    excerpt: p.excerpt,
  })),
};

if (dryRun) {
  console.log("\n--- DRY RUN — NOT WRITING ---\n");
  console.log("Would write prompts/brand.md:\n");
  console.log(parsed.brandMd);
  console.log("\n\nWould write data/voice-samples.json:\n");
  console.log(JSON.stringify(samplesOut, null, 2));
} else {
  fs.writeFileSync(brandPath, parsed.brandMd + "\n");
  fs.mkdirSync(path.dirname(samplesPath), { recursive: true });
  fs.writeFileSync(samplesPath, JSON.stringify(samplesOut, null, 2) + "\n");
  console.log(`\nWrote ${brandPath}`);
  console.log(`Wrote ${samplesPath}`);
  console.log("\nReview prompts/brand.md before relying on it. Hand-edit any line that misses her voice.");
}

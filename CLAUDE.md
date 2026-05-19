# Patty Blog Portal

Blog publishing portal for **orderandmore.com** — Patty Powers' home organizing/decluttering business in Littleton, CO. Takes raw markdown + images, produces WordPress posts published via the WP REST API, plus syndication copy bundles for social.

Forked from `blog-portal` (the Virtue Solar version), heavily rewired to target WordPress instead of an Astro+GitHub setup. The two codebases are independent — don't try to keep them in sync.

## Stack

- **Framework**: Next.js 16, App Router
- **Runtime**: Node.js 22 LTS
- **Database**: Postgres via `pg` (no ORM) — Neon in production
- **Hosting**: Vercel
- **Image scratch storage**: Vercel Blob (NOT local disk — Vercel filesystem is read-only)
- **Images**: Sharp
- **AI**: Anthropic Claude API (default Sonnet 4.6, configurable)
- **Publish target**: WordPress REST API (`/wp-json/wp/v2/...`) with Application Password auth

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — Core library (schema, wordpress, images, markdown, slug, db, ai, prompts, auth)
- `src/components/` — React components (wizard steps, UI elements)
- `src/config/` — Syndication destinations config
- `prompts/` — AI prompt templates (Patty's voice rules, meta, social copy)
- `scripts/` — One-off scripts (voice extractor, etc.)
- `data/` — Local dev only: voice samples cache, internal-links cache (gitignored)

## Key Conventions

- Posts are created via `POST /wp-json/wp/v2/posts` as **drafts by default** — Patty reviews in WP admin before publishing
- Images upload to WP Media Library via `POST /wp-json/wp/v2/media`, attachment IDs used as `featured_media`
- Permalinks: WP returns them; the portal does not construct URLs
- Sitemap / blog index: **WordPress handles both** — the portal does not produce or manage them
- Categories: live-fetched from `/wp/v2/categories`, cached 10 minutes, passed as IDs
- Tags: passed as names; WP auto-creates missing ones
- Author: WP infers from the authenticated user (no author field in the UI)
- SEO fields (meta description, focus keyword): require Yoast or RankMath + a `register_post_meta` shim in her theme's `functions.php` (see SETUP.md). Without it, falls back to native `excerpt`.

### Image variants

Tuned for the Kadence theme on orderandmore.com (hero renders at 1314×446 ≈ 2.95:1; body shown ~600×600).

- **Featured/hero**: 1200×408 WebP q85 (matches her hero aspect — no crop)
- **Body**: 1200×1200 WebP q85 (2× retina headroom over the 600×600 render)
- **Social wide JPG**: 1200×630, q88 — Buffer (Facebook) + GMB
- **Social square JPG**: 1080×1080, q88 — Buffer (Instagram)
- **Pinterest JPG**: 1000×1500 (2:3 portrait), q88 — Buffer (Pinterest)

Featured + body images upload to WP Media Library on publish. Social variants stay in Vercel Blob and are streamed to Buffer / downloaded during syndication.

### Voice

Patty's voice is **first-person, warm, anecdotal** — see `prompts/brand.md`. Extracted from ~15 of her existing posts via `scripts/extract-voice.ts` (run once at setup, output checked in).

Social copy rule: **no hashtags on any platform** (carried over from the parent project — Patty's existing posts don't use them either).

## Commands

- `npm run dev` — Start dev server (Node 22+)
- `npm run build` — Production build
- `npm run extract-voice` — Re-run the voice extractor against orderandmore.com (writes `prompts/brand.md` + `data/voice-samples.json`)

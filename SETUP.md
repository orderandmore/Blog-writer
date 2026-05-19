# Patty Blog Portal — Setup Guide

This portal publishes blog posts to orderandmore.com via the WordPress REST API. It runs on Vercel, stores drafts in Neon (Postgres), keeps in-progress image variants in Vercel Blob, and uses Claude (Anthropic API) to draft posts and SEO copy in Patty's voice.

Setup has three parts: **(1) accounts she'll create**, **(2) WordPress side** (one PHP snippet if her site uses Yoast/RankMath), and **(3) deploy to Vercel.** Plan on 30–60 minutes total.

---

## Part 1 — Accounts

### 1.1 Anthropic API account (~5 min)

The portal uses Claude to draft posts and generate metadata. This needs its own account, separate from claude.ai.

1. Go to <https://console.anthropic.com>
2. Sign up with the email she wants to use for billing
3. Add a payment method
4. Buy starter credits (minimum is $5, which lasts a long time at her cadence — expect $2–8/month for ~5 posts/month)
5. **Settings → API Keys → Create Key.** Name it something obvious (e.g. "Blog Portal"). Copy the `sk-ant-…` key somewhere safe — it's shown only once.

### 1.2 Vercel account (~3 min)

<https://vercel.com/signup> — free tier handles this workload. Sign in with GitHub if convenient.

### 1.3 Neon account (~3 min)

<https://neon.tech> — free tier is plenty. Sign up, create a project (it auto-creates a database named `neondb` and gives you a connection string). Save the connection string somewhere; it looks like:

```
postgres://user:password@ep-foo-bar.us-east-2.aws.neon.tech/neondb?sslmode=require
```

You can skip this step and use Vercel's "Neon" integration instead during Part 3 — it provisions the DB and injects the env var automatically. That's easier.

### 1.4 (Optional) Buffer account

If she wants to push social copy to Facebook, Instagram, X, or Pinterest via the portal: <https://buffer.com>. The free tier supports 3 channels; for FB+IG+X+Pinterest she'd want the Essentials plan (~$6/mo).

Once she's connected her social accounts in Buffer:

1. Go to <https://publish.buffer.com/developers/api/oauth>
2. Generate a personal access token
3. Save it for the env vars below

If Buffer isn't set up, the syndication step still produces social copy — she just copies and pastes manually.

---

## Part 2 — WordPress (her existing orderandmore.com)

### 2.1 Create an application password (~2 min)

In her WP admin:

1. **Users → Profile** (her own user)
2. Scroll to **Application Passwords**
3. Enter a name: "Blog Portal" (or whatever)
4. Click **Add New Application Password**
5. **Copy the 24-character password immediately** — WP won't show it again

Save:
- her username (e.g. `patty`)
- the application password (looks like `xxxx xxxx xxxx xxxx xxxx xxxx` — spaces OK to keep)

> **Hostinger gotcha:** if the "Application Passwords" section is missing from her profile page entirely, the **Hostinger Tools** plugin (pre-installed on Hostinger's managed WP plans) is disabling them by default. Find the plugin in her admin, look for an "Application Passwords" or "REST API" toggle in its security settings, and re-enable. Confirmed cause on orderandmore.com 2026-05.
>
> Quick diagnostic: `curl -s https://orderandmore.com/wp-json/ | grep authentication` — empty `"authentication": []` means they're suppressed; properly enabled it announces the `application-passwords` endpoint.

### 2.2 SEO plugin shim (~5 min)

The portal auto-detects which SEO plugin Patty has installed (Yoast, RankMath, or **The SEO Framework**). All three store their fields in `wp_postmeta` but don't expose them via the REST API by default — WordPress requires a `register_post_meta` shim with `show_in_rest => true` to make them writable.

Quick check:
- Yoast: `https://orderandmore.com/wp-json/yoast/v1/configuration`
- RankMath: `https://orderandmore.com/wp-json/rankmath/v1/setupAccount`
- TSF: `curl -s https://orderandmore.com/ | grep "SEO Framework"` — TSF emits a `<!-- The SEO Framework by Sybre Waaijer -->` comment on every page

If none of those hit, she's using no SEO plugin — skip this section. The portal falls back to the native WordPress `excerpt` field for meta description (fine, just less granular).

**Common pattern:** drop one PHP file at `wp-content/mu-plugins/portal-seo-rest.php` (create the `mu-plugins/` directory if it doesn't exist). mu-plugins load automatically with no activation step. Pick the snippet that matches her plugin.

**The SEO Framework (orderandmore.com — confirmed 2026-05):**

```php
<?php
add_action('init', function () {
    $shared = [
        'show_in_rest' => true,
        'single' => true,
        'type' => 'string',
        'auth_callback' => function () { return current_user_can('edit_posts'); },
    ];
    register_post_meta('post', '_genesis_title', $shared);
    register_post_meta('post', '_genesis_description', $shared);
    // TSF has no focus-keyword field — it's a deliberate anti-keyword-stuffing design.
    // Optional extras if she wants per-network overrides (otherwise _genesis_* is used as fallback):
    // register_post_meta('post', '_open_graph_title', $shared);
    // register_post_meta('post', '_open_graph_description', $shared);
});
```

(Alternative: install the existing [`rest-api-meta-tsf`](https://github.com/massimomarazzi/rest-api-meta-tsf) plugin instead of the shim. It exposes the same fields plus a few more like OG/Twitter overrides. Maintained by a third party — small attack surface but one more dependency.)

**Yoast SEO:**

```php
<?php
add_action('init', function () {
    $shared = [
        'show_in_rest' => true, 'single' => true, 'type' => 'string',
        'auth_callback' => function () { return current_user_can('edit_posts'); },
    ];
    register_post_meta('post', '_yoast_wpseo_metadesc', $shared);
    register_post_meta('post', '_yoast_wpseo_title', $shared);
    register_post_meta('post', '_yoast_wpseo_focuskw', $shared);
});
```

**Rank Math:**

```php
<?php
add_action('init', function () {
    $shared = [
        'show_in_rest' => true, 'single' => true, 'type' => 'string',
        'auth_callback' => fn () => current_user_can('edit_posts'),
    ];
    register_post_meta('post', 'rank_math_description', $shared);
    register_post_meta('post', 'rank_math_title', $shared);
    register_post_meta('post', 'rank_math_focus_keyword', $shared);
});
```

### 2.3 Quick auth test

From any terminal (replace credentials):

```bash
curl -u "patty:xxxx xxxx xxxx xxxx xxxx xxxx" https://orderandmore.com/wp-json/wp/v2/users/me
```

A 200 with her user object means everything is wired up.

---

## Part 3 — Deploy to Vercel

### 3.1 Push the code to GitHub

```bash
cd ~/patty-blog-portal
git add -A && git commit -m "Initial commit"
# Then create a new repo on github.com and push
git remote add origin git@github.com:patty/patty-blog-portal.git
git branch -M main
git push -u origin main
```

### 3.2 Create the Vercel project

1. <https://vercel.com/new> → import the GitHub repo
2. Framework preset auto-detects Next.js — accept defaults
3. **Don't deploy yet** — add env vars first (next step)

### 3.3 Wire up Neon and Blob

In the Vercel project settings:

1. **Storage** tab → **Connect Database** → choose **Neon** → follow the one-click integration. `DATABASE_URL` gets injected automatically. (If she already created a Neon DB in Part 1.3, you can also paste her connection string directly into the env vars instead.)
2. **Storage** tab → **Create Database** → **Blob** → name it "patty-blog-portal-blobs". `BLOB_READ_WRITE_TOKEN` gets injected automatically.

### 3.4 Add the remaining env vars

In **Settings → Environment Variables**, add these to **Production, Preview, and Development** scopes:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` from Part 1.1 |
| `LLM_MODEL` | `claude-sonnet-4-6` |
| `WP_SITE_URL` | `https://orderandmore.com` |
| `WP_USERNAME` | Patty's WP username |
| `WP_APP_PASSWORD` | The 24-char password from Part 2.1 |
| `WP_DEFAULT_STATUS` | `draft` (recommended — she reviews in WP admin) |
| `BUFFER_API_KEY` | From Part 1.4 (or leave blank) |
| `COMPANY_CONTACT_NAME` | `Patty Powers` |
| `COMPANY_CONTACT_EMAIL` | `patty@orderandmore.com` |
| `PORTAL_PASSWORD` | A strong password she'll type to access the portal |
| `PORTAL_USERNAME` | `patty` (or whatever she wants) |
| `SESSION_SECRET` | Generate: `openssl rand -base64 48` |

Already injected by the integrations:
- `DATABASE_URL` (Neon)
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob)

### 3.5 Deploy

Click **Deploy**. On first request the schema migrations run automatically (idempotent `CREATE TABLE IF NOT EXISTS`). Visit the deployed URL, authenticate with `PORTAL_USERNAME` / `PORTAL_PASSWORD`, and try creating a topic.

### 3.6 Refresh voice samples (optional but recommended)

The repo ships with a hand-written `prompts/brand.md` based on observation of her existing posts. The included `scripts/extract-voice.mjs` can re-derive it from her latest 15 posts via Claude Opus (~$0.10).

```bash
cd ~/patty-blog-portal
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local
node scripts/extract-voice.mjs --dry-run   # preview the proposed brand.md
node scripts/extract-voice.mjs              # writes prompts/brand.md + data/voice-samples.json
git add prompts/brand.md data/voice-samples.json && git commit -m "Refresh voice samples"
git push                                    # Vercel auto-deploys
```

She can also edit any individual prompt via the portal's **Settings** page (writes overrides to the DB — survives deploys).

---

## Local development

```bash
cd ~/patty-blog-portal
npm install
cp .env.example .env.local
# fill in DATABASE_URL (Neon dev branch is fine), BLOB_READ_WRITE_TOKEN, ANTHROPIC_API_KEY, WP_*
npm run dev
```

Local dev hits the same Neon DB + Vercel Blob as production unless you provision a separate Neon branch (recommended) and a separate Blob store. Vercel CLI's `vercel env pull` is the easiest way to grab a complete `.env.local` from the deployed project.

---

## Things you should know / known gaps

These are deliberate scope cuts or things that need a focused pass after first deploy:

1. **UI step components were ported mechanically; expect rough edges.** `src/components/steps/StepMetadata.tsx`, `StepReview.tsx`, and `StepSyndication.tsx` all had their state shape and API targets swapped, but the visual layouts may have minor leftover assumptions from the parent project. Run `npm run build` once after first deploy to catch any remaining type errors; they'll be obvious and small.

2. **Featured-image dimensions.** Currently 1200×408 (≈2.95:1, matched to her Kadence theme's hero render at 1314×446). If the theme changes or you want sharper retina, bump to 1800×612 in `processFeaturedImage()` in `src/lib/images.ts` — it's a one-line change.

3. **Gutenberg block compatibility.** Posts created via the portal arrive in WP as one "Classic" block (raw HTML wrapped). They render correctly but look different in the WP editor than her existing block-built posts. If she wants to edit posts in WP admin after the portal creates them, this is a minor UX wart. Could be solved later by emitting `<!-- wp:paragraph -->` block comments in `src/lib/markdown.ts:renderMarkdown`.

4. **Buffer free tier covers her use case.** Free Buffer supports 3 channels, and Patty uses exactly three: Facebook, Instagram, Pinterest. No paid plan needed unless she later adds a fourth.

5. **No automatic post-update flow.** Once a post is published from the portal, edits made in WP admin don't sync back. The portal also doesn't re-publish a draft (clicking "Publish" twice would create a duplicate). That's a future enhancement if it matters.

6. **Brand voice will drift on real use.** The `prompts/brand.md` is a starting point. After publishing 3–5 posts she'll likely want to tune banned phrases, opening style, and CTA wording. The Settings page in the portal lets her edit every prompt without code changes.

7. **No image-search/library yet.** Each post requires fresh images. Future: pull from her existing WP media library for reuse.

8. **Mobile UX is untested.** The portal was built for desktop. It probably works on tablet, may be cramped on phone.

---

## Costs

| Service | Monthly cost at her cadence |
|---|---|
| Vercel | Free (Hobby) |
| Neon Postgres | Free (3 GB storage, plenty) |
| Vercel Blob | Free (1 GB storage, 10 GB transfer) |
| Anthropic API | $2–8 (varies with how much she revises) |
| Hostinger (her existing WP) | Already paying |
| Buffer (optional, only if she wants Pinterest) | $6 |
| **Total** | **~$2–14/month** |

---

## Support

This is a fork of `~/blog-portal` (the virtuesolar.com version). The two projects are independent — fixes here don't propagate back, and vice versa.

For changes to her voice or syndication targets: edit `prompts/brand.md` and `src/config/destinations.ts`. Everything else should be small, surgical changes.

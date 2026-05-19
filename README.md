# Patty Blog Portal

Blog publishing portal for **orderandmore.com**. Composes posts in a 5-step wizard (content → images → metadata → syndication → review) and publishes drafts directly to WordPress via the REST API.

See [`CLAUDE.md`](./CLAUDE.md) for architecture notes and [`SETUP.md`](./SETUP.md) for first-time setup (WordPress application password, Anthropic key, Vercel/Neon/Blob configuration).

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in WP_*, ANTHROPIC_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN
npm run dev
```

Open http://localhost:3000.

## Deployment

Vercel + Neon Postgres + Vercel Blob. See `SETUP.md` for the click-through deployment flow.

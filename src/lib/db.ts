/**
 * Postgres data layer (Neon in production, any local Postgres for dev).
 *
 * Migrated from better-sqlite3 — the schema is small and JSON-blob-heavy, so
 * we keep TEXT for JSON columns rather than switching to jsonb (the app
 * already parses strings server-side).
 *
 * All functions are async. Callers must await.
 */

import { Pool, type PoolClient } from "pg";

let pool: Pool | null = null;
let schemaInitialized = false;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  pool = new Pool({
    connectionString,
    // Neon's pooler closes idle connections aggressively; tighten our side.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ensureSchema(): Promise<void> {
  if (schemaInitialized) return;
  await withClient(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        title TEXT,
        slug TEXT,
        markdown TEXT,
        frontmatter TEXT,
        images TEXT,
        social_copy TEXT,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        current_step INTEGER DEFAULT 1,
        posted_destinations TEXT,
        parsed_body TEXT,
        parsed_title TEXT,
        topic_id TEXT,
        topic_notes TEXT,
        buffer_submissions TEXT,
        social_review TEXT,
        wp_post_id INTEGER,
        wp_link TEXT,
        wp_status TEXT,
        wp_scheduled_gmt TEXT,
        last_synced_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS generations (
        id BIGSERIAL PRIMARY KEY,
        draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
        prompt_file TEXT,
        prompt_hash TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        output TEXT,
        accepted BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prompt_overrides (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'open',
        draft_id TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Idempotent column adds — useful when an older schema exists from a
    // prior deploy. Each runs once; failures (column-exists) are swallowed
    // individually so one duplicate doesn't abort the others.
    const migrations = [
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS wp_post_id INTEGER",
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS wp_link TEXT",
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS wp_status TEXT",
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ",
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS social_review TEXT",
      "ALTER TABLE drafts ADD COLUMN IF NOT EXISTS wp_scheduled_gmt TEXT",
    ];
    for (const sql of migrations) {
      try {
        await c.query(sql);
      } catch {
        // ignore — already migrated
      }
    }
  });
  schemaInitialized = true;
}

function newId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(8)))
    .toString("hex")
    .toLowerCase();
}

// ---------- Drafts ----------

export async function createDraft(): Promise<string> {
  await ensureSchema();
  const id = newId();
  await withClient((c) =>
    c.query("INSERT INTO drafts (id, status) VALUES ($1, 'draft')", [id]),
  );
  return id;
}

export async function getDraft(
  id: string,
): Promise<Record<string, unknown> | undefined> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT * FROM drafts WHERE id = $1", [id]),
  );
  return rows[0];
}

const DRAFT_COLUMNS = new Set([
  "title",
  "slug",
  "markdown",
  "frontmatter",
  "images",
  "social_copy",
  "status",
  "current_step",
  "posted_destinations",
  "parsed_body",
  "parsed_title",
  "topic_id",
  "topic_notes",
  "buffer_submissions",
  "social_review",
  "wp_post_id",
  "wp_link",
  "wp_status",
  "wp_scheduled_gmt",
]);

export async function updateDraft(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (!DRAFT_COLUMNS.has(key)) continue;
    sets.push(`${key} = $${i++}`);
    values.push(
      value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : value,
    );
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  values.push(id);
  await withClient((c) =>
    c.query(
      `UPDATE drafts SET ${sets.join(", ")} WHERE id = $${i}`,
      values,
    ),
  );
}

export async function deleteDraft(id: string): Promise<void> {
  await ensureSchema();
  await withClient((c) =>
    c.query("DELETE FROM drafts WHERE id = $1", [id]),
  );
}

export async function listDrafts(): Promise<Record<string, unknown>[]> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query(
      "SELECT id, title, slug, status, created_at, updated_at FROM drafts ORDER BY updated_at DESC",
    ),
  );
  return rows;
}

export interface BufferSubmission {
  bufferPostId: string;
  submittedAt: string;
}
export type BufferSubmissions = Record<string, BufferSubmission>;

export async function getBufferSubmissions(
  draftId: string,
): Promise<BufferSubmissions> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT buffer_submissions FROM drafts WHERE id = $1", [draftId]),
  );
  const raw = rows[0]?.buffer_submissions;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as BufferSubmissions;
  } catch {
    return {};
  }
}

export async function recordBufferSubmission(
  draftId: string,
  destinationId: string,
  bufferPostId: string,
): Promise<void> {
  const current = await getBufferSubmissions(draftId);
  current[destinationId] = {
    bufferPostId,
    submittedAt: new Date().toISOString(),
  };
  await updateDraft(draftId, { buffer_submissions: current });
}

export interface DraftSummary {
  id: string;
  title: string | null;
  slug: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  progress: {
    content: boolean;
    images: boolean;
    metadata: boolean;
    social: boolean;
    published: boolean;
  };
  imageCount: number;
  syndicated: { posted: number; total: number };
  currentStep: number;
  wpPostId: number | null;
  wpLink: string | null;
}

export async function listDraftsSummary(
  totalDestinations: number,
): Promise<DraftSummary[]> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query(
      `SELECT id, title, slug, status, created_at, updated_at,
              markdown, parsed_body, parsed_title, frontmatter,
              images, social_copy, posted_destinations, buffer_submissions,
              current_step, wp_post_id, wp_link
       FROM drafts ORDER BY updated_at DESC`,
    ),
  );
  return rows.map((row) => {
    const frontmatter = safeParse<Record<string, unknown>>(row.frontmatter);
    const images = safeParse<unknown[]>(row.images) ?? [];
    const socialCopy = safeParse<Record<string, unknown>>(row.social_copy);
    // A destination counts as syndicated if it was sent to Buffer
    // (buffer_submissions, set automatically on publish/re-send) or marked
    // posted manually (posted_destinations, used for GMB). Dedupe the two.
    const posted = safeParse<string[]>(row.posted_destinations) ?? [];
    const bufferSubs =
      safeParse<Record<string, unknown>>(row.buffer_submissions) ?? {};
    const syndicatedCount = new Set<string>([
      ...posted,
      ...Object.keys(bufferSubs),
    ]).size;
    const body =
      (row.parsed_body as string) || (row.markdown as string) || "";
    const title =
      (row.title as string) ||
      (frontmatter?.title as string) ||
      (row.parsed_title as string) ||
      null;
    const processedCount = images.filter(
      (i) =>
        typeof i === "object" &&
        i !== null &&
        (i as Record<string, unknown>).processed === true,
    ).length;
    return {
      id: row.id as string,
      title,
      slug: (row.slug as string) || (frontmatter?.slug as string) || null,
      status: (row.status as string) || "draft",
      createdAt: (row.created_at as Date | string).toString(),
      updatedAt: (row.updated_at as Date | string).toString(),
      currentStep: (row.current_step as number) || 1,
      imageCount: processedCount,
      progress: {
        content:
          body.length > 0 || ((row.markdown as string) || "").length > 0,
        images: processedCount > 0,
        metadata: Boolean(
          frontmatter?.title && frontmatter?.description,
        ),
        social: Boolean(socialCopy?.facebook || socialCopy?.linkedin),
        published: row.status === "published",
      },
      syndicated: { posted: syndicatedCount, total: totalDestinations },
      wpPostId: (row.wp_post_id as number) ?? null,
      wpLink: (row.wp_link as string) ?? null,
    };
  });
}

function safeParse<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------- Topics ----------

export interface TopicRow {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  draft_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createTopic(
  title: string,
  notes: string | null,
): Promise<TopicRow> {
  await ensureSchema();
  const id = newId();
  await withClient((c) =>
    c.query(
      "INSERT INTO topics (id, title, notes) VALUES ($1, $2, $3)",
      [id, title, notes],
    ),
  );
  return (await getTopic(id)) as TopicRow;
}

export async function getTopic(id: string): Promise<TopicRow | null> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT * FROM topics WHERE id = $1", [id]),
  );
  return (rows[0] as TopicRow) ?? null;
}

export async function listTopics(): Promise<TopicRow[]> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT * FROM topics ORDER BY updated_at DESC"),
  );
  return rows as TopicRow[];
}

const TOPIC_COLUMNS = new Set(["title", "notes", "status", "draft_id"]);

export async function updateTopic(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await ensureSchema();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(fields)) {
    if (!TOPIC_COLUMNS.has(key)) continue;
    sets.push(`${key} = $${i++}`);
    values.push(value);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  values.push(id);
  await withClient((c) =>
    c.query(
      `UPDATE topics SET ${sets.join(", ")} WHERE id = $${i}`,
      values,
    ),
  );
}

export async function deleteTopic(id: string): Promise<void> {
  await ensureSchema();
  await withClient((c) => c.query("DELETE FROM topics WHERE id = $1", [id]));
}

export async function createDraftFromTopic(
  topicId: string,
): Promise<string | null> {
  await ensureSchema();
  const topic = await getTopic(topicId);
  if (!topic) return null;
  const id = newId();
  await withClient((c) =>
    c.query(
      `INSERT INTO drafts (id, status, topic_id, topic_notes, parsed_title, title)
       VALUES ($1, 'draft', $2, $3, $4, $5)`,
      [id, topic.id, topic.notes ?? null, topic.title, topic.title],
    ),
  );
  await updateTopic(topic.id, { status: "in_progress", draft_id: id });
  return id;
}

// ---------- Prompt overrides ----------

export async function getPromptOverride(key: string): Promise<string | null> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT content FROM prompt_overrides WHERE key = $1", [key]),
  );
  return (rows[0]?.content as string) ?? null;
}

export async function setPromptOverride(
  key: string,
  content: string,
): Promise<void> {
  await ensureSchema();
  await withClient((c) =>
    c.query(
      `INSERT INTO prompt_overrides (key, content, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT(key) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [key, content],
    ),
  );
}

export async function clearPromptOverride(key: string): Promise<void> {
  await ensureSchema();
  await withClient((c) =>
    c.query("DELETE FROM prompt_overrides WHERE key = $1", [key]),
  );
}

export async function listPromptOverrides(): Promise<
  Array<{ key: string; content: string; updated_at: string }>
> {
  await ensureSchema();
  const { rows } = await withClient((c) =>
    c.query("SELECT key, content, updated_at FROM prompt_overrides"),
  );
  return rows.map((r) => ({
    key: r.key as string,
    content: r.content as string,
    updated_at: (r.updated_at as Date | string).toString(),
  }));
}

// ---------- Generations log ----------

export async function logGeneration(params: {
  draftId: string;
  promptFile: string;
  promptHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  output: string;
  accepted: boolean;
}): Promise<void> {
  await ensureSchema();
  await withClient((c) =>
    c.query(
      `INSERT INTO generations (draft_id, prompt_file, prompt_hash, model, input_tokens, output_tokens, output, accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.draftId,
        params.promptFile,
        params.promptHash,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.output,
        params.accepted,
      ],
    ),
  );
}

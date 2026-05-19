/**
 * WordPress REST API client. Talks to orderandmore.com's /wp-json/wp/v2/*
 * endpoints over HTTPS Basic Auth (application password). Replaces what
 * src/lib/github.ts used to do for the Astro+GitHub setup.
 *
 * Env vars (all required for write operations):
 *   WP_SITE_URL       — e.g. https://orderandmore.com
 *   WP_USERNAME       — WP user account name (typically Patty's)
 *   WP_APP_PASSWORD   — 24-char application password from WP admin
 */

export interface WPCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WPTag {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WPPostSummary {
  id: number;
  title: string;
  slug: string;
  link: string;
  status?: string;
  date?: string;
}

export interface WPUser {
  id: number;
  name: string;
  slug: string;
}

export interface WPMediaSize {
  file: string;
  width: number;
  height: number;
  source_url: string;
}

export interface WPMedia {
  id: number;
  source_url: string;
  alt_text: string;
  media_details: {
    width: number;
    height: number;
    sizes: Record<string, WPMediaSize>;
  };
}

export interface CreatePostInput {
  title: string;
  content: string; // HTML — not markdown
  excerpt?: string;
  slug?: string;
  status: "draft" | "publish" | "future" | "pending" | "private";
  date?: string; // ISO 8601 — for "future" scheduled posts
  categories?: number[];
  tags?: number[]; // integer IDs — use resolveTagIds() to convert names first
  featured_media?: number;
  meta?: Record<string, string | number | boolean>;
}

export interface CreatedPost {
  id: number;
  link: string;
  status: string;
  slug: string;
}

function siteUrl(): string {
  const url = process.env.WP_SITE_URL;
  if (!url) throw new Error("WP_SITE_URL is not set");
  return url.replace(/\/+$/, "");
}

function authHeader(): string {
  const u = process.env.WP_USERNAME;
  const p = process.env.WP_APP_PASSWORD;
  if (!u || !p) throw new Error("WP_USERNAME / WP_APP_PASSWORD not set");
  // App passwords may include spaces — WP accepts them either way, but Basic
  // Auth needs the raw bytes.
  const token = Buffer.from(`${u}:${p}`).toString("base64");
  return `Basic ${token}`;
}

async function wpFetch<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) headers.set("Authorization", authHeader());
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const res = await fetch(`${siteUrl()}/wp-json${path}`, {
    ...rest,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `WordPress API ${res.status} ${res.statusText}: ${body.slice(0, 400)}`,
    );
  }
  return (await res.json()) as T;
}

// ---------- Reads ----------

export async function listCategories(): Promise<WPCategory[]> {
  return wpFetch<WPCategory[]>(
    "/wp/v2/categories?per_page=100&_fields=id,name,slug,count",
    { auth: false },
  );
}

export async function listTags(): Promise<WPTag[]> {
  return wpFetch<WPTag[]>(
    "/wp/v2/tags?per_page=100&_fields=id,name,slug,count",
    { auth: false },
  );
}

export async function listRecentPosts(
  limit = 100,
): Promise<WPPostSummary[]> {
  return wpFetch<WPPostSummary[]>(
    `/wp/v2/posts?per_page=${limit}&status=publish&_fields=id,title,slug,link,date`,
    { auth: false },
  ).then((rows) =>
    rows.map((r) => ({
      ...r,
      // WP returns title as {rendered:string} — flatten for simplicity
      title:
        typeof r.title === "string"
          ? r.title
          : (r.title as unknown as { rendered: string }).rendered,
    })),
  );
}

export async function listRecentPages(limit = 50): Promise<WPPostSummary[]> {
  return wpFetch<WPPostSummary[]>(
    `/wp/v2/pages?per_page=${limit}&status=publish&_fields=id,title,slug,link`,
    { auth: false },
  ).then((rows) =>
    rows.map((r) => ({
      ...r,
      title:
        typeof r.title === "string"
          ? r.title
          : (r.title as unknown as { rendered: string }).rendered,
    })),
  );
}

export async function listExistingSlugs(): Promise<string[]> {
  // Fetch up to 100 most-recent post slugs for duplicate-detection. Older
  // duplicates are vanishingly rare and not worth a full crawl.
  const rows = await wpFetch<{ slug: string }[]>(
    "/wp/v2/posts?per_page=100&status=publish,draft,pending,future&_fields=slug",
  );
  return rows.map((r) => r.slug);
}

export async function getCurrentUser(): Promise<WPUser> {
  return wpFetch<WPUser>("/wp/v2/users/me?_fields=id,name,slug");
}

export async function getMedia(id: number): Promise<WPMedia> {
  return wpFetch<WPMedia>(`/wp/v2/media/${id}`, { auth: false });
}

// ---------- Writes ----------

export async function uploadMedia(
  buffer: Buffer,
  opts: {
    filename: string;
    mime: string;
    alt?: string;
    caption?: string;
    title?: string;
  },
): Promise<{ id: number; sourceUrl: string }> {
  const form = new FormData();
  // Convert Node Buffer → Blob for FormData. The Content-Disposition the
  // browser-y FormData impl sends is what WP needs.
  // Node's Buffer extends Uint8Array; wrapping in another view satisfies
  // Blob's BlobPart constraint while keeping a zero-copy reference.
  const blob = new Blob([new Uint8Array(buffer)], { type: opts.mime });
  form.append("file", blob, opts.filename);
  if (opts.alt) form.append("alt_text", opts.alt);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.title) form.append("title", opts.title);

  const result = await wpFetch<{ id: number; source_url: string }>(
    "/wp/v2/media",
    { method: "POST", body: form },
  );
  return { id: result.id, sourceUrl: result.source_url };
}

export async function createPost(
  input: CreatePostInput,
): Promise<CreatedPost> {
  const result = await wpFetch<CreatedPost>("/wp/v2/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result;
}

export async function updatePost(
  id: number,
  patch: Partial<CreatePostInput>,
): Promise<CreatedPost> {
  return wpFetch<CreatedPost>(`/wp/v2/posts/${id}`, {
    method: "POST", // WP REST uses POST for both create and update
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function createCategory(
  name: string,
  slug?: string,
): Promise<WPCategory> {
  return wpFetch<WPCategory>("/wp/v2/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug }),
  });
}

export async function createTag(name: string, slug?: string): Promise<WPTag> {
  return wpFetch<WPTag>("/wp/v2/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug }),
  });
}

/**
 * Look up or create each tag by name, returning integer IDs suitable for
 * /wp/v2/posts.tags. WP REST rejects string tag values with a 400 — it
 * only accepts integers. The cached tag list is refreshed when a lookup
 * miss happens so freshly-created-elsewhere tags are picked up.
 */
export async function resolveTagIds(names: string[]): Promise<number[]> {
  if (names.length === 0) return [];
  let tags = await getCachedTags();
  const ids: number[] = [];
  let refreshed = false;

  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const lc = trimmed.toLowerCase();
    let match = tags.find(
      (t) => t.name.toLowerCase() === lc || t.slug.toLowerCase() === lc,
    );
    if (!match && !refreshed) {
      tags = await getCachedTags(true);
      refreshed = true;
      match = tags.find(
        (t) => t.name.toLowerCase() === lc || t.slug.toLowerCase() === lc,
      );
    }
    if (match) {
      ids.push(match.id);
      continue;
    }
    const created = await createTag(trimmed);
    ids.push(created.id);
    tags = [...tags, created];
  }
  return ids;
}

// ---------- Caching helpers (used by API routes) ----------

let categoriesCache: { value: WPCategory[]; at: number } | null = null;
let tagsCache: { value: WPTag[]; at: number } | null = null;
let pagesCache: { value: WPPostSummary[]; at: number } | null = null;
const TEN_MIN = 10 * 60 * 1000;

export async function getCachedCategories(force = false): Promise<WPCategory[]> {
  if (!force && categoriesCache && Date.now() - categoriesCache.at < TEN_MIN) {
    return categoriesCache.value;
  }
  const value = await listCategories();
  categoriesCache = { value, at: Date.now() };
  return value;
}

export async function getCachedTags(force = false): Promise<WPTag[]> {
  if (!force && tagsCache && Date.now() - tagsCache.at < TEN_MIN) {
    return tagsCache.value;
  }
  const value = await listTags();
  tagsCache = { value, at: Date.now() };
  return value;
}

export async function getCachedPages(force = false): Promise<WPPostSummary[]> {
  if (!force && pagesCache && Date.now() - pagesCache.at < TEN_MIN) {
    return pagesCache.value;
  }
  const value = await listRecentPages();
  pagesCache = { value, at: Date.now() };
  return value;
}

export function clearWpCaches(): void {
  categoriesCache = null;
  tagsCache = null;
  pagesCache = null;
}

/** Build the WP admin edit URL for a post — used to deep-link from the wizard. */
export function adminEditUrl(postId: number): string {
  return `${siteUrl()}/wp-admin/post.php?post=${postId}&action=edit`;
}

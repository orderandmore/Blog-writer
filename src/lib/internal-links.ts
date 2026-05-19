/**
 * Internal links discovery. Talks to her WordPress REST API to enumerate
 * published posts + pages, and caches the result in process memory.
 *
 * (Disk persistence was removed: Vercel's serverless filesystem is read-only
 * outside /tmp. The cache lives in memory; cold-start lambdas will re-fetch
 * lazily, which is cheap.)
 */

import { listRecentPosts, listRecentPages } from "./wordpress";

export type InternalLink = {
  url: string;
  title: string;
  kind: "blog" | "page" | "nav";
};

export type InternalLinksFile = {
  links: InternalLink[];
  updatedAt: string;
  source: string;
};

// Curated pages worth promoting in articles. WP returns ALL pages; some are
// navigation chaff. Match by slug so we control what surfaces to the AI.
const PROMOTED_PAGE_SLUGS = new Set([
  "home",
  "about",
  "services",
  "contact",
  "professional-organizing",
  "decluttering-services",
  "downsizing",
  "moving-services",
  "virtual-organizing",
  "educational-talks",
]);

let memoryCache: InternalLinksFile | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchInternalLinks(): Promise<InternalLink[]> {
  const links: InternalLink[] = [];

  const [posts, pages] = await Promise.all([
    listRecentPosts(100).catch(() => []),
    listRecentPages(50).catch(() => []),
  ]);

  // Homepage as a "nav" link so the AI prioritizes it when relevant.
  const siteUrl = (process.env.WP_SITE_URL || "").replace(/\/+$/, "");
  if (siteUrl) {
    links.push({
      url: `${siteUrl}/`,
      title: "Order and More — Home",
      kind: "nav",
    });
  }

  for (const page of pages) {
    if (!PROMOTED_PAGE_SLUGS.has(page.slug)) continue;
    links.push({ url: page.link, title: page.title, kind: "page" });
  }
  for (const post of posts) {
    links.push({ url: post.link, title: post.title, kind: "blog" });
  }
  return links;
}

export async function loadInternalLinks(): Promise<InternalLinksFile | null> {
  if (memoryCache && Date.now() - new Date(memoryCache.updatedAt).getTime() < CACHE_TTL_MS) {
    return memoryCache;
  }
  return memoryCache;
}

export async function refreshInternalLinks(): Promise<InternalLinksFile> {
  const links = await fetchInternalLinks();
  const file: InternalLinksFile = {
    links,
    updatedAt: new Date().toISOString(),
    source: `${process.env.WP_SITE_URL || ""}/wp-json/wp/v2/{posts,pages}`,
  };
  memoryCache = file;
  return file;
}

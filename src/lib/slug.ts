/**
 * Slug + filename utilities. URL construction is gone — WordPress assigns
 * the final permalink and returns it via the create-post response.
 */

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Sanitize an image filename. Used as a fallback when no SEO name was supplied. */
export function sanitizeImageName(name: string, slug: string): string {
  const baseName = name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (/^img[-_]?\d+$/i.test(baseName) || baseName.length < 3) {
    return `${slug}.webp`;
  }
  return `${baseName}.webp`;
}

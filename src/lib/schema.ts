import { z } from "zod";

// PostMeta is the WP-shaped metadata the wizard collects in Step 3 and ships
// to /wp/v2/posts on publish. Replaces the Astro YAML frontmatter shape from
// the parent project. Authors and categories are dynamic in WP, so they're
// not enums here — categories are looked up by name → ID at publish time.

export const postMetaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1), // used as excerpt + (if plugin present) SEO meta description
  pubDate: z.string().datetime(),
  // categoryIds: WP category IDs, looked up by name on the client and stored as numbers
  categoryIds: z.array(z.number().int()).default([]),
  tags: z.array(z.string()).default([]),
  featuredImage: z.string().optional(), // local scratch reference, replaced with WP attachment URL on publish
  featuredImageAlt: z.string().optional(),
  status: z.enum(["draft", "publish", "future"]).default("draft"),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  focusKeyword: z.string().optional(),
});

export type PostMeta = z.infer<typeof postMetaSchema>;

// Draft shape stored in the DB
export const draftSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  slug: z.string().nullable(),
  markdown: z.string().nullable(),
  frontmatter: z.string().nullable(), // JSON blob of PostMeta (column name kept for migration compat)
  images: z.string().nullable(), // JSON array
  social_copy: z.string().nullable(), // JSON blob
  status: z.enum(["draft", "published"]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Draft = z.infer<typeof draftSchema>;

export const CROP_POSITIONS = [
  "centre",
  "top",
  "bottom",
  "left",
  "right",
  "attention",
  "entropy",
] as const;
export type CropPosition = (typeof CROP_POSITIONS)[number];

// Image metadata tracked per upload. `repoPath` is kept as a name for
// historical reasons but is now just a deterministic key used for the scratch
// store; the published URL comes from WP's media library response.
export interface ImageMeta {
  id: string;
  originalName: string;
  type: "featured" | "body";
  originalWidth: number;
  originalHeight: number;
  originalSize: number;
  processedName: string;
  processedWidth: number;
  processedHeight: number;
  processedSize: number;
  repoPath: string;
  processed: boolean;
  cropPosition: CropPosition;
  /** WP attachment ID assigned at publish time. */
  wpMediaId?: number;
  /** WP media source URL (the live, public URL). */
  wpMediaUrl?: string;
}

// Social copy bundle shape. Patty publishes to Facebook, Instagram,
// LinkedIn, plus GMB (copy-to-clipboard). No press releases, no X/Twitter,
// no Pinterest.
export interface SocialCopyBundle {
  gmb: string;
  facebook: string;
  instagram: string;
  linkedin: string;
}

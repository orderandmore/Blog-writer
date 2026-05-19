/**
 * Detect which SEO plugin her WordPress install uses (Yoast, RankMath,
 * The SEO Framework, or none) and which REST meta keys to use for setting
 * meta description / focus keyword / SEO title. Detection runs once on
 * first call and is cached in-process.
 *
 * Critical limitation: even when the plugin is installed, those meta keys
 * are NOT exposed via REST by default. WordPress requires the plugin (or a
 * theme/MU plugin) to call `register_post_meta` with `show_in_rest => true`.
 *
 * If detection succeeds but writes silently no-op, the cause is almost always
 * the missing `register_post_meta` shim. See SETUP.md for the PHP snippet
 * Patty can paste into a wp-content/mu-plugins/ file.
 */

export type SeoPlugin = "yoast" | "rankmath" | "tsf" | "none";

export interface SeoPluginConfig {
  plugin: SeoPlugin;
  metaKeyMap: {
    description: string | null;
    title: string | null;
    focusKeyword: string | null;
  };
}

const CONFIGS: Record<SeoPlugin, SeoPluginConfig> = {
  yoast: {
    plugin: "yoast",
    metaKeyMap: {
      description: "_yoast_wpseo_metadesc",
      title: "_yoast_wpseo_title",
      focusKeyword: "_yoast_wpseo_focuskw",
    },
  },
  rankmath: {
    plugin: "rankmath",
    metaKeyMap: {
      description: "rank_math_description",
      title: "rank_math_title",
      focusKeyword: "rank_math_focus_keyword",
    },
  },
  tsf: {
    plugin: "tsf",
    metaKeyMap: {
      // The SEO Framework uses _genesis_* keys (historical naming from
      // the author's Genesis-theme days; nothing to do with Genesis today).
      description: "_genesis_description",
      title: "_genesis_title",
      // TSF deliberately has no focus-keyword field — it's anti-stuffing.
      focusKeyword: null,
    },
  },
  none: {
    plugin: "none",
    metaKeyMap: { description: null, title: null, focusKeyword: null },
  },
};

let cached: SeoPluginConfig | null = null;

/**
 * Probe to identify the active plugin. We try in this order:
 *   1. Yoast's REST namespace (responds even when unauthenticated, with 401)
 *   2. RankMath's REST namespace (same trick)
 *   3. The SEO Framework — no REST namespace of its own; we sniff the
 *      homepage HTML for its signature comment instead
 *
 * Falls back to "none" if WP_SITE_URL isn't set yet or all probes fail.
 */
export async function detectSeoPlugin(force = false): Promise<SeoPluginConfig> {
  if (cached && !force) return cached;
  if (!process.env.WP_SITE_URL) {
    cached = CONFIGS.none;
    return cached;
  }

  const base = process.env.WP_SITE_URL.replace(/\/+$/, "");

  try {
    const [yoastRes, rankRes] = await Promise.all([
      fetch(`${base}/wp-json/yoast/v1/configuration`).catch(() => null),
      fetch(`${base}/wp-json/rankmath/v1/setupAccount`).catch(() => null),
    ]);

    // 401 means endpoint exists but needs auth — still a positive signal.
    if (yoastRes?.ok || yoastRes?.status === 401) {
      cached = CONFIGS.yoast;
      return cached;
    }
    if (rankRes?.ok || rankRes?.status === 401) {
      cached = CONFIGS.rankmath;
      return cached;
    }

    // TSF doesn't expose a REST namespace; sniff its HTML signature instead.
    // The comment "<!-- The SEO Framework by Sybre Waaijer -->" is injected
    // into every rendered page's <head>.
    try {
      const homepageRes = await fetch(`${base}/`, {
        headers: { Accept: "text/html" },
      });
      if (homepageRes.ok) {
        const html = await homepageRes.text();
        if (html.includes("The SEO Framework by Sybre Waaijer")) {
          cached = CONFIGS.tsf;
          return cached;
        }
      }
    } catch {
      // ignored — fall through to "none"
    }

    cached = CONFIGS.none;
    return cached;
  } catch {
    cached = CONFIGS.none;
    return cached;
  }
}

/**
 * Translate the portal's normalized SEO fields to the WP `meta` payload
 * shape. Returns an empty object when no plugin is detected (caller should
 * use the native `excerpt` for meta description instead) or when a field
 * has no mapping (e.g. TSF has no focus-keyword equivalent).
 */
export function buildSeoMeta(
  config: SeoPluginConfig,
  fields: {
    description?: string;
    title?: string;
    focusKeyword?: string;
  },
): Record<string, string> {
  const meta: Record<string, string> = {};
  if (config.metaKeyMap.description && fields.description) {
    meta[config.metaKeyMap.description] = fields.description;
  }
  if (config.metaKeyMap.title && fields.title) {
    meta[config.metaKeyMap.title] = fields.title;
  }
  if (config.metaKeyMap.focusKeyword && fields.focusKeyword) {
    meta[config.metaKeyMap.focusKeyword] = fields.focusKeyword;
  }
  return meta;
}

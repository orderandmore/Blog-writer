export interface Destination {
  id: string;
  name: string;
  format: "social" | "gmb";
  copyField: string; // Key in the SocialCopyBundle
  /** Show the 16:9 / square / portrait social image download depending on variant. */
  hasSocialImage: boolean;
  urlEnvVar: string;
  defaultUrl?: string;
  copyMode: "plain" | "rich";
  maxChars?: number;
  description: string;
  /** Buffer service slug — set on destinations submittable via Buffer API. */
  bufferService?: "facebook" | "instagram" | "pinterest";
  /** Which scratch JPG variant Buffer should fetch as the post image. */
  socialImageVariant?: "wide" | "square" | "portrait";
}

export const destinations: Destination[] = [
  {
    id: "facebook",
    name: "Facebook",
    format: "social",
    copyField: "facebook",
    hasSocialImage: true,
    urlEnvVar: "FACEBOOK_PAGE_URL",
    copyMode: "plain",
    maxChars: 500,
    description: "Conversational caption with article URL. 1200×630 JPG.",
    bufferService: "facebook",
    socialImageVariant: "wide",
  },
  {
    id: "instagram",
    name: "Instagram",
    format: "social",
    copyField: "instagram",
    hasSocialImage: true,
    urlEnvVar: "INSTAGRAM_URL",
    copyMode: "plain",
    description: "Conversational caption. No hashtags, no clickable links. 1080×1080 JPG.",
    bufferService: "instagram",
    socialImageVariant: "square",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    format: "social",
    copyField: "pinterest",
    hasSocialImage: true,
    urlEnvVar: "PINTEREST_URL",
    copyMode: "plain",
    maxChars: 500,
    description: "Pin description, keyword-rich. 1000×1500 portrait JPG.",
    bufferService: "pinterest",
    socialImageVariant: "portrait",
  },
  {
    id: "gmb",
    name: "Google Business Profile",
    format: "gmb",
    copyField: "gmb",
    hasSocialImage: true,
    urlEnvVar: "GMB_POST_URL",
    copyMode: "plain",
    maxChars: 1500,
    description: "No links, no hashtags. Post text only. 1200×630 JPG upload.",
  },
];

/** Get the URL for a destination — env var wins, hardcoded default is fallback. */
export function getDestinationUrl(dest: Destination): string {
  return process.env[dest.urlEnvVar] || dest.defaultUrl || "";
}

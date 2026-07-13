/**
 * Buffer GraphQL client.
 *
 * Buffer's modern API is a single GraphQL endpoint at https://api.buffer.com.
 * Auth is a Bearer token (Personal Access Token from buffer.com/developers).
 * Posts reference images by **public URL** — there is no media upload step.
 */

const BUFFER_ENDPOINT = "https://api.buffer.com";

export type BufferService = "facebook" | "instagram" | "linkedin";

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
}

interface GraphQLError {
  message: string;
  path?: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

function getApiKey(): string {
  const key = process.env.BUFFER_API_KEY;
  if (!key) throw new Error("BUFFER_API_KEY is not set");
  return key;
}

async function bufferGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(BUFFER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer API HTTP ${res.status}: ${text || res.statusText}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Buffer API: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Buffer API returned no data");
  return json.data;
}

let channelsCache: { value: BufferChannel[]; at: number } | null = null;
let orgIdCache: { value: string; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the organization that owns the channels.
 *
 * Must use `account { organizations }`. A personal access token may NOT read
 * `account { currentOrganization }` — Buffer answers HTTP 200 but puts a
 * FORBIDDEN error ("Not authorized to access this resource") in the errors
 * array, which fails every Buffer call at this first hop. The account has one
 * organization, so we take the first.
 */
async function getOrganizationId(): Promise<string> {
  if (orgIdCache && Date.now() - orgIdCache.at < CACHE_TTL_MS) {
    return orgIdCache.value;
  }
  const data = await bufferGraphQL<{
    account: { organizations: { id: string }[] | null } | null;
  }>(`query { account { organizations { id } } }`);
  const id = data.account?.organizations?.[0]?.id;
  if (!id) {
    throw new Error(
      "Buffer: no organization on this account — connect a Buffer org first.",
    );
  }
  orgIdCache = { value: id, at: Date.now() };
  return id;
}

export async function listChannels(force = false): Promise<BufferChannel[]> {
  if (!force && channelsCache && Date.now() - channelsCache.at < CACHE_TTL_MS) {
    return channelsCache.value;
  }
  const organizationId = await getOrganizationId();
  const data = await bufferGraphQL<{ channels: BufferChannel[] }>(
    `query Channels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) { id name service }
    }`,
    { organizationId },
  );
  channelsCache = { value: data.channels, at: Date.now() };
  return data.channels;
}

/**
 * Find the Buffer channel id for one of the services we syndicate to. Buffer
 * normalizes service slugs (e.g. "facebook" / "instagram" / "linkedin"), but
 * accounts can have multiple of the same service — we take the first match.
 */
export async function findChannelId(
  service: BufferService,
): Promise<string | null> {
  const channels = await listChannels();
  const match = channels.find(
    (c) => c.service?.toLowerCase() === service.toLowerCase(),
  );
  return match?.id ?? null;
}

/**
 * How a post enters Buffer:
 *  - "queue":     slot into the channel's existing queue schedule (the proven
 *                 default — user can still reorder/edit before it goes live).
 *  - "scheduled": post at a specific instant (`scheduledAt`). Used when the WP
 *                 article is itself scheduled, so social fires *after* the
 *                 article is live and the link resolves.
 *  - "draft":     save as a Buffer draft — nothing auto-publishes. Used when
 *                 the WP post is saved as a draft.
 */
export type BufferMode = "queue" | "scheduled" | "draft";

export interface CreatePostInput {
  channelId: string;
  text: string;
  imageUrl?: string;
  /** Channel service. Used to build platform-specific metadata (e.g., Instagram requires a post type). */
  service?: BufferService;
  /** Defaults to "queue". */
  mode?: BufferMode;
  /** ISO 8601 instant. Required when mode === "scheduled". */
  scheduledAt?: string;
}

export interface CreatePostResult {
  id: string;
}

/**
 * Build the per-mode `createPost` input fragment. We keep channelId/text/
 * assets/metadata as GraphQL variables, but inline the scheduling fields.
 * `dueAt` is our own ISO string (no quotes or specials), so inlining it as a
 * literal is safe and sidesteps declaring Buffer's DateTime scalar.
 *
 * Field/enum names below are verified against Buffer's live GraphQL schema
 * (CreatePostInput): schedulingType ∈ {notification, automatic}; mode (ShareMode)
 * ∈ {addToQueue, shareNow, shareNext, customScheduled, recommendedTime}; a
 * specific time is set via `dueAt`; drafts are flagged with `saveToDraft`.
 * We always use schedulingType=automatic (Buffer publishes for us, vs.
 * "notification" which only reminds the user).
 */
function buildCreatePostInput(mode: BufferMode, scheduledAt?: string): string {
  switch (mode) {
    case "scheduled": {
      if (!scheduledAt) throw new Error("scheduledAt is required for scheduled Buffer posts");
      const iso = new Date(scheduledAt).toISOString();
      return `
        channelId: $channelId
        text: $text
        schedulingType: automatic
        mode: customScheduled
        dueAt: "${iso}"
        assets: $assets
        metadata: $metadata`;
    }
    case "draft":
      // Saved as a draft (nothing auto-publishes). mode is NON_NULL on the
      // input, so we still pass addToQueue — it's where the post lands if she
      // later approves the draft in Buffer.
      return `
        channelId: $channelId
        text: $text
        schedulingType: automatic
        mode: addToQueue
        saveToDraft: true
        assets: $assets
        metadata: $metadata`;
    case "queue":
    default:
      return `
        channelId: $channelId
        text: $text
        schedulingType: automatic
        mode: addToQueue
        assets: $assets
        metadata: $metadata`;
  }
}

/**
 * Create a post on a single channel. The `mode` controls whether it joins the
 * channel queue, is scheduled for a specific time, or is saved as a draft.
 */
export async function createBufferPost(
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const mode = input.mode ?? "queue";
  const mutation = `
    mutation CreatePost(
      $channelId: ChannelId!
      $text: String!
      $assets: [AssetInput!]
      $metadata: PostInputMetaData
    ) {
      createPost(input: {${buildCreatePostInput(mode, input.scheduledAt)}
      }) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }
  `;

  const assets = input.imageUrl
    ? [{ image: { url: input.imageUrl } }]
    : undefined;

  // Instagram and Facebook require channel-specific metadata. LinkedIn
  // accepts default text+image posts without per-channel options, so we
  // omit metadata for it. PostInputMetaData uses @oneOf — set exactly one
  // when applicable.
  const metadata =
    input.service === "instagram"
      ? { instagram: { type: "post", shouldShareToFeed: true } }
      : input.service === "facebook"
        ? { facebook: { type: "post" } }
        : undefined;

  const data = await bufferGraphQL<{
    createPost:
      | { post: { id: string } }
      | { message: string };
  }>(mutation, {
    channelId: input.channelId,
    text: input.text,
    assets,
    metadata,
  });

  const result = data.createPost;
  if ("message" in result) {
    throw new Error(`Buffer rejected post: ${result.message}`);
  }
  return { id: result.post.id };
}

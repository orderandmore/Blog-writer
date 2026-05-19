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

async function getOrganizationId(): Promise<string> {
  if (orgIdCache && Date.now() - orgIdCache.at < CACHE_TTL_MS) {
    return orgIdCache.value;
  }
  const data = await bufferGraphQL<{
    account: { currentOrganization: { id: string } | null } | null;
  }>(`query { account { currentOrganization { id } } }`);
  const id = data.account?.currentOrganization?.id;
  if (!id) {
    throw new Error(
      "Buffer: no current organization on this account — connect a Buffer org first.",
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

export interface CreatePostInput {
  channelId: string;
  text: string;
  imageUrl?: string;
  /** Channel service. Used to build platform-specific metadata (e.g., Instagram requires a post type). */
  service?: BufferService;
}

export interface CreatePostResult {
  id: string;
}

/**
 * Add a post to the queue for a single channel. Uses schedulingType=automatic
 * + mode=addToQueue so it slots into the channel's existing queue schedule —
 * the user can still review/edit/reorder in Buffer before it goes live.
 */
export async function createBufferPost(
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const mutation = `
    mutation CreatePost(
      $channelId: ChannelId!
      $text: String!
      $assets: [AssetInput!]
      $metadata: PostInputMetaData
    ) {
      createPost(input: {
        channelId: $channelId
        text: $text
        schedulingType: automatic
        mode: addToQueue
        assets: $assets
        metadata: $metadata
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

const BUFFER_API = "https://api.buffer.com";

// Module state
interface BufferConfig {
  api_key: string;
  organization_id: string;
  organization_name?: string;
  selected_channels?: string[];
}

let bufferConfig: BufferConfig | null = null;

// --- GraphQL helper ---

async function gql(query: string, variables?: Record<string, any>): Promise<any> {
  if (!bufferConfig) throw new Error("Buffer is not connected");

  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bufferConfig.api_key}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buffer API error (${res.status}): ${body}`);
  }

  const json: any = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join("; "));
  }
  return json.data;
}

// --- Connection test ---

export async function testBufferConnection(apiKey: string): Promise<{ organization_id: string; organization_name: string }> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: `query { account { organizations { id name } } }`,
    }),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid API key. Generate one at publish.buffer.com/settings/api");
    }
    const body = await res.text();
    throw new Error(`Buffer API error (${res.status}): ${body}`);
  }

  const json: any = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join("; "));
  }

  const orgs = json.data?.account?.organizations;
  if (!orgs || orgs.length === 0) {
    throw new Error("No organizations found on this Buffer account");
  }

  return { organization_id: orgs[0].id, organization_name: orgs[0].name || "Connected" };
}

// --- Lifecycle ---

export function startBuffer(config: BufferConfig): void {
  bufferConfig = config;
  console.log(`Buffer connected${config.organization_name ? ` (${config.organization_name})` : ""}`);
}

export function stopBuffer(): void {
  bufferConfig = null;
  console.log("Buffer disconnected");
}

export function isBufferRunning(): boolean {
  return bufferConfig !== null;
}

export function getBufferOrgName(): string | null {
  return bufferConfig?.organization_name || null;
}

export function getSelectedChannels(): string[] {
  return bufferConfig?.selected_channels || [];
}

// --- API wrappers ---

export async function bufferListChannels(): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const data = await gql(`
      query ($input: ChannelsInput!) {
        channels(input: $input) {
          id
          displayName
          service
          avatar
          type
          isQueuePaused
          timezone
        }
      }
    `, { input: { organizationId: bufferConfig.organization_id } });

    const channels = (data.channels || []).map((c: any) => ({
      id: c.id,
      name: c.displayName,
      service: c.service,
      avatar: c.avatar,
      type: c.type,
      queue_paused: c.isQueuePaused,
      timezone: c.timezone,
    }));

    return JSON.stringify({ channels, count: channels.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list channels" });
  }
}

export async function bufferCreatePost(input: {
  channel_id: string;
  text: string;
  mode: "share_now" | "add_to_queue" | "custom_scheduled";
  due_at?: string;
  image_url?: string;
  link_url?: string;
}): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const modeMap: Record<string, string> = {
      share_now: "shareNow",
      add_to_queue: "addToQueue",
      custom_scheduled: "customScheduled",
    };

    const postInput: any = {
      channelId: input.channel_id,
      text: input.text,
      schedulingType: "automatic",
      mode: modeMap[input.mode] || "addToQueue",
    };

    if (input.mode === "custom_scheduled" && input.due_at) {
      postInput.dueAt = input.due_at;
    }

    if (input.image_url || input.link_url) {
      postInput.assets = {};
      if (input.image_url) postInput.assets.images = [{ url: input.image_url }];
      if (input.link_url) postInput.assets.link = { url: input.link_url };
    }

    const data = await gql(`
      mutation ($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess {
            post { id text status dueAt channelId }
          }
          ... on InvalidInputError { message }
          ... on LimitReachedError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
        }
      }
    `, { input: postInput });

    const result = data.createPost;
    if (result.post) {
      return JSON.stringify({
        success: true,
        id: result.post.id,
        text: result.post.text,
        status: result.post.status,
        due_at: result.post.dueAt,
        channel_id: result.post.channelId,
      });
    }

    return JSON.stringify({ error: result.message || "Failed to create post" });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create post" });
  }
}

export async function bufferListPosts(params?: {
  status?: string[];
  channel_ids?: string[];
  limit?: number;
}): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const filter: any = {};
    if (params?.status) filter.status = params.status;
    if (params?.channel_ids) filter.channelIds = params.channel_ids;

    const data = await gql(`
      query ($input: PostsInput!, $first: Int) {
        posts(input: $input, first: $first) {
          edges {
            node {
              id
              text
              status
              dueAt
              sentAt
              channelId
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `, {
      input: {
        organizationId: bufferConfig.organization_id,
        filter,
        sort: [{ field: "dueAt", direction: "desc" }],
      },
      first: Math.min(params?.limit || 20, 50),
    });

    const posts = (data.posts?.edges || []).map((e: any) => ({
      id: e.node.id,
      text: e.node.text,
      status: e.node.status,
      due_at: e.node.dueAt,
      sent_at: e.node.sentAt,
      channel_id: e.node.channelId,
    }));

    return JSON.stringify({
      posts,
      count: posts.length,
      has_more: data.posts?.pageInfo?.hasNextPage || false,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list posts" });
  }
}

export async function bufferDeletePost(postId: string): Promise<string> {
  if (!bufferConfig) return JSON.stringify({ error: "Buffer is not connected" });

  try {
    const data = await gql(`
      mutation ($input: DeletePostInput!) {
        deletePost(input: $input) {
          ... on PostActionSuccess {
            post { id status }
          }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
        }
      }
    `, { input: { postId } });

    const result = data.deletePost;
    if (result.post) {
      return JSON.stringify({ success: true, id: result.post.id });
    }

    return JSON.stringify({ error: result.message || "Failed to delete post" });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to delete post" });
  }
}

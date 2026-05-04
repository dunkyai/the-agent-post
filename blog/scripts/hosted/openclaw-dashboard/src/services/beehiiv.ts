const BEEHIIV_API = "https://api.beehiiv.com/v2";

// Module state
interface BeehiivConfig {
  api_key: string;
  publication_id: string;
  publication_name: string;
  templates?: { name: string; id: string }[];
}

let beehiivConfig: BeehiivConfig | null = null;

// --- Connection test ---

export async function testBeehiivConnection(apiKey: string): Promise<{ publications: { id: string; name: string }[] }> {
  const res = await fetch(`${BEEHIIV_API}/publications`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid API key. Generate one in your Beehiiv dashboard under Settings → API.");
    }
    const body = await res.text();
    throw new Error(`Beehiiv API error (${res.status}): ${body}`);
  }

  const json: any = await res.json();
  const pubs = json.data;
  if (!pubs || pubs.length === 0) {
    throw new Error("No publications found on this Beehiiv account");
  }

  return { publications: pubs.map((p: any) => ({ id: p.id, name: p.name || "Unnamed" })) };
}

// --- Lifecycle ---

export function startBeehiiv(config: BeehiivConfig): void {
  beehiivConfig = config;
  console.log(`Beehiiv connected (${config.publication_name})`);
}

export function stopBeehiiv(): void {
  beehiivConfig = null;
  console.log("Beehiiv disconnected");
}

export function isBeehiivRunning(): boolean {
  return beehiivConfig !== null;
}

export function getBeehiivPublicationName(): string | null {
  return beehiivConfig?.publication_name || null;
}

// --- API wrappers ---

export async function fetchTemplates(apiKey: string, publicationId: string): Promise<{ name: string; id: string }[]> {
  try {
    const res = await fetch(`${BEEHIIV_API}/publications/${publicationId}/post_templates`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const templates = json.data || [];
    return templates.map((t: any) => ({ name: t.name || "Untitled", id: t.id }));
  } catch {
    return [];
  }
}

export async function beehiivListTemplates(): Promise<string> {
  if (!beehiivConfig) return JSON.stringify({ error: "Beehiiv is not connected" });

  const templates = await fetchTemplates(beehiivConfig.api_key, beehiivConfig.publication_id);
  return JSON.stringify({
    templates,
    count: templates.length,
  });
}

export async function beehiivCreateDraft(input: {
  title: string;
  body_content: string;
  subtitle?: string;
  email_subject_line?: string;
  email_preview_text?: string;
  content_tags?: string[];
  slug?: string;
  template_id?: string;
}): Promise<string> {
  if (!beehiivConfig) return JSON.stringify({ error: "Beehiiv is not connected" });

  try {
    const payload: any = {
      title: input.title,
      body_content: input.body_content,
      status: "draft",
    };

    if (input.subtitle) payload.subtitle = input.subtitle;
    if (input.content_tags?.length) payload.content_tags = input.content_tags;
    if (input.slug) payload.web_settings = { slug: input.slug };

    // Email settings
    if (input.email_subject_line || input.email_preview_text) {
      payload.email_settings = {};
      if (input.email_subject_line) payload.email_settings.subject_line = input.email_subject_line;
      if (input.email_preview_text) payload.email_settings.preview_text = input.email_preview_text;
    }

    // Template: use explicit template_id, fall back to first configured template
    const templateId = input.template_id || beehiivConfig.templates?.[0]?.id;
    if (templateId) payload.post_template_id = templateId;

    const res = await fetch(`${BEEHIIV_API}/publications/${beehiivConfig.publication_id}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${beehiivConfig.api_key}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Beehiiv API error (${res.status}): ${body}` });
    }

    const data: any = await res.json();
    const post = data.data || data;

    return JSON.stringify({
      success: true,
      id: post.id,
      title: post.title,
      subtitle: post.subtitle,
      status: post.status,
      slug: post.slug,
      web_url: post.web_url,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create draft" });
  }
}

export async function beehiivListPosts(params?: {
  status?: string;
  limit?: number;
  page?: number;
  order_by?: string;
  direction?: string;
  content_tags?: string[];
}): Promise<string> {
  if (!beehiivConfig) return JSON.stringify({ error: "Beehiiv is not connected" });

  try {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    query.set("limit", String(Math.min(params?.limit || 20, 100)));
    if (params?.page) query.set("page", String(params.page));
    query.set("order_by", params?.order_by || "publish_date");
    query.set("direction", params?.direction || "desc");
    if (params?.content_tags?.length) {
      for (const tag of params.content_tags) query.append("content_tags[]", tag);
    }
    query.append("expand[]", "stats");

    const res = await fetch(
      `${BEEHIIV_API}/publications/${beehiivConfig.publication_id}/posts?${query.toString()}`,
      { headers: { Authorization: `Bearer ${beehiivConfig.api_key}` } },
    );

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Beehiiv API error (${res.status}): ${body}` });
    }

    const json: any = await res.json();
    const posts = (json.data || []).map((p: any) => ({
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      status: p.status,
      slug: p.slug,
      web_url: p.web_url,
      created_at: p.created ? new Date(p.created * 1000).toISOString() : undefined,
      publish_date: p.publish_date ? new Date(p.publish_date * 1000).toISOString() : undefined,
      stats: p.stats ? {
        email_recipients: p.stats.email?.recipients,
        opens: p.stats.email?.opens,
        clicks: p.stats.email?.clicks,
        web_views: p.stats.web?.views,
      } : undefined,
    }));

    return JSON.stringify({
      posts,
      count: posts.length,
      total: json.total_results,
      page: json.page || params?.page || 1,
      total_pages: json.total_pages,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list posts" });
  }
}

export async function beehiivGetPost(postId: string): Promise<string> {
  if (!beehiivConfig) return JSON.stringify({ error: "Beehiiv is not connected" });

  try {
    const query = new URLSearchParams();
    query.set("expand[]", "stats");
    query.set("expand[]", "free_web_content");
    query.set("expand[]", "free_email_content");

    const res = await fetch(
      `${BEEHIIV_API}/publications/${beehiivConfig.publication_id}/posts/${postId}?${query.toString()}`,
      { headers: { Authorization: `Bearer ${beehiivConfig.api_key}` } },
    );

    if (!res.ok) {
      const body = await res.text();
      return JSON.stringify({ error: `Beehiiv API error (${res.status}): ${body}` });
    }

    const json: any = await res.json();
    const p = json.data || json;

    return JSON.stringify({
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      status: p.status,
      slug: p.slug,
      web_url: p.web_url,
      created_at: p.created ? new Date(p.created * 1000).toISOString() : undefined,
      publish_date: p.publish_date ? new Date(p.publish_date * 1000).toISOString() : undefined,
      content_tags: p.content_tags,
      web_content: p.content?.free?.web,
      email_content: p.content?.free?.email,
      stats: p.stats ? {
        email_recipients: p.stats.email?.recipients,
        opens: p.stats.email?.opens,
        clicks: p.stats.email?.clicks,
        web_views: p.stats.web?.views,
      } : undefined,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get post" });
  }
}

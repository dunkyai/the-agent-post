/**
 * WordPress integration — create, list, update posts and upload media.
 * Uses WordPress REST API with Application Passwords (Basic Auth).
 */

interface WordPressConfig {
  site_url: string;
  username: string;
  application_password: string;
  site_name: string;
}

let config: WordPressConfig | null = null;

function authHeader(): string {
  if (!config) throw new Error("WordPress not connected");
  return "Basic " + Buffer.from(`${config.username}:${config.application_password}`).toString("base64");
}

function apiUrl(path: string): string {
  if (!config) throw new Error("WordPress not connected");
  const base = config.site_url.replace(/\/$/, "");
  return `${base}/wp-json/wp/v2${path}`;
}

// --- Lifecycle ---

export async function testWordPressConnection(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<{ site_name: string }> {
  const base = siteUrl.replace(/\/$/, "");
  const auth = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  // Test with /wp-json/wp/v2/users/me
  const res = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, {
    headers: { Authorization: auth },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Invalid credentials. Make sure you're using an Application Password, not your regular WordPress password.");
    }
    throw new Error(`WordPress API returned ${res.status}. Make sure the URL is correct and the REST API is enabled.`);
  }

  // Get site name from /wp-json
  let siteName = siteUrl;
  try {
    const siteRes = await fetch(`${base}/wp-json`, { headers: { Authorization: auth } });
    if (siteRes.ok) {
      const siteData: any = await siteRes.json();
      siteName = siteData.name || siteUrl;
    }
  } catch {}

  return { site_name: siteName };
}

export function startWordPress(cfg: WordPressConfig): void {
  config = cfg;
  console.log(`WordPress connected (${cfg.site_name})`);
}

export function stopWordPress(): void {
  config = null;
  console.log("WordPress disconnected");
}

export function isWordPressRunning(): boolean {
  return config !== null;
}

export function getWordPressSiteName(): string | null {
  return config?.site_name || null;
}

// --- Posts ---

export async function wordPressCreatePost(input: {
  title: string;
  content: string;
  status?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    const payload: any = {
      title: input.title,
      content: input.content,
      status: input.status || "draft",
    };
    if (input.categories?.length) payload.categories = input.categories;
    if (input.tags?.length) payload.tags = input.tags;
    if (input.featured_media) payload.featured_media = input.featured_media;

    const res = await fetch(apiUrl("/posts"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: err.message || `Create post failed (${res.status})` });
    }

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      id: data.id,
      title: data.title?.rendered || input.title,
      link: data.link,
      status: data.status,
      edit_link: `${config.site_url.replace(/\/$/, "")}/wp-admin/post.php?post=${data.id}&action=edit`,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create post" });
  }
}

export async function wordPressListPosts(input?: {
  status?: string;
  limit?: number;
  search?: string;
}): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    const params = new URLSearchParams();
    if (input?.status) params.set("status", input.status);
    if (input?.search) params.set("search", input.search);
    params.set("per_page", String(Math.min(input?.limit || 20, 100)));

    const res = await fetch(apiUrl(`/posts?${params}`), {
      headers: { Authorization: authHeader() },
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: err.message || `List posts failed (${res.status})` });
    }

    const posts = (await res.json()) as any[];
    return JSON.stringify({
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title?.rendered || "",
        status: p.status,
        link: p.link,
        date: p.date,
        excerpt: p.excerpt?.rendered?.replace(/<[^>]*>/g, "").slice(0, 200) || "",
      })),
      count: posts.length,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list posts" });
  }
}

export async function wordPressUpdatePost(input: {
  id: number;
  title?: string;
  content?: string;
  status?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    const payload: any = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.content !== undefined) payload.content = input.content;
    if (input.status !== undefined) payload.status = input.status;
    if (input.categories?.length) payload.categories = input.categories;
    if (input.tags?.length) payload.tags = input.tags;
    if (input.featured_media) payload.featured_media = input.featured_media;

    const res = await fetch(apiUrl(`/posts/${input.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: err.message || `Update post failed (${res.status})` });
    }

    const data: any = await res.json();
    return JSON.stringify({
      success: true,
      id: data.id,
      title: data.title?.rendered || "",
      link: data.link,
      status: data.status,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to update post" });
  }
}

// --- Categories & Tags ---

export async function wordPressListCategories(): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    const res = await fetch(apiUrl("/categories?per_page=100"), {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return JSON.stringify({ error: `List categories failed (${res.status})` });
    const cats = (await res.json()) as any[];
    return JSON.stringify({
      categories: cats.map((c) => ({ id: c.id, name: c.name, count: c.count })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list categories" });
  }
}

export async function wordPressListTags(): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    const res = await fetch(apiUrl("/tags?per_page=100"), {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return JSON.stringify({ error: `List tags failed (${res.status})` });
    const tags = (await res.json()) as any[];
    return JSON.stringify({
      tags: tags.map((t) => ({ id: t.id, name: t.name, count: t.count })),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list tags" });
  }
}

// --- Media Upload ---

export async function wordPressUploadMedia(input: {
  image_url: string;
  filename?: string;
  alt_text?: string;
}): Promise<string> {
  if (!config) return JSON.stringify({ error: "WordPress is not connected" });
  try {
    // Download the image
    const imgRes = await fetch(input.image_url);
    if (!imgRes.ok) return JSON.stringify({ error: `Failed to download image (${imgRes.status})` });

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const filename = input.filename || `image-${Date.now()}.${contentType.split("/")[1] || "jpg"}`;

    // Upload to WordPress
    const res = await fetch(apiUrl("/media"), {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": contentType,
      },
      body: buffer,
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return JSON.stringify({ error: err.message || `Upload failed (${res.status})` });
    }

    const data: any = await res.json();

    // Set alt text if provided
    if (input.alt_text && data.id) {
      await fetch(apiUrl(`/media/${data.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader() },
        body: JSON.stringify({ alt_text: input.alt_text }),
      }).catch(() => {});
    }

    return JSON.stringify({
      success: true,
      id: data.id,
      url: data.source_url,
      title: data.title?.rendered || filename,
      media_details: {
        width: data.media_details?.width,
        height: data.media_details?.height,
      },
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to upload media" });
  }
}

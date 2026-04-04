import crypto from "crypto";
import { upsertIntegration } from "./db";
import { encrypt, encryptOAuthState } from "./encryption";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Module state
interface NotionConfig {
  access_token: string;
  workspace_name: string;
  workspace_id: string;
  bot_id: string;
}

let notionConfig: NotionConfig | null = null;

// --- OAuth URL ---

export function buildNotionOAuthUrl(): string {
  const clientId = process.env.NOTION_CLIENT_ID;
  const instanceId = process.env.INSTANCE_ID;

  if (!clientId) throw new Error("NOTION_CLIENT_ID not configured");
  if (!instanceId) throw new Error("INSTANCE_ID not configured");

  const statePayload = {
    instance_id: instanceId,
    hmac: crypto
      .createHmac("sha256", process.env.GATEWAY_TOKEN!)
      .update(instanceId)
      .digest("hex"),
  };
  const state = encryptOAuthState(statePayload);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://api.agents.theagentpost.co/oauth/notion/callback",
    response_type: "code",
    owner: "user",
    state,
  });

  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

// --- Lifecycle ---

export function startNotion(config: NotionConfig): void {
  notionConfig = config;
  console.log(`Notion connected (workspace: ${config.workspace_name})`);
}

export function stopNotion(): void {
  notionConfig = null;
  console.log("Notion disconnected");
}

export function isNotionRunning(): boolean {
  return notionConfig !== null;
}

export function getNotionWorkspaceName(): string | null {
  return notionConfig?.workspace_name || null;
}

// --- Auth headers ---

function authHeaders(): Record<string, string> {
  if (!notionConfig) throw new Error("Notion is not connected");
  return {
    Authorization: `Bearer ${notionConfig.access_token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

// --- API wrappers ---

export async function notionSearch(query: string, filter?: { property: string; value: string }): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const body: any = {};
    if (query) body.query = query;
    if (filter) body.filter = { value: filter.value, property: filter.property };
    body.page_size = 20;

    const res = await fetch(`${NOTION_API}/search`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const results = (data.results || []).map((r: any) => ({
      id: r.id,
      type: r.object,
      title: extractTitle(r),
      url: r.url,
      last_edited: r.last_edited_time,
    }));

    return JSON.stringify({ results, count: results.length, has_more: data.has_more });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Search failed" });
  }
}

export async function notionGetPage(pageId: string): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const res = await fetch(`${NOTION_API}/pages/${encodeURIComponent(pageId)}`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const page: any = await res.json();
    return JSON.stringify({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      properties: page.properties,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get page" });
  }
}

export async function notionGetPageContent(pageId: string): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const res = await fetch(`${NOTION_API}/blocks/${encodeURIComponent(pageId)}/children?page_size=100`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const blocks = (data.results || []).map((b: any) => ({
      id: b.id,
      type: b.type,
      content: extractBlockText(b),
      has_children: b.has_children,
    }));

    return JSON.stringify({ page_id: pageId, blocks, count: blocks.length, has_more: data.has_more });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get page content" });
  }
}

export async function notionCreatePage(
  parentId: string,
  parentType: "database_id" | "page_id",
  title: string,
  properties?: Record<string, any>,
  children?: any[]
): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const body: any = {
      parent: { [parentType]: parentId },
    };

    // For database parents, properties include the title; for page parents, set title directly
    if (parentType === "database_id") {
      body.properties = properties || {};
      // Ensure title is set if not already in properties
      if (!body.properties.Name && !body.properties.title) {
        body.properties.Name = { title: [{ text: { content: title } }] };
      }
    } else {
      body.properties = {
        title: { title: [{ text: { content: title } }] },
        ...properties,
      };
    }

    if (children && children.length > 0) {
      body.children = children;
    }

    const res = await fetch(`${NOTION_API}/pages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const page: any = await res.json();
    return JSON.stringify({ success: true, id: page.id, url: page.url });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to create page" });
  }
}

export async function notionUpdatePage(pageId: string, properties: Record<string, any>): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const res = await fetch(`${NOTION_API}/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ properties }),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const page: any = await res.json();
    return JSON.stringify({ success: true, id: page.id, url: page.url });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to update page" });
  }
}

export async function notionQueryDatabase(
  databaseId: string,
  filter?: any,
  sorts?: any[],
  pageSize?: number
): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const body: any = { page_size: pageSize || 20 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;

    const res = await fetch(`${NOTION_API}/databases/${encodeURIComponent(databaseId)}/query`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    const results = (data.results || []).map((r: any) => ({
      id: r.id,
      properties: r.properties,
      url: r.url,
      created_time: r.created_time,
      last_edited_time: r.last_edited_time,
    }));

    return JSON.stringify({ database_id: databaseId, results, count: results.length, has_more: data.has_more });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to query database" });
  }
}

export async function notionGetDatabase(databaseId: string): Promise<string> {
  if (!notionConfig) return JSON.stringify({ error: "Notion is not connected" });

  try {
    const res = await fetch(`${NOTION_API}/databases/${encodeURIComponent(databaseId)}`, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Notion API error (${res.status}): ${await res.text()}` });
    }

    const db: any = await res.json();
    const properties: Record<string, { type: string; id: string }> = {};
    for (const [key, val] of Object.entries(db.properties || {})) {
      properties[key] = { type: (val as any).type, id: (val as any).id };
    }

    return JSON.stringify({
      id: db.id,
      title: extractTitle(db),
      url: db.url,
      properties,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get database" });
  }
}

// --- Helpers ---

function extractTitle(obj: any): string {
  // Pages and databases store titles differently
  if (obj.properties) {
    for (const val of Object.values(obj.properties)) {
      const prop = val as any;
      if (prop.type === "title" && Array.isArray(prop.title)) {
        return prop.title.map((t: any) => t.plain_text || "").join("");
      }
    }
  }
  // Database title array
  if (Array.isArray(obj.title)) {
    return obj.title.map((t: any) => t.plain_text || "").join("");
  }
  return "Untitled";
}

function extractBlockText(block: any): string {
  const type = block.type;
  const data = block[type];
  if (!data) return "";

  // Most block types have a rich_text array
  if (Array.isArray(data.rich_text)) {
    return data.rich_text.map((t: any) => t.plain_text || "").join("");
  }
  // Some blocks like child_page have a title
  if (data.title) return data.title;

  return "";
}

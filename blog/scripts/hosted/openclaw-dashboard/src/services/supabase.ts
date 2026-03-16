// Module state
let supabaseConfig: { projectUrl: string; apiKey: string; permissions: string[] } | null = null;

export function startSupabase(config: { projectUrl: string; apiKey: string; permissions?: string[] }): void {
  supabaseConfig = { ...config, permissions: config.permissions || ["read"] };
  console.log(`Supabase connected (${config.projectUrl}, permissions: ${supabaseConfig.permissions.join(", ")})`);
}

export function stopSupabase(): void {
  supabaseConfig = null;
  console.log("Supabase disconnected");
}

export function isSupabaseRunning(): boolean {
  return supabaseConfig !== null;
}

export function getSupabaseProjectUrl(): string | null {
  return supabaseConfig?.projectUrl || null;
}

export function getSupabasePermissions(): string[] {
  return supabaseConfig?.permissions || ["read"];
}

function headers(): Record<string, string> {
  if (!supabaseConfig) throw new Error("Supabase is not connected");
  return {
    apikey: supabaseConfig.apiKey,
    Authorization: `Bearer ${supabaseConfig.apiKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function baseUrl(): string {
  if (!supabaseConfig) throw new Error("Supabase is not connected");
  return supabaseConfig.projectUrl.replace(/\/$/, "");
}

export async function supabaseListTables(): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  try {
    const res = await fetch(`${baseUrl()}/rest/v1/`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Supabase API error (${res.status}): ${await res.text()}` });
    }

    const data: any = await res.json();
    // PostgREST root returns OpenAPI spec with path definitions = table names
    const tables = Object.keys(data.paths || {})
      .map((p) => p.replace(/^\//, ""))
      .filter((t) => t && !t.startsWith("rpc/"));

    return JSON.stringify({ tables, count: tables.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to list tables" });
  }
}

export async function supabaseQuery(
  table: string,
  select?: string,
  filters?: Record<string, string>,
  limit?: number
): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  try {
    const params = new URLSearchParams();
    if (select) params.set("select", select);
    if (limit) params.set("limit", String(limit));

    // Filters use PostgREST syntax: column=operator.value
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        params.set(key, value);
      }
    }

    const url = `${baseUrl()}/rest/v1/${encodeURIComponent(table)}?${params}`;
    const res = await fetch(url, { headers: headers() });

    if (!res.ok) {
      return JSON.stringify({ error: `Query error (${res.status}): ${await res.text()}` });
    }

    const rows = await res.json();
    return JSON.stringify({ table, rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

export async function supabaseInsert(table: string, records: any[]): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  try {
    const res = await fetch(`${baseUrl()}/rest/v1/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(records),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Insert error (${res.status}): ${await res.text()}` });
    }

    const data = await res.json();
    return JSON.stringify({ success: true, inserted: Array.isArray(data) ? data.length : 1, data });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Insert failed" });
  }
}

export async function supabaseUpdate(
  table: string,
  match: Record<string, string>,
  data: Record<string, any>
): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(match)) {
      params.set(key, value);
    }

    const res = await fetch(`${baseUrl()}/rest/v1/${encodeURIComponent(table)}?${params}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Update error (${res.status}): ${await res.text()}` });
    }

    const result = await res.json();
    return JSON.stringify({ success: true, updated: Array.isArray(result) ? result.length : 1, data: result });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Update failed" });
  }
}

export async function supabaseDelete(
  table: string,
  match: Record<string, string>
): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(match)) {
      params.set(key, value);
    }

    const res = await fetch(`${baseUrl()}/rest/v1/${encodeURIComponent(table)}?${params}`, {
      method: "DELETE",
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Delete error (${res.status}): ${await res.text()}` });
    }

    const result = await res.json();
    return JSON.stringify({ success: true, deleted: Array.isArray(result) ? result.length : 0, data: result });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Delete failed" });
  }
}

// Test connection by hitting the PostgREST root
export async function testSupabaseConnection(projectUrl: string, apiKey: string): Promise<void> {
  const url = projectUrl.replace(/\/$/, "");
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Connection failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

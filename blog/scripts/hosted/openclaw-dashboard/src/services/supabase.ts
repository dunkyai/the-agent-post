// Module state
let supabaseConfig: { projectUrl: string; apiKey: string; permissions: string[] } | null = null;

export function startSupabase(config: { projectUrl: string; apiKey: string; permissions?: string[] }): void {
  supabaseConfig = { ...config, permissions: config.permissions || ["read"] };
  schemaCache = null; // Clear schema cache on reconnect
  console.log(`Supabase connected (${config.projectUrl}, permissions: ${supabaseConfig.permissions.join(", ")})`);
}

export function stopSupabase(): void {
  supabaseConfig = null;
  schemaCache = null;
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
  return sanitizeUrl(supabaseConfig.projectUrl);
}

function sanitizeUrl(raw: string): string {
  const parsed = new URL(raw);
  parsed.username = "";
  parsed.password = "";
  return parsed.origin;
}

// Cache for schema info (tables + columns) to avoid repeated slow OpenAPI spec fetches
let schemaCache: { tables: string[]; definitions: Record<string, any>; fetchedAt: number } | null = null;
const SCHEMA_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchAndCacheSchema(): Promise<{ tables: string[]; definitions: Record<string, any> } | null> {
  if (schemaCache && Date.now() - schemaCache.fetchedAt < SCHEMA_CACHE_TTL) {
    return schemaCache;
  }

  try {
    const res = await fetch(`${baseUrl()}/rest/v1/`, {
      headers: headers(),
    });

    if (!res.ok) return null;

    const data: any = await res.json();
    const tables = Object.keys(data.paths || {})
      .map((p) => p.replace(/^\//, ""))
      .filter((t) => t && !t.startsWith("rpc/"));

    schemaCache = { tables, definitions: data.definitions || {}, fetchedAt: Date.now() };
    return schemaCache;
  } catch {
    return null;
  }
}

export async function supabaseListTables(): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  const schema = await fetchAndCacheSchema();
  if (schema) {
    return JSON.stringify({ tables: schema.tables, count: schema.tables.length });
  }

  return JSON.stringify({ error: "Could not fetch table list — the database schema query timed out. You can try querying tables directly by name if you know them." });
}

export async function supabaseDescribeTable(table: string): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  // Try cached schema first (avoids hitting the slow OpenAPI spec endpoint)
  const schema = await fetchAndCacheSchema();
  if (schema?.definitions?.[table]?.properties) {
    const columns = Object.entries(schema.definitions[table].properties).map(([name, def]: [string, any]) => ({
      name,
      type: def.format || def.type || "unknown",
      description: def.description || undefined,
    }));
    return JSON.stringify({ table, columns, count: columns.length });
  }

  // Fallback: fetch a single row to infer column names (may timeout on very wide tables)
  try {
    const res = await fetch(`${baseUrl()}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, {
      headers: headers(),
    });

    if (!res.ok) {
      return JSON.stringify({ table, columns: [], note: "Could not describe table — it may be too large. Try querying specific column names you expect to find." });
    }

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return JSON.stringify({ table, columns: [], note: "Table is empty or inaccessible" });
    }

    const columns = Object.entries(rows[0]).map(([name, value]) => ({
      name,
      type: value === null ? "unknown" : Array.isArray(value) ? "array" : typeof value,
    }));

    return JSON.stringify({ table, columns, count: columns.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Failed to describe table" });
  }
}

export async function supabaseQuery(
  table: string,
  select?: string,
  filters?: Record<string, string>,
  limit?: number
): Promise<string> {
  if (!supabaseConfig) return JSON.stringify({ error: "Supabase is not connected" });

  // Enforce a select to avoid SELECT * on wide tables
  if (!select) {
    return JSON.stringify({ error: "You must specify a 'select' with the column names you need. Call supabase_describe_table first to see available columns." });
  }

  // Cap limit to avoid huge result sets
  const safeLimit = Math.min(limit || 50, 200);

  try {
    const result = await supabaseQueryInternal(table, select, filters, safeLimit);
    if (result.error && (result.raw?.includes("57014") || result.raw?.includes("statement timeout"))) {
      // Retry with no filters — let the AI filter in post-processing
      console.log(`Supabase query timeout on ${table} with filters, retrying without filters (limit ${Math.min(safeLimit, 50)})`);
      const retry = await supabaseQueryInternal(table, select, undefined, Math.min(safeLimit, 50));
      if (retry.error) return JSON.stringify({ error: retry.error });
      return JSON.stringify({
        table,
        rows: retry.rows,
        count: retry.rows.length,
        note: "Original filtered query timed out. Returned unfiltered results — please filter these yourself.",
      });
    }
    if (result.error) return JSON.stringify({ error: result.error });
    return JSON.stringify({ table, rows: result.rows, count: result.rows.length });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

async function supabaseQueryInternal(
  table: string,
  select: string,
  filters?: Record<string, string>,
  limit?: number
): Promise<{ rows: any[]; error?: string; raw?: string }> {
  const params = new URLSearchParams();
  params.set("select", select);
  if (limit) params.set("limit", String(limit));

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      params.set(key, value);
    }
  }

  const url = `${baseUrl()}/rest/v1/${encodeURIComponent(table)}?${params}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(15_000) });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return { rows: [], error: `Query timed out on table "${table}". This table may be too large or unindexed for this query.`, raw: "57014" };
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    return { rows: [], error: `Query error (${res.status}): ${body}`, raw: body };
  }

  const rows = await res.json();
  return { rows: Array.isArray(rows) ? rows : [] };
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
  const url = sanitizeUrl(projectUrl);
  // Simple validation: just check the key looks like a JWT and the URL is reachable
  if (!apiKey.startsWith("eyJ")) {
    throw new Error("Invalid API key format — use the anon or service_role key (starts with 'eyJ')");
  }

  const res = await fetch(`${url}/auth/v1/settings`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid API key — check that you're using the anon or service_role key");
  }
}

// Probe tables after connecting to detect slow/unindexed ones
export async function probeSupabaseHealth(): Promise<{
  totalTables: number;
  slowTables: string[];
  fastTables: string[];
  schemaTimeout: boolean;
}> {
  if (!supabaseConfig) return { totalTables: 0, slowTables: [], fastTables: [], schemaTimeout: false };

  // First, fetch schema (with a 10-second timeout for the OpenAPI spec itself)
  let tables: string[];
  try {
    const res = await fetch(`${baseUrl()}/rest/v1/`, {
      headers: headers(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { totalTables: 0, slowTables: [], fastTables: [], schemaTimeout: true };
    }

    const data: any = await res.json();
    tables = Object.keys(data.paths || {})
      .map((p) => p.replace(/^\//, ""))
      .filter((t) => t && !t.startsWith("rpc/"));

    // Cache schema while we have it
    schemaCache = { tables, definitions: data.definitions || {}, fetchedAt: Date.now() };
  } catch {
    return { totalTables: 0, slowTables: [], fastTables: [], schemaTimeout: true };
  }

  if (tables.length === 0) {
    return { totalTables: 0, slowTables: [], fastTables: [], schemaTimeout: false };
  }

  // Probe up to 10 tables in parallel with 5-second timeouts
  const probeTables = tables.slice(0, 10);
  const results = await Promise.allSettled(
    probeTables.map(async (table) => {
      const res = await fetch(
        `${baseUrl()}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`,
        { headers: headers(), signal: AbortSignal.timeout(5_000) }
      );
      if (!res.ok) {
        const body = await res.text();
        if (body.includes("57014") || body.includes("statement timeout")) {
          throw new Error("timeout");
        }
      }
      // Consume body to complete the request
      await res.json();
      return table;
    })
  );

  const slowTables: string[] = [];
  const fastTables: string[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      fastTables.push(probeTables[i]);
    } else {
      slowTables.push(probeTables[i]);
    }
  }

  return { totalTables: tables.length, slowTables, fastTables, schemaTimeout: false };
}

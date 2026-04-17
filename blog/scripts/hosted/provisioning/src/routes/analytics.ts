import { Router } from "express";
import * as store from "../services/store";

const router = Router();

// Admin analytics page — aggregates data from all instances
router.get("/admin/analytics", async (req, res) => {
  // Simple admin auth — require admin secret
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    res.status(500).send("ADMIN_SECRET not configured");
    return;
  }

  const auth = req.query.key || req.headers["x-admin-key"];
  if (auth !== adminSecret) {
    res.status(401).send("Unauthorized");
    return;
  }

  const instances = store.listInstances();

  // Fetch analytics from each running instance in parallel
  const analyticsPromises = instances
    .filter((i) => i.status === "running")
    .map(async (instance) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `http://localhost:${instance.port}/internal/analytics`,
          {
            headers: { Authorization: `Bearer ${instance.gatewayToken}` },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!res.ok) return { instance, analytics: null, error: `HTTP ${res.status}` };
        const data = await res.json();
        return { instance, analytics: data, error: null };
      } catch (err: any) {
        return { instance, analytics: null, error: err.message || "unreachable" };
      }
    });

  const results = await Promise.all(analyticsPromises);

  // Build aggregate hourly activity
  const hourlyTotals: number[] = new Array(24).fill(0);
  for (const r of results) {
    if (r.analytics?.hourly_activity) {
      for (const h of r.analytics.hourly_activity) {
        hourlyTotals[h.hour] += h.count;
      }
    }
  }

  // Sort by most active first
  results.sort((a, b) => (b.analytics?.monthly_tasks || 0) - (a.analytics?.monthly_tasks || 0));

  // Render HTML
  const rows = results.map((r) => {
    const a = r.analytics;
    const lastActive = a?.last_active
      ? new Date(a.last_active + "Z").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "Never";
    const topTools = a?.top_tools?.slice(0, 3).map((t: any) => t.tool).join(", ") || "-";
    return `<tr>
      <td>${r.instance.email || "-"}</td>
      <td>${a?.user_name || "-"}</td>
      <td>${a?.agent_name || "-"}</td>
      <td>${r.instance.id === "staging" ? "staging" : r.instance.id.slice(0, 8)}</td>
      <td>${a?.monthly_tasks ?? (r.error ? `<span style="color:#DC2626">${r.error}</span>` : "0")}</td>
      <td>${a?.message_limit || "-"}</td>
      <td>${a?.plan || "-"}</td>
      <td>${lastActive}</td>
      <td style="font-size:11px">${topTools}</td>
    </tr>`;
  }).join("\n");

  // Build hourly chart bars
  const maxHourly = Math.max(...hourlyTotals, 1);
  const hourBars = hourlyTotals.map((count, hour) => {
    const pct = Math.round((count / maxHourly) * 100);
    const label = hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;
    return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">
      <div style="height:120px;display:flex;align-items:flex-end;width:100%;">
        <div style="width:100%;background:linear-gradient(to top,#7C3AED,#A78BFA);border-radius:3px 3px 0 0;height:${pct}%;min-height:${count > 0 ? 2 : 0}px;transition:height 0.3s;" title="${count} tasks at ${label}"></div>
      </div>
      <div style="font-size:9px;color:#888;margin-top:4px;">${hour % 3 === 0 ? label : ""}</div>
    </div>`;
  }).join("");

  const totalActive = results.filter((r) => r.analytics?.monthly_tasks > 0).length;
  const totalTasks = results.reduce((sum, r) => sum + (r.analytics?.monthly_tasks || 0), 0);

  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dunky Analytics</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #FAFAF9; color: #1C1917; padding: 24px; }
  h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .subtitle { color: #57534E; font-size: 14px; margin-bottom: 24px; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; }
  .stat-card { background: #fff; border: 1px solid #E7E5E4; border-radius: 12px; padding: 16px 20px; flex: 1; }
  .stat-value { font-size: 28px; font-weight: 700; color: #7C3AED; }
  .stat-label { font-size: 12px; color: #57534E; margin-top: 2px; }
  .chart-container { background: #fff; border: 1px solid #E7E5E4; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .chart-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
  .chart { display: flex; gap: 2px; align-items: flex-end; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #E7E5E4; border-radius: 12px; overflow: hidden; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; color: #57534E; font-weight: 600; padding: 10px 12px; border-bottom: 2px solid #E7E5E4; }
  td { padding: 10px 12px; border-bottom: 1px solid #E7E5E4; font-size: 13px; }
  tr:hover { background: #F5F5F4; }
  .refresh { color: #7C3AED; text-decoration: none; font-size: 13px; font-weight: 500; }
</style>
</head><body>
  <h1>Dunky Analytics</h1>
  <p class="subtitle">${instances.length} total instances &middot; <a href="?key=${auth}" class="refresh">Refresh</a></p>

  <div class="stats">
    <div class="stat-card"><div class="stat-value">${totalActive}</div><div class="stat-label">Active this month</div></div>
    <div class="stat-card"><div class="stat-value">${totalTasks}</div><div class="stat-label">Tasks this month</div></div>
    <div class="stat-card"><div class="stat-value">${instances.length}</div><div class="stat-label">Total instances</div></div>
    <div class="stat-card"><div class="stat-value">${instances.filter(i => i.subscriptionStatus === "active").length}</div><div class="stat-label">Paying customers</div></div>
  </div>

  <div class="chart-container">
    <div class="chart-title">Activity by Hour (UTC, last 30 days)</div>
    <div class="chart">${hourBars}</div>
  </div>

  <table>
    <thead><tr>
      <th>Email</th><th>User</th><th>Agent</th><th>Instance</th><th>Tasks (month)</th><th>Limit</th><th>Plan</th><th>Last Active</th><th>Top Tools</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`);
});

export default router;

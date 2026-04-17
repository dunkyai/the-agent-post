import { Router } from "express";
import crypto from "crypto";
import * as store from "../services/store";

const router = Router();

// Admin whitelist — only these emails can access analytics
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "eyin@hustlefundvc.com").split(",").map(e => e.trim().toLowerCase());

// In-memory admin sessions and magic link tokens
const adminSessions = new Map<string, { email: string; expiresAt: number }>();
const adminMagicTokens = new Map<string, { email: string; expiresAt: number }>();

function parseCookies(req: any): Record<string, string> {
  const header = req.headers.cookie || "";
  const cookies: Record<string, string> = {};
  header.split(";").forEach((c: string) => {
    const [key, ...val] = c.trim().split("=");
    if (key) cookies[key] = val.join("=");
  });
  return cookies;
}

function isAdminAuthenticated(req: any): string | null {
  const cookies = parseCookies(req);
  const sessionId = cookies.admin_session;
  if (!sessionId) return null;
  const session = adminSessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    adminSessions.delete(sessionId);
    return null;
  }
  return session.email;
}

// Login page
router.get("/admin/login", (req, res) => {
  const msg = req.query.msg || "";
  res.send(loginPage(msg as string));
});

// Send magic link
router.post("/admin/login", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    res.redirect("/admin/login?msg=Not+authorized");
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminMagicTokens.set(token, { email, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });

  // Send via Resend
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error("RESEND_API_KEY not set");

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Dunky <noreply@dunky.ai>",
        to: [email],
        subject: "Dunky Analytics — Sign In",
        html: `<p>Click to sign in to Dunky Analytics:</p><p><a href="https://api.dunky.ai/admin/auth?token=${token}" style="display:inline-block;padding:12px 24px;background:#7C3AED;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Sign In</a></p><p style="color:#999;font-size:13px;">This link expires in 24 hours.</p>`,
      }),
    });

    res.redirect("/admin/login?msg=Check+your+email+for+the+sign-in+link");
  } catch (err: any) {
    console.error("Admin magic link error:", err.message);
    res.redirect("/admin/login?msg=Failed+to+send+email");
  }
});

// Magic link callback
router.get("/admin/auth", (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.redirect("/admin/login?msg=Invalid+link"); return; }

  const entry = adminMagicTokens.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    adminMagicTokens.delete(token);
    res.redirect("/admin/login?msg=Link+expired");
    return;
  }
  adminMagicTokens.delete(token);

  const sessionId = crypto.randomBytes(32).toString("hex");
  adminSessions.set(sessionId, { email: entry.email, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });

  res.setHeader("Set-Cookie", `admin_session=${sessionId}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
  res.redirect("/admin/analytics");
});

// Analytics page
router.get("/admin/analytics", async (req, res) => {
  // Check admin session
  const adminEmail = isAdminAuthenticated(req);
  if (!adminEmail) {
    res.redirect("/admin/login");
    return;
  }

  const instances = store.listInstances();

  // Fetch analytics from each running instance in parallel
  const analyticsPromises = instances
    .filter((i) => i.status === "running")
    .map(async (instance): Promise<{ instance: typeof instance; analytics: any; error: string | null }> => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(
          `http://localhost:${instance.port}/internal/analytics`,
          {
            headers: { Authorization: `Bearer ${instance.gatewayToken}` },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!r.ok) return { instance, analytics: null, error: `HTTP ${r.status}` };
        const data = await r.json();
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
  const rows = results.filter(r => r.instance).map((r) => {
    const a = r.analytics;
    const inst = r.instance;
    const lastActive = a?.last_active
      ? new Date(a.last_active + "Z").toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "Never";
    const topTools = a?.top_tools?.slice(0, 3).map((t: any) => t.tool).join(", ") || "-";
    return `<tr>
      <td>${inst.email || "-"}</td>
      <td>${a?.user_name || "-"}</td>
      <td>${a?.agent_name || "-"}</td>
      <td>${inst.id === "staging" ? "staging" : inst.id.slice(0, 8)}</td>
      <td>${a?.monthly_tasks ?? (r.error ? `<span style="color:#DC2626">${r.error}</span>` : "0")}</td>
      <td>${a?.message_limit || inst.messageLimit || "-"}</td>
      <td>${a?.plan || inst.plan || "-"}</td>
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
  <p class="subtitle">${instances.length} total instances &middot; <a href="/admin/analytics" class="refresh">Refresh</a></p>

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

function loginPage(msg: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dunky Analytics — Sign In</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #FAFAF9; color: #1C1917; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #E7E5E4; border-radius: 16px; padding: 40px; max-width: 400px; width: 100%; text-align: center; }
  .logo { font-size: 24px; font-weight: 800; color: #7C3AED; margin-bottom: 8px; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
  .desc { color: #57534E; font-size: 14px; margin-bottom: 24px; }
  input { width: 100%; padding: 12px 16px; border: 1px solid #E7E5E4; border-radius: 8px; font-size: 14px; font-family: inherit; margin-bottom: 12px; }
  input:focus { outline: none; border-color: #7C3AED; }
  button { width: 100%; padding: 12px; background: #7C3AED; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #5B21B6; }
  .msg { color: #7C3AED; font-size: 13px; margin-bottom: 16px; }
</style>
</head><body>
<div class="card">
  <div class="logo">dunky.ai</div>
  <h1>Analytics</h1>
  <p class="desc">Sign in with your admin email</p>
  ${msg ? `<p class="msg">${msg}</p>` : ""}
  <form method="POST" action="/admin/login">
    <input type="email" name="email" placeholder="you@company.com" required autofocus>
    <button type="submit">Send Sign-In Link</button>
  </form>
</div>
</body></html>`;
}

export default router;

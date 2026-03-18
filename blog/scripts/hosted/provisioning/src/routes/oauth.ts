import { Router } from "express";
import crypto from "crypto";
import * as store from "../services/store";

const router = Router();

// GET /oauth/google/callback — Google redirects here after user consent
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user denying consent
  if (error) {
    try {
      const statePayload = JSON.parse(
        Buffer.from(state as string, "base64url").toString()
      );
      const instance = store.getInstance(statePayload.instance_id);
      if (instance) {
        res.redirect(
          `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Google+connection+cancelled`
        );
        return;
      }
    } catch {}
    res.status(400).send("Google connection was cancelled.");
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  // Parse and verify state
  let statePayload: { instance_id: string; hmac: string; services: string[] };
  try {
    statePayload = JSON.parse(
      Buffer.from(state as string, "base64url").toString()
    );
  } catch {
    res.status(400).send("Invalid state parameter");
    return;
  }

  const instance = store.getInstance(statePayload.instance_id);
  if (!instance) {
    res.status(404).send("Instance not found");
    return;
  }

  // Verify HMAC (prevents state forgery)
  const expectedHmac = crypto
    .createHmac("sha256", instance.gatewayToken)
    .update(instance.id)
    .digest("hex");
  if (statePayload.hmac !== expectedHmac) {
    res.status(403).send("Invalid state signature");
    return;
  }

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri:
          "https://api.agents.theagentpost.co/oauth/google/callback",
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Google token exchange failed:", body);
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Google+token+exchange+failed`
      );
      return;
    }

    const tokens: any = await tokenRes.json();

    // Get user's email from Google userinfo
    const userinfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const userinfo: any = await userinfoRes.json();

    // Deliver tokens to the instance
    const deliverRes = await fetch(
      `http://localhost:${instance.port}/webhook/google/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${instance.gatewayToken}`,
        },
        body: JSON.stringify({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          services: statePayload.services,
          google_email: userinfo.email,
        }),
      }
    );

    if (!deliverRes.ok) {
      console.error(
        "Token delivery to instance failed:",
        await deliverRes.text()
      );
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Failed+to+deliver+tokens`
      );
      return;
    }

    // Redirect user back to their dashboard
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Google+connected+successfully`
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Google+connection+failed`
    );
  }
});

// GET /oauth/slack/callback — Slack redirects here after user consent
router.get("/slack/callback", async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user denying consent
  if (error) {
    try {
      const statePayload = JSON.parse(
        Buffer.from(state as string, "base64url").toString()
      );
      const instance = store.getInstance(statePayload.instance_id);
      if (instance) {
        res.redirect(
          `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Slack+connection+cancelled`
        );
        return;
      }
    } catch {}
    res.status(400).send("Slack connection was cancelled.");
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  // Parse and verify state
  let statePayload: { instance_id: string; hmac: string };
  try {
    statePayload = JSON.parse(
      Buffer.from(state as string, "base64url").toString()
    );
  } catch {
    res.status(400).send("Invalid state parameter");
    return;
  }

  const instance = store.getInstance(statePayload.instance_id);
  if (!instance) {
    res.status(404).send("Instance not found");
    return;
  }

  // Verify HMAC (prevents state forgery)
  const expectedHmac = crypto
    .createHmac("sha256", instance.gatewayToken)
    .update(instance.id)
    .digest("hex");
  if (statePayload.hmac !== expectedHmac) {
    res.status(403).send("Invalid state signature");
    return;
  }

  try {
    // Exchange authorization code for token
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code: code as string,
        redirect_uri:
          "https://api.agents.theagentpost.co/oauth/slack/callback",
      }),
    });

    const data: any = await tokenRes.json();
    if (!data.ok) {
      console.error("Slack token exchange failed:", data.error);
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Slack+error:+${encodeURIComponent(data.error || "token exchange failed")}`
      );
      return;
    }

    const botToken = data.access_token;
    const botUserId = data.bot_user_id;
    const teamId = data.team?.id;
    const teamName = data.team?.name || null;
    const authedUserId = data.authed_user?.id;

    if (!botToken || !botUserId || !teamId) {
      console.error("Slack OAuth response missing fields:", { botToken: !!botToken, botUserId, teamId });
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Slack+connection+failed`
      );
      return;
    }

    // Save team→instance mapping (first installer keeps the row)
    store.upsertSlackInstallation({
      teamId,
      instanceId: instance.id,
      botUserId,
      teamName,
    });

    // Map the authorizing Slack user to this instance for event routing
    if (authedUserId) {
      store.upsertSlackUserInstance(teamId, authedUserId, instance.id);
      console.log(`Slack user ${authedUserId} mapped to instance ${instance.id}`);
    }

    // Deliver token to the instance
    const deliverRes = await fetch(
      `http://localhost:${instance.port}/webhook/slack/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${instance.gatewayToken}`,
        },
        body: JSON.stringify({
          bot_token: botToken,
          bot_user_id: botUserId,
          team_id: teamId,
          team_name: teamName,
        }),
      }
    );

    if (!deliverRes.ok) {
      console.error(
        "Slack token delivery to instance failed:",
        await deliverRes.text()
      );
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Failed+to+deliver+Slack+tokens`
      );
      return;
    }

    // Redirect user back to their dashboard
    console.log(`Slack connected for instance ${instance.id} (team: ${teamName})`);
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Slack+connected+successfully`
    );
  } catch (err) {
    console.error("Slack OAuth callback error:", err);
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Slack+connection+failed`
    );
  }
});

// GET /oauth/notion/callback — Notion redirects here after user consent
router.get("/notion/callback", async (req, res) => {
  const { code, state, error } = req.query;

  // Handle user denying consent
  if (error) {
    try {
      const statePayload = JSON.parse(
        Buffer.from(state as string, "base64url").toString()
      );
      const instance = store.getInstance(statePayload.instance_id);
      if (instance) {
        res.redirect(
          `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Notion+connection+cancelled`
        );
        return;
      }
    } catch {}
    res.status(400).send("Notion connection was cancelled.");
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  // Parse and verify state
  let statePayload: { instance_id: string; hmac: string };
  try {
    statePayload = JSON.parse(
      Buffer.from(state as string, "base64url").toString()
    );
  } catch {
    res.status(400).send("Invalid state parameter");
    return;
  }

  const instance = store.getInstance(statePayload.instance_id);
  if (!instance) {
    res.status(404).send("Instance not found");
    return;
  }

  // Verify HMAC (prevents state forgery)
  const expectedHmac = crypto
    .createHmac("sha256", instance.gatewayToken)
    .update(instance.id)
    .digest("hex");
  if (statePayload.hmac !== expectedHmac) {
    res.status(403).send("Invalid state signature");
    return;
  }

  try {
    // Exchange authorization code for token (Basic auth with client_id:client_secret)
    const clientId = process.env.NOTION_CLIENT_ID!;
    const clientSecret = process.env.NOTION_CLIENT_SECRET!;

    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri:
          "https://api.agents.theagentpost.co/oauth/notion/callback",
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("Notion token exchange failed:", body);
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Notion+token+exchange+failed`
      );
      return;
    }

    const data: any = await tokenRes.json();

    // Deliver tokens to the instance
    const deliverRes = await fetch(
      `http://localhost:${instance.port}/webhook/notion/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${instance.gatewayToken}`,
        },
        body: JSON.stringify({
          access_token: data.access_token,
          workspace_name: data.workspace_name,
          workspace_id: data.workspace_id,
          bot_id: data.bot_id,
        }),
      }
    );

    if (!deliverRes.ok) {
      console.error(
        "Notion token delivery to instance failed:",
        await deliverRes.text()
      );
      res.redirect(
        `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Failed+to+deliver+Notion+tokens`
      );
      return;
    }

    // Redirect user back to their dashboard
    console.log(`Notion connected for instance ${instance.id} (workspace: ${data.workspace_name})`);
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Notion+connected+successfully`
    );
  } catch (err) {
    console.error("Notion OAuth callback error:", err);
    res.redirect(
      `https://${instance.subdomain}.agents.theagentpost.co/integrations?flash=Notion+connection+failed`
    );
  }
});

export default router;

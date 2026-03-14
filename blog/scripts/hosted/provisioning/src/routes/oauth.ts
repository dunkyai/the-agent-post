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

export default router;

import { Router, raw } from "express";
import crypto from "crypto";
import * as store from "../services/store";

const router = Router();

// POST /slack/events — Slack Events API sends all events here
// Uses raw body parser for signature verification
router.post("/", raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body as Buffer;
  const timestamp = req.headers["x-slack-request-timestamp"] as string;
  const slackSignature = req.headers["x-slack-signature"] as string;

  // Verify Slack request signature
  if (!timestamp || !slackSignature || !process.env.SLACK_SIGNING_SECRET) {
    res.status(403).send("Missing signature");
    return;
  }

  // Reject requests older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    res.status(403).send("Request too old");
    return;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody.toString()}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
      .update(sigBasestring)
      .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(slackSignature)
    )
  ) {
    res.status(403).send("Invalid signature");
    return;
  }

  const body = JSON.parse(rawBody.toString());

  // Handle URL verification challenge (one-time during Slack app setup)
  if (body.type === "url_verification") {
    res.json({ challenge: body.challenge });
    return;
  }

  // Respond 200 immediately (Slack requires within 3 seconds)
  res.sendStatus(200);

  // Process event_callback asynchronously
  if (body.type === "event_callback") {
    const teamId = body.team_id;
    const event = body.event;

    if (!teamId || !event) return;

    const installation = store.getSlackInstallationByTeam(teamId);
    if (!installation) {
      console.warn(`Slack event for unknown team: ${teamId}`);
      return;
    }

    const instance = store.getInstance(installation.instanceId);
    if (!instance || instance.status !== "running") {
      console.warn(
        `Slack event for non-running instance: ${installation.instanceId}`
      );
      return;
    }

    // Filter out bot's own messages
    if (event.bot_id || event.user === installation.botUserId) {
      return;
    }

    // Forward to instance
    try {
      await fetch(
        `http://localhost:${instance.port}/webhook/slack/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${instance.gatewayToken}`,
          },
          body: JSON.stringify({
            event,
            event_id: body.event_id,
            team_id: teamId,
          }),
        }
      );
    } catch (err) {
      console.error(
        `Failed to forward Slack event to instance ${instance.id}:`,
        err
      );
    }
  }
});

export default router;

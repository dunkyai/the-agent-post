import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";

describe("Webhook auth", () => {
  beforeEach(() => freshDb());

  const webhookRoutes = [
    "/webhook/email",
    "/webhook/google/tokens",
    "/webhook/slack/tokens",
    "/webhook/slack/events",
    "/webhook/airtable/tokens",
    "/webhook/notion/tokens",
    "/webhook/twitter/tokens",
  ];

  for (const path of webhookRoutes) {
    it(`POST ${path} returns 401 without GATEWAY_TOKEN`, async () => {
      const app = getTestApp();
      const res = await app.post(path).send({});
      expect(res.status).toBe(401);
    });

    it(`POST ${path} returns 401 with wrong token`, async () => {
      const app = getTestApp();
      const res = await app
        .post(path)
        .set("Authorization", "Bearer wrong-token")
        .send({});
      expect(res.status).toBe(401);
    });
  }
});

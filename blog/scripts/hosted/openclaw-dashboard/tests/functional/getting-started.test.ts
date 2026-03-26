import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";
import { getSetting } from "../../src/services/db";

describe("Getting Started", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
  });

  it("GET /getting-started renders the page", async () => {
    const app = getTestApp();
    const res = await app.get("/getting-started").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Getting Started");
  });

  it("POST /getting-started saves identity fields", async () => {
    const app = getTestApp();
    const res = await app
      .post("/getting-started")
      .set("Cookie", cookie)
      .send({
        agent_name: "Archie",
        user_name: "Elizabeth",
        user_email: "elizabeth@example.com",
        linkedin_url: "https://linkedin.com/in/elizabeth",
        context_company: "A tech company",
        context_user: "CEO",
        context_rules: "",
        context_knowledge: "",
      });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("flash=Saved");

    expect(getSetting("agent_name")).toBe("Archie");
    expect(getSetting("user_name")).toBe("Elizabeth");
    expect(getSetting("user_email")).toBe("elizabeth@example.com");
    expect(getSetting("linkedin_url")).toBe("https://linkedin.com/in/elizabeth");
    expect(getSetting("context_company")).toBe("A tech company");
  });

  it("GET reflects previously saved values", async () => {
    const app = getTestApp();

    // Save first
    await app
      .post("/getting-started")
      .set("Cookie", cookie)
      .send({ agent_name: "TestBot", user_name: "Alice", user_email: "alice@test.com" });

    // Read back
    const res = await app.get("/getting-started").set("Cookie", cookie);
    expect(res.text).toContain("TestBot");
    expect(res.text).toContain("Alice");
    expect(res.text).toContain("alice@test.com");
  });
});

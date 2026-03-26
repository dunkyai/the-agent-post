import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";

describe("Sensitive file exposure", () => {
  beforeEach(() => freshDb());

  const sensitivePaths = [
    "/.env",
    "/.env.example",
    "/containers.env",
    "/.gitignore",
    "/package.json",
    "/tsconfig.json",
    "/src/index.ts",
    "/src/services/db.ts",
    "/src/services/encryption.ts",
    "/data/openclaw.db",
  ];

  for (const filePath of sensitivePaths) {
    it(`${filePath} is not accessible via HTTP`, async () => {
      const app = getTestApp();
      const res = await app.get(filePath);
      // Should either 302 (auth redirect) or 404 — never 200 with file contents
      expect(res.status).not.toBe(200);
    });
  }
});

import { describe, it, expect, beforeEach } from "vitest";
import { freshDb } from "../helpers/app";
import {
  getSetting, setSetting,
  createSessionToken, validateSession, deleteSession,
  upsertIntegration, getIntegration, deleteIntegration,
} from "../../src/services/db";

describe("Database service", () => {
  beforeEach(() => freshDb());

  describe("Settings", () => {
    it("returns undefined for missing setting", () => {
      expect(getSetting("nonexistent")).toBeUndefined();
    });

    it("set and get roundtrip", () => {
      setSetting("test_key", "test_value");
      expect(getSetting("test_key")).toBe("test_value");
    });

    it("overwrites existing setting", () => {
      setSetting("key", "old");
      setSetting("key", "new");
      expect(getSetting("key")).toBe("new");
    });
  });

  describe("Sessions", () => {
    it("creates a valid session token", () => {
      const token = createSessionToken();
      expect(token).toHaveLength(64); // 32 bytes hex
      expect(validateSession(token)).toBe(true);
    });

    it("rejects unknown token", () => {
      expect(validateSession("not-a-real-token")).toBe(false);
    });

    it("rejects empty token", () => {
      expect(validateSession("")).toBe(false);
    });

    it("deleteSession invalidates token", () => {
      const token = createSessionToken();
      expect(validateSession(token)).toBe(true);
      deleteSession(token);
      expect(validateSession(token)).toBe(false);
    });
  });

  describe("Integrations", () => {
    it("upsert and get roundtrip", () => {
      upsertIntegration("test-service", '{"key":"value"}', "connected");
      const row = getIntegration("test-service");
      expect(row).toBeDefined();
      expect(row!.status).toBe("connected");
      expect(row!.config).toBe('{"key":"value"}');
    });

    it("returns undefined for missing integration", () => {
      expect(getIntegration("nonexistent")).toBeUndefined();
    });

    it("delete removes integration", () => {
      upsertIntegration("to-delete", "{}", "connected");
      expect(getIntegration("to-delete")).toBeDefined();
      deleteIntegration("to-delete");
      expect(getIntegration("to-delete")).toBeUndefined();
    });

    it("upsert updates existing integration", () => {
      upsertIntegration("svc", '{"v":1}', "connected");
      upsertIntegration("svc", '{"v":2}', "disconnected");
      const row = getIntegration("svc");
      expect(row!.config).toBe('{"v":2}');
      expect(row!.status).toBe("disconnected");
    });
  });
});

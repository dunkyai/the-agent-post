import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const SALT = "openclaw-encryption-salt";
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

/**
 * Extract the instance_id from an OAuth state without decrypting.
 * Works for both encrypted (new: id.encrypted) and legacy (base64url JSON) formats.
 */
export function getInstanceIdFromState(state: string): string {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) {
    // Legacy format: base64url-encoded JSON
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    return parsed.instance_id;
  }
  return Buffer.from(state.slice(0, dotIdx), "base64url").toString();
}

/**
 * Decrypt an OAuth state payload using the instance's gateway token.
 * Supports both encrypted (new) and legacy (plaintext base64url) formats.
 */
export function decryptOAuthState(state: string, gatewayToken: string): Record<string, any> {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) {
    // Legacy format: base64url-encoded JSON (not encrypted)
    return JSON.parse(Buffer.from(state, "base64url").toString());
  }

  const instanceId = Buffer.from(state.slice(0, dotIdx), "base64url").toString();
  const encryptedRaw = Buffer.from(state.slice(dotIdx + 1), "base64url").toString();

  // Decrypt using the instance's gateway token
  const key = crypto.pbkdf2Sync(gatewayToken, SALT, ITERATIONS, KEY_LENGTH, "sha256");
  const parts = encryptedRaw.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted state format");

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return { instance_id: instanceId, ...JSON.parse(decrypted) };
}

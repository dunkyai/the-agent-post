import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = "openclaw-encryption-salt";
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

let derivedKey: Buffer | null = null;

function getKey(): Buffer {
  if (derivedKey) return derivedKey;

  const gatewayToken = process.env.GATEWAY_TOKEN;
  if (!gatewayToken) {
    throw new Error("GATEWAY_TOKEN not set — cannot derive encryption key");
  }

  derivedKey = crypto.pbkdf2Sync(gatewayToken, SALT, ITERATIONS, KEY_LENGTH, "sha256");
  return derivedKey;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * Encrypt an OAuth state payload. Returns a URL-safe string with the instance_id
 * in plaintext (so provisioning can look up the instance) and the rest encrypted.
 * Format: base64url(instance_id).base64url(encrypted_payload)
 */
export function encryptOAuthState(payload: Record<string, any>): string {
  const { instance_id, ...sensitive } = payload;
  const encryptedPart = encrypt(JSON.stringify(sensitive));
  return Buffer.from(instance_id).toString("base64url") + "." + Buffer.from(encryptedPart).toString("base64url");
}

/**
 * Decrypt an OAuth state payload given the gateway token for the instance.
 * The instance_id is extracted from the plaintext part, the rest is decrypted.
 */
export function decryptOAuthState(state: string, gatewayToken: string): Record<string, any> {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) {
    // Legacy format: base64url JSON (not encrypted)
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

/**
 * Extract the instance_id from an OAuth state without decrypting.
 * Works for both encrypted (new) and legacy (base64url JSON) formats.
 */
export function getInstanceIdFromState(state: string): string {
  const dotIdx = state.indexOf(".");
  if (dotIdx === -1) {
    // Legacy format
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    return parsed.instance_id;
  }
  return Buffer.from(state.slice(0, dotIdx), "base64url").toString();
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

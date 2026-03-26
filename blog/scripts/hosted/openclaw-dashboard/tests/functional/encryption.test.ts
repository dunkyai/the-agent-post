import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../src/services/encryption";

describe("Encryption", () => {
  it("roundtrip: encrypt then decrypt returns original", () => {
    const original = "my-secret-api-key-12345";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const plaintext = "same-input-different-output";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("encrypted format is iv:tag:ciphertext (3 hex parts)", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    // IV = 16 bytes = 32 hex chars
    expect(parts[0]).toHaveLength(32);
    // Auth tag = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext is hex
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it("detects tampered ciphertext", () => {
    const encrypted = encrypt("sensitive data");
    const parts = encrypted.split(":");
    // Flip a character in the ciphertext
    const tampered = parts[0] + ":" + parts[1] + ":" + "ff" + parts[2].slice(2);
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects invalid format", () => {
    expect(() => decrypt("not-valid-encrypted-data")).toThrow("Invalid encrypted data format");
  });
});

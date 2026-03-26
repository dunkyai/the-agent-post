import { createSessionToken } from "../../src/services/db";

export function getAuthCookie(): string {
  const token = createSessionToken();
  return `openclaw_session=${token}`;
}

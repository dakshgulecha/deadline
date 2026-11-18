// Files starting with "_" inside /api are helpers, not endpoints.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "deadline_session";
// Browsers cap cookie lifetime at 400 days. The cookie is re-issued on every
// visit, so in practice a device stays unlocked forever.
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function isConfigured() {
  return Boolean(process.env.APP_PASSPHRASE && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// The session token is derived from the passphrase and the server secret, so
// changing APP_PASSPHRASE signs out every device at once.
function expectedToken() {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(`deadline-session-v1:${process.env.APP_PASSPHRASE.trim()}`)
    .digest("base64url");
}

function safeEqual(a, b) {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export function passphraseMatches(input) {
  return typeof input === "string" && safeEqual(input.trim(), process.env.APP_PASSPHRASE.trim());
}

function readCookie(request, name) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return ""; }
    }
  }
  return "";
}

export function isUnlocked(request) {
  const token = readCookie(request, COOKIE_NAME);
  return Boolean(token) && safeEqual(token, expectedToken());
}

export function issueSession(response) {
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${expectedToken()}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return null;
}

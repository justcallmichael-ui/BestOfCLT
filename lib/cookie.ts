import { createHmac, timingSafeEqual } from "node:crypto";

// Cookie signing lives here, apart from lib/voter.ts, so proxy.ts can use it
// without pulling the database client into the proxy bundle.

export const COOKIE_NAME = "v";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DEV_COOKIE_SECRET = "dev-only-cookie-secret";
const DEV_IP_HASH_SALT = "dev-only-ip-hash-salt";

export function secret(name: "COOKIE_SECRET" | "IP_HASH_SALT"): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production`);
  }
  return name === "COOKIE_SECRET" ? DEV_COOKIE_SECRET : DEV_IP_HASH_SALT;
}

export function hmac(key: string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function signCookieValue(cookieId: string): string {
  return `${cookieId}.${hmac(secret("COOKIE_SECRET"), cookieId).toString("base64url")}`;
}

/** Returns the cookie id if the signature is valid, else null. Constant time comparison. */
export function verifyCookieValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const cookieId = value.slice(0, i);
  const sig = Buffer.from(value.slice(i + 1), "base64url");
  const expected = hmac(secret("COOKIE_SECRET"), cookieId);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(sig, expected) ? cookieId : null;
}

export function buildSetCookie(cookieId: string): string {
  const parts = [
    `${COOKIE_NAME}=${signCookieValue(cookieId)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

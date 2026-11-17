import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";

export const COOKIE_NAME = "v";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const DEV_COOKIE_SECRET = "dev-only-cookie-secret";
const DEV_IP_HASH_SALT = "dev-only-ip-hash-salt";

export type ResolvedVoter = { voterId: string; ipHash: string; setCookie?: string };

function secret(name: "COOKIE_SECRET" | "IP_HASH_SALT"): string {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set in production`);
  }
  return name === "COOKIE_SECRET" ? DEV_COOKIE_SECRET : DEV_IP_HASH_SALT;
}

function hmac(key: string, data: string): Buffer {
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

export function hashIp(ip: string): string {
  return hmac(secret("IP_HASH_SALT"), `ip:${ip}`).toString("hex");
}

function hashFingerprint(fp: string): string {
  return hmac(secret("IP_HASH_SALT"), `fp:${fp}`).toString("hex");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
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

export async function resolveVoter(req: Request): Promise<ResolvedVoter> {
  const db = getDb();
  const ipHash = hashIp(clientIp(req));
  const fpRaw = req.headers.get("x-fp")?.slice(0, 512).trim();
  const fpHash = fpRaw ? hashFingerprint(fpRaw) : null;

  const cookieId = verifyCookieValue(readCookie(req, COOKIE_NAME));
  if (cookieId) {
    // Upsert so a valid cookie always maps to a row, even after a data reset.
    const [row] = await db.query<{ id: string }>(
      `insert into voters (cookie_id, fingerprint_hash, ip_hash) values ($1, $2, $3)
       on conflict (cookie_id) do update
         set fingerprint_hash = coalesce(excluded.fingerprint_hash, voters.fingerprint_hash),
             ip_hash = excluded.ip_hash
       returning id`,
      [cookieId, fpHash, ipHash],
    );
    return { voterId: row.id, ipHash };
  }

  // A fingerprint is never used to identify a voter: phones of the same model share one,
  // so merging on it would silently drop real votes. It is stored only so rate limits and
  // the admin's flagged list can spot one device voting repeatedly without cookies.
  const newCookieId = randomUUID();
  const [row] = await db.query<{ id: string }>(
    `insert into voters (cookie_id, fingerprint_hash, ip_hash) values ($1, $2, $3) returning id`,
    [newCookieId, fpHash, ipHash],
  );
  return { voterId: row.id, ipHash, setCookie: buildSetCookie(newCookieId) };
}

export function jsonWithVoter(body: unknown, init: ResponseInit | undefined, voter: { setCookie?: string }): Response {
  const headers = new Headers(init?.headers);
  if (voter.setCookie) headers.append("Set-Cookie", voter.setCookie);
  return Response.json(body, { ...init, headers });
}

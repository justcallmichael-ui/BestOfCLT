import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, buildSetCookie, hmac, secret, signCookieValue, verifyCookieValue } from "@/lib/cookie";

export { COOKIE_NAME, buildSetCookie, signCookieValue, verifyCookieValue };

export type ResolvedVoter = { voterId: string; ipHash: string; setCookie?: string };

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

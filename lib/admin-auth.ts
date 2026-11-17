import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const ADMIN_COOKIE = "adm";
export const ADMIN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Error with an HTTP status, thrown by admin services and mapped by routes. */
export class AdminError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AdminError";
    this.status = status;
  }
}

const isProd = () => process.env.NODE_ENV === "production";

function cookieSecret(): string | null {
  const s = process.env.COOKIE_SECRET;
  if (s) return s;
  return isProd() ? null : "dev-only-cookie-secret";
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`adm.${payload}`).digest("base64url");
}

/** Cookie value is `expiresAtMs.signature`. Returns null when no secret is configured. */
export function signAdminCookie(now: Date = new Date()): string | null {
  const secret = cookieSecret();
  if (!secret) return null;
  const payload = String(now.getTime() + ADMIN_TTL_SECONDS * 1000);
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminCookie(value: string | undefined | null, now: Date = new Date()): boolean {
  if (!value) return false;
  const secret = cookieSecret();
  if (!secret) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d{1,16}$/.test(payload)) return false;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(payload) > now.getTime();
}

export function adminSetCookieHeader(value: string): string {
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_TTL_SECONDS}${isProd() ? "; Secure" : ""}`;
}

export function adminClearCookieHeader(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isProd() ? "; Secure" : ""}`;
}

/** Constant time password check. Missing ADMIN_PASSWORD means login always fails. */
export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Returns null when the request carries a valid admin cookie, otherwise a 401 Response. */
export function requireAdmin(req: Request): Response | null {
  if (verifyAdminCookie(readCookie(req.headers.get("cookie"), ADMIN_COOKIE))) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

export function isJsonRequest(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export function clientIpHash(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  return createHmac("sha256", process.env.IP_HASH_SALT ?? "dev-salt").update(ip).digest("hex");
}

// In memory brute force limiter: at most 10 failures per ip hash per 15 minutes.
const failures = new Map<string, { count: number; start: number }>();

export function loginBlocked(ipHash: string, now: Date = new Date()): boolean {
  const e = failures.get(ipHash);
  if (!e) return false;
  if (now.getTime() - e.start >= LOGIN_WINDOW_MS) {
    failures.delete(ipHash);
    return false;
  }
  return e.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(ipHash: string, now: Date = new Date()): void {
  const e = failures.get(ipHash);
  if (!e || now.getTime() - e.start >= LOGIN_WINDOW_MS) {
    failures.set(ipHash, { count: 1, start: now.getTime() });
  } else {
    e.count += 1;
  }
}

export function resetLoginLimiter(): void {
  failures.clear();
}

/** Wraps a mutating admin route: admin check, POST JSON only, zod parse, error mapping. */
export function adminPost<S extends z.ZodType>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<unknown>,
) {
  return async function POST(req: Request): Promise<Response> {
    const denied = requireAdmin(req);
    if (denied) return denied;
    if (!isJsonRequest(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return Response.json({ error: `${where}${issue?.message ?? "Invalid input"}` }, { status: 400 });
    }
    try {
      const out = await handler(parsed.data);
      return Response.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status });
      console.error("admin route error", e);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

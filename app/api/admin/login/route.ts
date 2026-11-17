import { z } from "zod";
import {
  adminSetCookieHeader,
  checkPassword,
  clientIpHash,
  isJsonRequest,
  loginBlocked,
  recordLoginFailure,
  signAdminCookie,
} from "@/lib/admin-auth";

const schema = z.object({ password: z.string().min(1).max(500) });

export async function POST(req: Request): Promise<Response> {
  if (!isJsonRequest(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const ip = clientIpHash(req);
  if (loginBlocked(ip)) return Response.json({ error: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Password is required" }, { status: 400 });
  const cookie = checkPassword(parsed.data.password) ? signAdminCookie() : null;
  if (!cookie) {
    recordLoginFailure(ip);
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": adminSetCookieHeader(cookie) } });
}

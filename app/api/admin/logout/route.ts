import { adminClearCookieHeader, isJsonRequest } from "@/lib/admin-auth";

export async function POST(req: Request): Promise<Response> {
  if (!isJsonRequest(req)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": adminClearCookieHeader() } });
}

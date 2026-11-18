import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, buildSetCookie, signCookieValue, verifyCookieValue } from "@/lib/cookie";

/**
 * Gives every new visitor their voter cookie on the very first page request.
 * Without this, a brand new browser fires several API calls at once, each with no cookie,
 * and each mints its own voter id. The browser keeps only the last one, so the first
 * upvote could be filed under an id the visitor never uses again.
 *
 * The cookie is also injected into this request so anything rendered now sees it.
 */
export function proxy(request: NextRequest) {
  if (verifyCookieValue(request.cookies.get(COOKIE_NAME)?.value)) return NextResponse.next();

  const cookieId = randomUUID();
  const kept = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${COOKIE_NAME}=`));
  kept.push(`${COOKIE_NAME}=${signCookieValue(cookieId)}`);

  const headers = new Headers(request.headers);
  headers.set("cookie", kept.join("; "));
  const res = NextResponse.next({ request: { headers } });
  res.headers.append("Set-Cookie", buildSetCookie(cookieId));
  return res;
}

export const config = {
  // Pages only. API routes, static files, images, and the admin area are left alone.
  matcher: ["/((?!api|admin|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

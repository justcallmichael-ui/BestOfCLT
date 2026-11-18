import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { COOKIE_NAME, signCookieValue, verifyCookieValue } from "../lib/cookie";

function req(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/t/practice/nominate", cookie ? { headers: { cookie } } : undefined);
}

describe("proxy voter cookie", () => {
  it("sets a valid signed cookie for a first visit and passes it on to the request", () => {
    const res = proxy(req());
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    const value = setCookie.split(";")[0].slice(COOKIE_NAME.length + 1);
    expect(verifyCookieValue(value)).toBeTruthy();
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain(`${COOKIE_NAME}=${value}`);
  });

  it("leaves a returning visitor with a valid cookie alone", () => {
    const res = proxy(req(`${COOKIE_NAME}=${signCookieValue("11111111-1111-4111-8111-111111111111")}`));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("replaces a forged cookie and keeps other cookies", () => {
    const res = proxy(req(`other=1; ${COOKIE_NAME}=forged.value`));
    expect(res.headers.get("set-cookie")).toContain(`${COOKIE_NAME}=`);
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("other=1");
    expect(forwarded).not.toContain("forged.value");
  });
});

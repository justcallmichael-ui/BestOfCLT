import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db";
import { createTestDb } from "./helpers/db";
import { getLogo, isInstagramImageUrl, parseOgImage } from "@/lib/services/logos";

let db: Db;

async function mkEntrant(handle: string, status = "approved"): Promise<void> {
  const [t] = await db.query<{ id: string }>(
    "insert into tournaments (slug, name, category, status) values ($1, 'T', 'pizza', 'nominations') on conflict (slug) do update set name = 'T' returning id",
    ["logos"],
  );
  await db.query("insert into entrants (tournament_id, ig_handle, display_name, status) values ($1, $2, $2, $3)", [t.id, handle, status]);
}

const PIC = "https://scontent-xyz.cdninstagram.com/v/pic.jpg?x=1&y=2";
const PNG_BYTES = Buffer.from([1, 2, 3, 4, 5]);

function stubInstagram(opts: { profile?: boolean; image?: boolean }) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("web_profile_info")) {
      return opts.profile
        ? new Response(JSON.stringify({ data: { user: { profile_pic_url_hd: PIC } } }), { status: 200 })
        : new Response("blocked", { status: 429 });
    }
    if (url.startsWith("https://www.instagram.com/")) return new Response("<html></html>", { status: 200 });
    if (url === PIC) {
      return opts.image
        ? new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } })
        : new Response("nope", { status: 403 });
    }
    return new Response("?", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logo helpers", () => {
  it("reads the share image from a profile page", () => {
    expect(parseOgImage('<meta property="og:image" content="https://a.cdninstagram.com/p.jpg?a=1&amp;b=2" />')).toBe(
      "https://a.cdninstagram.com/p.jpg?a=1&b=2",
    );
    expect(parseOgImage("<html></html>")).toBeNull();
  });
  it("only trusts Instagram image servers over https", () => {
    expect(isInstagramImageUrl(PIC)).toBe(true);
    expect(isInstagramImageUrl("https://evil.example.com/a.jpg")).toBe(false);
    expect(isInstagramImageUrl("http://x.cdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramImageUrl("https://cdninstagram.com.evil.com/a.jpg")).toBe(false);
  });
});

describe("getLogo", () => {
  it("fetches once, keeps its own copy, and does not ask Instagram again", async () => {
    await mkEntrant("pie_zaa");
    const fn = stubInstagram({ profile: true, image: true });
    const first = await getLogo("pie_zaa");
    expect(first?.contentType).toBe("image/jpeg");
    expect(Buffer.compare(first!.bytes, PNG_BYTES)).toBe(0);
    const calls = fn.mock.calls.length;
    const second = await getLogo("pie_zaa");
    expect(Buffer.compare(second!.bytes, PNG_BYTES)).toBe(0);
    expect(fn.mock.calls.length).toBe(calls);
  });

  it("never fetches handles that are not on the list", async () => {
    const fn = stubInstagram({ profile: true, image: true });
    expect(await getLogo("random_account")).toBeNull();
    await mkEntrant("gone", "rejected");
    expect(await getLogo("gone")).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("remembers a failure, waits before retrying, then tries again", async () => {
    await mkEntrant("blocked_spot");
    const t0 = new Date("2026-11-19T10:00:00Z");
    const fn = stubInstagram({ profile: false, image: false });
    expect(await getLogo("blocked_spot", t0)).toBeNull();
    const calls = fn.mock.calls.length;
    expect(await getLogo("blocked_spot", new Date(t0.getTime() + 60 * 60 * 1000))).toBeNull();
    expect(fn.mock.calls.length).toBe(calls);

    stubInstagram({ profile: true, image: true });
    const later = await getLogo("blocked_spot", new Date(t0.getTime() + 7 * 60 * 60 * 1000));
    expect(later?.contentType).toBe("image/jpeg");
  });

  it("rejects pictures that are not images or are too large", async () => {
    await mkEntrant("big");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("web_profile_info")) return new Response(JSON.stringify({ data: { user: { profile_pic_url: PIC } } }));
        return new Response(Buffer.alloc(500_000), { status: 200, headers: { "content-type": "image/jpeg" } });
      }),
    );
    expect(await getLogo("big")).toBeNull();
  });
});

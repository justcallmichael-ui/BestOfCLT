import { getDb } from "@/lib/db";

/**
 * Place logos, taken from each place's public Instagram profile picture.
 *
 * The first time a logo is asked for, the server fetches the picture once and keeps its own
 * copy in the database, so it never expires and never depends on Instagram again. Instagram
 * blocks some automated requests, so a failure is remembered and retried later. Until a logo
 * exists, the pages show a letter circle.
 *
 * The table is created on first use so no separate migration step is needed.
 */

export type Logo = { contentType: string; bytes: Buffer };

const MAX_BYTES = 400_000;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const IG_APP_ID = "936619743392459";

let readyFor: unknown = null;

async function ensureTable(): Promise<void> {
  const db = getDb();
  if (readyFor === db) return;
  await db.query(
    `create table if not exists entrant_logos (
       ig_handle text primary key,
       content_type text,
       data_base64 text,
       fetched_at timestamptz not null default now()
     )`,
  );
  await db.query(`alter table entrant_logos enable row level security`);
  readyFor = db;
}

/** Image links must be https and come from Instagram's own image servers. */
export function isInstagramImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#38;/g, "&").replace(/&quot;/g, '"');
}

/** Pulls the profile picture link out of a profile page's share tags. */
export function parseOgImage(html: string): string | null {
  const a = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const b = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const url = a?.[1] ?? b?.[1];
  return url ? decodeEntities(url) : null;
}

async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function findPictureUrl(handle: string): Promise<string | null> {
  const enc = encodeURIComponent(handle);
  // 1. Instagram's own profile data call.
  try {
    const r = await timedFetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${enc}`, {
      "user-agent": BROWSER_UA,
      "x-ig-app-id": IG_APP_ID,
      accept: "*/*",
    });
    if (r.ok) {
      const j = (await r.json()) as { data?: { user?: { profile_pic_url_hd?: string; profile_pic_url?: string } } };
      const u = j.data?.user?.profile_pic_url_hd ?? j.data?.user?.profile_pic_url;
      if (u && isInstagramImageUrl(u)) return u;
    }
  } catch {
    /* try the next way */
  }
  // 2. The share preview image on the public profile page.
  try {
    const r = await timedFetch(`https://www.instagram.com/${enc}/`, { "user-agent": BOT_UA, accept: "text/html" });
    if (r.ok) {
      const u = parseOgImage(await r.text());
      if (u && isInstagramImageUrl(u)) return u;
    }
  } catch {
    /* give up */
  }
  return null;
}

export async function fetchLogoFromInstagram(handle: string): Promise<Logo | null> {
  const url = await findPictureUrl(handle);
  if (!url) return null;
  try {
    const r = await timedFetch(url, { "user-agent": BROWSER_UA, accept: "image/*" });
    if (!r.ok) return null;
    const contentType = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return { contentType, bytes };
  } catch {
    return null;
  }
}

type Row = { content_type: string | null; data_base64: string | null; fetched_at: string | Date };

/**
 * Returns the stored logo, fetching it first if this place has none yet.
 * Only handles that belong to a real entrant are fetched, so this cannot be used to
 * pull arbitrary Instagram accounts through the site.
 */
export async function getLogo(handle: string, now: Date = new Date()): Promise<Logo | null> {
  await ensureTable();
  const db = getDb();
  const [row] = await db.query<Row>(
    `select content_type, data_base64, fetched_at from entrant_logos where ig_handle = $1`,
    [handle],
  );
  if (row?.data_base64 && row.content_type) {
    return { contentType: row.content_type, bytes: Buffer.from(row.data_base64, "base64") };
  }
  if (row && now.getTime() - new Date(row.fetched_at).getTime() < RETRY_AFTER_MS) return null;

  const [known] = await db.query<{ n: number }>(
    `select count(*)::int as n from entrants where ig_handle = $1 and status in ('pending','approved')`,
    [handle],
  );
  if (!known || known.n === 0) return null;

  const logo = await fetchLogoFromInstagram(handle);
  await db.query(
    `insert into entrant_logos (ig_handle, content_type, data_base64, fetched_at) values ($1, $2, $3, $4)
     on conflict (ig_handle) do update
       set content_type = excluded.content_type, data_base64 = excluded.data_base64, fetched_at = excluded.fetched_at`,
    [handle, logo?.contentType ?? null, logo ? logo.bytes.toString("base64") : null, now.toISOString()],
  );
  return logo;
}

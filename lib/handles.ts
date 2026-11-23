const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeHandle(input: string): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;

  if (/^(https?:\/\/)?([a-z0-9-]+\.)?instagram\.com(\/|$|\?|#)/i.test(s)) {
    s = s.replace(/^(https?:\/\/)?([a-z0-9-]+\.)?instagram\.com\/?/i, "");
    s = s.split(/[?#]/)[0];
    s = s.split("/").filter(Boolean)[0] ?? "";
  }

  s = s.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_RE.test(s) ? s : null;
}

/** Places with no Instagram get a handle that starts with this. Real handles can never contain a hyphen. */
export const NO_IG_PREFIX = "noig-";

export function isNoIg(handle: string): boolean {
  return handle.startsWith(NO_IG_PREFIX);
}

/** A stable handle made from a place name, for places with no Instagram. Null when the name has no letters or digits. */
export function noIgHandle(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return slug ? NO_IG_PREFIX + slug : null;
}

/** "@handle" for a place with Instagram, an empty string for one without. */
export function atHandle(handle: string): string {
  return isNoIg(handle) ? "" : `@${handle}`;
}

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

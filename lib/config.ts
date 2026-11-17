const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Best of CLT";
const presentedBy = process.env.NEXT_PUBLIC_PRESENTED_BY ?? "CLTBeat";
const igHandle = process.env.NEXT_PUBLIC_IG_HANDLE ?? "cltbeat";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const brand = {
  name,
  presentedBy,
  igHandle,
  siteUrl,
  igUrl: `https://www.instagram.com/${igHandle}/`,
};

/**
 * Colors used by the generated share graphics. Mirrors app/globals.css today
 * (ink, panel, chalk, muted, accent, accent-ink). Change the brand colors here only.
 */
export const palette = {
  background: "#0a0a0c",
  panel: "#15151a",
  text: "#f6f3ec",
  muted: "#aeaeba",
  accent: "#ff5a1f",
  accentText: "#130904",
};

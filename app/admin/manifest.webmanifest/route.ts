import { brand, palette } from "@/lib/config";

/** Web app manifest so the admin area can be added to a phone home screen. Contains nothing private. */
export function GET() {
  const manifest = {
    name: `${brand.name} Admin`,
    short_name: "Admin",
    description: `Run the ${brand.name} tournament and prepare the daily posts.`,
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    background_color: palette.background,
    theme_color: palette.background,
    icons: [
      { src: "/api/og/admin-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/og/admin-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/og/admin-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}

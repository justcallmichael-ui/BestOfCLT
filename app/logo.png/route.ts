import { LOGO_PNG_BASE64 } from "@/lib/brand-logo";

const bytes = Buffer.from(LOGO_PNG_BASE64, "base64");

export function GET() {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, s-maxage=86400" },
  });
}

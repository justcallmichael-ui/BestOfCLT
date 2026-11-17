import { AdminIconArt } from "@/lib/share/art";
import { badRequest, png } from "@/lib/share/og";

const ALLOWED = [180, 192, 512];

/** GET /api/og/admin-icon?size=180|192|512  ->  square app icon PNG. */
export async function GET(req: Request) {
  const size = Number(new URL(req.url).searchParams.get("size") ?? "512");
  if (!ALLOWED.includes(size)) return badRequest("size must be 180, 192 or 512");
  return png(<AdminIconArt size={size} />, size, size);
}

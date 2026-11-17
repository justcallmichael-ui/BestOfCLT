import { EntrantArt, SIZES } from "@/lib/share/art";
import { badRequest, isUuid, notFoundJson, png } from "@/lib/share/og";
import { getEntrantShareById } from "@/lib/share/posts";

/** GET /api/og/entrant?id=<entrant uuid>&size=story|og  ->  1080x1920 (default) or 1200x630 PNG. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  const size = q.get("size") ?? "story";
  if (!isUuid(id)) return badRequest("id must be an entrant uuid");
  if (size !== "story" && size !== "og") return badRequest("size must be story or og");
  const v = await getEntrantShareById(id);
  if (!v) return notFoundJson("Entrant not found");
  const dim = SIZES[size];
  return png(<EntrantArt v={v} format={size} />, dim.width, dim.height);
}

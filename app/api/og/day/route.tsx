import { DayArt, SIZES } from "@/lib/share/art";
import { badRequest, isUuid, notFoundJson, parseIsoParam, png } from "@/lib/share/og";
import { getDayShare } from "@/lib/share/posts";

/** GET /api/og/day?t=<tournament uuid>&day=<opens_at ISO>  ->  1080x1920 story PNG. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t = q.get("t");
  const day = parseIsoParam(q.get("day"));
  if (!isUuid(t)) return badRequest("t must be a tournament uuid");
  if (!day) return badRequest("day must be an ISO date time (the game day's opens_at)");
  const found = await getDayShare(t, day);
  if (!found) return notFoundJson("No matchups on that game day");
  return png(<DayArt day={found.day} />, SIZES.story.width, SIZES.story.height);
}

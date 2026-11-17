import { MatchupArt, SIZES } from "@/lib/share/art";
import { badRequest, isUuid, notFoundJson, png } from "@/lib/share/og";
import { getMatchupShare } from "@/lib/share/posts";

/** GET /api/og/matchup?id=<matchup uuid>  ->  1080x1920 story PNG. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return badRequest("id must be a matchup uuid");
  const found = await getMatchupShare(id);
  if (!found) return notFoundJson("Matchup not found");
  return png(<MatchupArt m={found.matchup} format="story" />, SIZES.story.width, SIZES.story.height);
}

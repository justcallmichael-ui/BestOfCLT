import { jsonWithVoter, resolveVoter } from "@/lib/voter";
import { nextMatchup } from "@/lib/services/voting";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const voter = await resolveVoter(req);
  const r = await nextMatchup(slug, voter.voterId);
  if (r.kind === "not_found") return jsonWithVoter({ error: "not_found" }, { status: 404 }, voter);
  return jsonWithVoter({ matchup: r.matchup, remaining: r.remaining, nextOpensAt: r.nextOpensAt }, undefined, voter);
}

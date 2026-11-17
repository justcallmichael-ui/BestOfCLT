import { jsonWithVoter, resolveVoter } from "@/lib/voter";
import { listEntrants } from "@/lib/services/nominations";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const voter = await resolveVoter(req);
  const r = await listEntrants(slug, voter.voterId);
  if (r.kind === "not_found") return jsonWithVoter({ error: "not_found" }, { status: 404 }, voter);
  return jsonWithVoter({ entrants: r.entrants }, undefined, voter);
}

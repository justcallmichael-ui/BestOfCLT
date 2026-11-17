import { NextResponse } from "next/server";
import { advanceDueRounds, getTournamentState, nextTransitionAt, scoresCacheControl } from "@/lib/services/bracket";

export const dynamic = "force-dynamic";

// CDN cacheable: never reads or sets cookies.
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const now = new Date();
  try {
    await advanceDueRounds(now);
  } catch (e) {
    console.error("advanceDueRounds failed", e);
  }
  const state = await getTournamentState(slug, now);
  if (!state) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  const next = await nextTransitionAt(slug, now);
  return NextResponse.json(
    { ...state, scoresAsOf: now.toISOString() },
    { headers: { "Cache-Control": scoresCacheControl(next, now) } },
  );
}

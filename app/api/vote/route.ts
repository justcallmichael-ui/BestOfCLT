import { z } from "zod";
import { jsonWithVoter, resolveVoter } from "@/lib/voter";
import { castVoteWithNext } from "@/lib/services/voting";

const body = z.object({ matchupId: z.string().uuid(), choice: z.enum(["a", "b"]) });

export async function POST(req: Request) {
  const voter = await resolveVoter(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonWithVoter({ error: "bad_request" }, { status: 400 }, voter);

  const r = await castVoteWithNext({ ...parsed.data, voterId: voter.voterId, ipHash: voter.ipHash });
  switch (r.kind) {
    case "ok":
    case "already":
      return jsonWithVoter(
        { ok: true, already: r.kind === "already", votesA: r.votesA, votesB: r.votesB, next: r.next },
        undefined,
        voter,
      );
    case "closed":
      return jsonWithVoter({ error: "closed" }, { status: 409 }, voter);
    case "rate_limited":
      return jsonWithVoter({ error: "rate_limited" }, { status: 429 }, voter);
    case "not_found":
      return jsonWithVoter({ error: "not_found" }, { status: 404 }, voter);
  }
}

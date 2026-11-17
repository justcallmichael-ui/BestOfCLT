import { z } from "zod";
import { jsonWithVoter, resolveVoter } from "@/lib/voter";
import { upvote } from "@/lib/services/nominations";

const body = z.object({ entrantId: z.string().uuid() });

export async function POST(req: Request) {
  const voter = await resolveVoter(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonWithVoter({ error: "bad_request" }, { status: 400 }, voter);

  const r = await upvote({ entrantId: parsed.data.entrantId, voterId: voter.voterId, ipHash: voter.ipHash });
  switch (r.kind) {
    case "ok":
    case "already":
      return jsonWithVoter({ ok: true, already: r.kind === "already", upvoteCount: r.upvoteCount }, undefined, voter);
    case "closed":
      return jsonWithVoter({ error: "closed" }, { status: 409 }, voter);
    case "rate_limited":
      return jsonWithVoter({ error: "rate_limited" }, { status: 429 }, voter);
    case "not_found":
      return jsonWithVoter({ error: "not_found" }, { status: 404 }, voter);
  }
}

import { z } from "zod";
import { jsonWithVoter, resolveVoter } from "@/lib/voter";
import { nominate } from "@/lib/services/nominations";

const body = z.object({
  slug: z.string().min(1).max(100),
  handle: z.string().max(200).default(""),
  displayName: z.string().max(200).optional(),
  noInstagram: z.boolean().optional(),
});

export async function POST(req: Request) {
  const voter = await resolveVoter(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonWithVoter({ error: "bad_request" }, { status: 400 }, voter);

  const r = await nominate({ ...parsed.data, voterId: voter.voterId, ipHash: voter.ipHash });
  switch (r.kind) {
    case "created_pending":
    case "upvoted":
    case "already_upvoted":
      return jsonWithVoter({ result: r.kind, entrantId: r.entrantId }, undefined, voter);
    case "no_votes_left":
      return jsonWithVoter({ result: "no_votes_left" }, undefined, voter);
    case "rejected":
      return jsonWithVoter({ result: "rejected" }, undefined, voter);
    case "invalid_handle":
      return jsonWithVoter({ error: "invalid_handle", result: "invalid_handle" }, { status: 400 }, voter);
    case "closed":
      return jsonWithVoter({ error: "closed", result: "closed" }, { status: 409 }, voter);
    case "rate_limited":
      return jsonWithVoter({ error: "rate_limited" }, { status: 429 }, voter);
    case "not_found":
      return jsonWithVoter({ error: "not_found" }, { status: 404 }, voter);
  }
}

import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { setVoteGroupExcluded } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({
    matchupId: z.uuid(),
    ipHash: z.string().min(1).max(128),
    hour: z.iso.datetime({ offset: true }),
    excluded: z.boolean(),
  }),
  (b) => setVoteGroupExcluded({ matchupId: b.matchupId, ipHash: b.ipHash, hour: new Date(b.hour), excluded: b.excluded }),
);

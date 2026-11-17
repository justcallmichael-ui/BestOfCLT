import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { moveGameDay } from "@/lib/services/admin";

const when = z.iso.datetime({ offset: true });

export const POST = adminPost(
  z.object({ tournamentId: z.uuid(), groupOpensAt: when, opensAt: when, closesAt: when }),
  (b) =>
    moveGameDay({
      tournamentId: b.tournamentId,
      groupOpensAt: new Date(b.groupOpensAt),
      opensAt: new Date(b.opensAt),
      closesAt: new Date(b.closesAt),
    }),
);

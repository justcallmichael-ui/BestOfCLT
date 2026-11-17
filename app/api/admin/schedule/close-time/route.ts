import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { changeGameDayClose } from "@/lib/services/admin";

const when = z.iso.datetime({ offset: true });

export const POST = adminPost(
  z.object({ tournamentId: z.uuid(), groupOpensAt: when, closesAt: when }),
  (b) =>
    changeGameDayClose({
      tournamentId: b.tournamentId,
      groupOpensAt: new Date(b.groupOpensAt),
      closesAt: new Date(b.closesAt),
    }),
);

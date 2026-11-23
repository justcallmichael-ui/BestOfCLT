import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { delaySchedule } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ tournamentId: z.uuid(), hours: z.number().int() }),
  ({ tournamentId, hours }) => delaySchedule(tournamentId, hours),
);

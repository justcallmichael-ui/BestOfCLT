import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { overrideWinner } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ matchupId: z.uuid(), winnerId: z.uuid() }),
  ({ matchupId, winnerId }) => overrideWinner(matchupId, winnerId),
);

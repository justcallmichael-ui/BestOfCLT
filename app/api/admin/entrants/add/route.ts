import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { addEntrant } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ tournamentId: z.uuid(), handle: z.string().min(1).max(200), displayName: z.string().max(200).optional() }),
  (b) => addEntrant(b.tournamentId, b.handle, b.displayName ?? ""),
);

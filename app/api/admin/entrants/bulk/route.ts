import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { bulkAddEntrants } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ tournamentId: z.uuid(), text: z.string().min(1).max(50_000) }),
  (b) => bulkAddEntrants(b.tournamentId, b.text),
);

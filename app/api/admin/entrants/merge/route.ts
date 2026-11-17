import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { mergeEntrants } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ intoId: z.uuid(), fromId: z.uuid() }),
  ({ intoId, fromId }) => mergeEntrants(intoId, fromId),
);

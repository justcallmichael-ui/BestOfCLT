import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { startBracket } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ id: z.uuid(), startAt: z.iso.datetime({ offset: true }).optional() }),
  ({ id, startAt }) => startBracket(id, new Date(), startAt ? new Date(startAt) : undefined),
);

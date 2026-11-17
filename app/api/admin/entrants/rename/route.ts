import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { renameEntrant } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({ id: z.uuid(), displayName: z.string().min(1).max(200) }),
  ({ id, displayName }) => renameEntrant(id, displayName),
);

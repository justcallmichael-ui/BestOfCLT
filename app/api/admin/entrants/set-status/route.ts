import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { approveEntrant, rejectEntrant, restoreEntrant, withdrawEntrant } from "@/lib/services/admin";

const actions = { approve: approveEntrant, reject: rejectEntrant, withdraw: withdrawEntrant, restore: restoreEntrant };

export const POST = adminPost(
  z.object({ id: z.uuid(), action: z.enum(["approve", "reject", "withdraw", "restore"]) }),
  ({ id, action }) => actions[action](id),
);

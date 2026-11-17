import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { createTournament } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({
    name: z.string().min(1).max(120),
    slug: z.string().min(1).max(60),
    category: z.string().min(1).max(60),
    fieldSize: z.union([z.literal(16), z.literal(32), z.literal(64)]),
    // Unused by the staggered schedule; kept so the column stays valid.
    roundDays: z.number().int().min(1).max(30).default(3),
    nominationsCloseAt: z.iso.datetime({ offset: true }).nullish(),
  }),
  async (b) =>
    createTournament({ ...b, nominationsCloseAt: b.nominationsCloseAt ? new Date(b.nominationsCloseAt) : null }),
);

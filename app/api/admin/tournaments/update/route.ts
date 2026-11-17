import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { updateTournament } from "@/lib/services/admin";

export const POST = adminPost(
  z.object({
    id: z.uuid(),
    name: z.string().max(120).optional(),
    category: z.string().max(60).optional(),
    fieldSize: z.number().int().optional(),
    roundDays: z.number().int().optional(),
    nominationsCloseAt: z.iso.datetime({ offset: true }).nullable().optional(),
  }),
  async ({ nominationsCloseAt, ...rest }) =>
    updateTournament({
      ...rest,
      nominationsCloseAt: nominationsCloseAt === undefined ? undefined : nominationsCloseAt === null ? null : new Date(nominationsCloseAt),
    }),
);

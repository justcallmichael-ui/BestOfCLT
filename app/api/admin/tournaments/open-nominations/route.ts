import { z } from "zod";
import { adminPost } from "@/lib/admin-auth";
import { openNominations } from "@/lib/services/admin";

export const POST = adminPost(z.object({ id: z.uuid() }), ({ id }) => openNominations(id));

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { advanceDueRounds } from "@/lib/services/bracket";

export const dynamic = "force-dynamic";

function sha(s: string) {
  return createHash("sha256").update(s).digest();
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return timingSafeEqual(sha(header), sha(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const advanced = await advanceDueRounds(new Date());
  return NextResponse.json({ advanced });
}

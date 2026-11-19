import { normalizeHandle } from "@/lib/handles";
import { getLogo } from "@/lib/services/logos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await ctx.params;
  const handle = normalizeHandle(decodeURIComponent(raw));
  if (!handle) return new Response(null, { status: 404 });
  try {
    const logo = await getLogo(handle);
    if (!logo) {
      return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=300" } });
    }
    return new Response(new Uint8Array(logo.bytes), {
      headers: {
        "content-type": logo.contentType,
        "cache-control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { normalizeHandle } from "@/lib/handles";
import EntrantPage, { generateMetadata as entrantMetadata } from "@/app/t/[slug]/p/[handle]/page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

/** The tournament this handle is in. Live tournaments win over finished ones, newest first. */
async function slugFor(rawHandle: string): Promise<{ slug: string; handle: string } | null> {
  const handle = normalizeHandle(decodeURIComponent(rawHandle));
  if (!handle) return null;
  const [r] = await getDb().query<{ slug: string }>(
    `select t.slug from tournaments t join entrants e on e.tournament_id = t.id
     where e.ig_handle = $1 and e.status = 'approved'
     order by case when t.status in ('nominations', 'bracket') then 0 else 1 end, t.created_at desc
     limit 1`,
    [handle],
  );
  return r ? { slug: r.slug, handle } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await slugFor((await params).handle);
  if (!found) return { title: "Not found" };
  return entrantMetadata({ params: Promise.resolve(found) });
}

/** Short link for a place, for stories and bio: bestofclt.com/p/handle. Same page, no redirect. */
export default async function ShortEntrantPage({ params }: Props) {
  const found = await slugFor((await params).handle);
  if (!found) notFound();
  return EntrantPage({ params: Promise.resolve(found) });
}

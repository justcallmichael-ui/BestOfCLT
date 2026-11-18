import Link from "next/link";
import { notFound } from "next/navigation";
import { AddEntrants } from "@/components/admin/AddEntrants";
import { AdminNav } from "@/components/admin/AdminNav";
import { EntrantTools } from "@/components/admin/EntrantTools";
import { assertUuid, requireAdminPage } from "@/components/admin/guard";
import { AdminError } from "@/lib/admin-auth";
import { getTournament, listEntrants, type EntrantStatus } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const STATUSES: EntrantStatus[] = ["pending", "approved", "rejected", "withdrawn"];

export default async function EntrantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminPage();
  const id = assertUuid((await params).id);
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const t = await getTournament(id).catch((e) => (e instanceof AdminError ? null : Promise.reject(e)));
  if (!t) notFound();
  const entrants = await listEntrants(id, status);
  const mergeable = entrants.filter((e) => e.status !== "rejected" && e.status !== "withdrawn");
  const chip = (active: boolean) => `rounded-full px-3 py-2 text-sm font-medium ${active ? "bg-neutral-900 text-white" : "bg-neutral-200"}`;
  return (
    <>
      <AdminNav tournamentId={id} />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-bold">{t.name}: entrants</h1>
        <AddEntrants tournamentId={id} />
        <div className="flex flex-wrap gap-2">
          <Link className={chip(!status)} href={`/admin/t/${id}/entrants`}>All</Link>
          {STATUSES.map((s) => (
            <Link key={s} className={chip(status === s)} href={`/admin/t/${id}/entrants?status=${s}`}>{s}</Link>
          ))}
        </div>
        <p className="text-sm text-neutral-600">{entrants.length} shown</p>
        {entrants.map((e) => (
          <section key={e.id} className="rounded-xl border border-neutral-300 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <a href={`https://www.instagram.com/${e.ig_handle}/`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline">
                  @{e.ig_handle}
                </a>
                <p>{e.display_name}</p>
              </div>
              <div className="text-right text-sm">
                <span className="rounded-full bg-neutral-200 px-2 py-1 font-semibold">{e.status}</span>
                <p className="mt-1 text-neutral-600">{e.upvote_count} upvotes{e.seed ? ` · seed ${e.seed}` : ""}</p>
              </div>
            </div>
            <EntrantTools
              id={e.id}
              status={e.status}
              displayName={e.display_name}
              others={mergeable.filter((o) => o.id !== e.id).map((o) => ({ id: o.id, label: `@${o.ig_handle} (${o.upvote_count})` }))}
            />
          </section>
        ))}
      </main>
    </>
  );
}

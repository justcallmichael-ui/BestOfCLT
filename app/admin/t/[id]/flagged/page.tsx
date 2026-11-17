import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { fmtDate } from "@/components/admin/format";
import { assertUuid, requireAdminPage } from "@/components/admin/guard";
import { ActionButton } from "@/components/admin/ui";
import { AdminError } from "@/lib/admin-auth";
import { FLAG_THRESHOLD, getTournament, listFlagged } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export default async function FlaggedPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = assertUuid((await params).id);
  const t = await getTournament(id).catch((e) => (e instanceof AdminError ? null : Promise.reject(e)));
  if (!t) notFound();
  const { votes, upvotes } = await listFlagged(id);
  return (
    <>
      <AdminNav tournamentId={id} />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">{t.name}: flagged</h1>
        <p className="text-sm text-neutral-600">{FLAG_THRESHOLD} or more votes from one network in one hour. Excluded votes stay stored and can be restored.</p>

        <h2 className="text-lg font-bold">Votes in open matchups</h2>
        {votes.length === 0 && <p className="text-neutral-600">Nothing flagged.</p>}
        {votes.map((g) => {
          const allExcluded = g.excluded_count === g.total;
          const body = { matchupId: g.matchup_id, ipHash: g.ip_hash, hour: new Date(g.hour).toISOString() };
          return (
            <section key={`${g.matchup_id}-${g.ip_hash}-${String(g.hour)}`} className="space-y-2 rounded-xl border border-neutral-300 bg-white p-4 text-sm">
              <p className="text-base font-semibold">{g.a_name ?? "?"} vs {g.b_name ?? "?"} ({g.round_name})</p>
              <p>{g.total} votes, {fmtDate(g.first_at)} to {fmtDate(g.last_at)}</p>
              <p>Favored: {g.a_name ?? "A"} {g.for_a}, {g.b_name ?? "B"} {g.for_b}</p>
              <p className="font-mono text-xs text-neutral-500">network {g.ip_hash.slice(0, 10)}</p>
              {g.excluded_count > 0 && <p className="text-red-700">{g.excluded_count} excluded</p>}
              <div className="flex gap-2">
                {!allExcluded && (
                  <ActionButton path="/api/admin/flagged/exclude" body={{ ...body, excluded: true }} tone="red">Exclude group</ActionButton>
                )}
                {g.excluded_count > 0 && (
                  <ActionButton path="/api/admin/flagged/exclude" body={{ ...body, excluded: false }} tone="light">Restore group</ActionButton>
                )}
              </div>
            </section>
          );
        })}

        <h2 className="text-lg font-bold">Nomination upvotes</h2>
        <p className="text-sm text-neutral-600">Upvotes have no exclude switch in the database, so these are for review only.</p>
        {upvotes.length === 0 && <p className="text-neutral-600">Nothing flagged.</p>}
        {upvotes.map((g) => (
          <section key={`${g.entrant_id}-${g.ip_hash}-${String(g.hour)}`} className="space-y-1 rounded-xl border border-neutral-300 bg-white p-4 text-sm">
            <p className="text-base font-semibold">@{g.ig_handle} ({g.display_name})</p>
            <p>{g.total} upvotes, {fmtDate(g.first_at)} to {fmtDate(g.last_at)}</p>
            <p className="font-mono text-xs text-neutral-500">network {g.ip_hash.slice(0, 10)}</p>
          </section>
        ))}
      </main>
    </>
  );
}

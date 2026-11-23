import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { CreateTournamentForm } from "@/components/admin/CreateTournamentForm";
import { requireAdminPage } from "@/components/admin/guard";
import { fmtDate, toLocalInput } from "@/components/admin/format";
import { ActionButton } from "@/components/admin/ui";
import { DelayForm, StartBracketForm } from "@/components/admin/RoundTools";
import { SetCloseTime } from "@/components/admin/SetCloseTime";
import { nextNoonEastern } from "@/lib/services/schedule";
import { listTournaments } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireAdminPage();
  const tournaments = await listTournaments();
  const now = new Date();
  // First game day defaults to the next noon after nominations close, never before it.
  const startFor = (close: Date | string | null) => {
    const c = close ? new Date(close) : null;
    return toLocalInput(nextNoonEastern(c && c.getTime() > now.getTime() ? c : now));
  };
  return (
    <>
      <AdminNav />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">Tournaments</h1>
        {tournaments.length === 0 && <p className="text-neutral-600">No tournaments yet. Create one below.</p>}
        {tournaments.map((t) => (
          <section key={t.id} className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">{t.name}</h2>
                <p className="text-sm text-neutral-600">/{t.slug} · {t.category} · field of {t.field_size}</p>
              </div>
              <span className="rounded-full bg-neutral-200 px-3 py-1 text-sm font-semibold">{t.status}</span>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>Approved: <b>{t.approved_count}</b></div>
              <div>Pending: <b>{t.pending_count}</b></div>
              <div>Total upvotes: <b>{t.total_upvotes}</b></div>
              <div>Total votes: <b>{t.total_votes}</b></div>
              <div className="col-span-2">Current round: <b>{t.current_round ?? "none"}</b></div>
              <div className="col-span-2">Nominations close: <b>{fmtDate(t.nominations_close_at)}</b></div>
            </dl>
            {t.status === "draft" && (
              <ActionButton big className="w-full" path="/api/admin/tournaments/open-nominations" body={{ id: t.id }} tone="green">
                Open nominations
              </ActionButton>
            )}
            {(t.status === "draft" || t.status === "nominations") && (
              <SetCloseTime
                tournamentId={t.id}
                current={t.nominations_close_at ? toLocalInput(t.nominations_close_at) : ""}
                currentIso={t.nominations_close_at ? new Date(t.nominations_close_at).toISOString() : null}
              />
            )}
            {t.status === "nominations" && (
              <StartBracketForm tournamentId={t.id} defaultStart={startFor(t.nominations_close_at)} />
            )}
            {t.status === "bracket" && <DelayForm tournamentId={t.id} />}
            <div className="flex flex-wrap gap-2 text-sm font-medium">
              <Link className="rounded-lg bg-neutral-200 px-3 py-2" href={`/admin/t/${t.id}/review`}>Review ({t.pending_count})</Link>
              <Link className="rounded-lg bg-neutral-200 px-3 py-2" href={`/admin/t/${t.id}/entrants`}>Entrants</Link>
              <Link className="rounded-lg bg-neutral-200 px-3 py-2" href={`/admin/t/${t.id}/rounds`}>Schedule</Link>
              {(t.status === "bracket" || t.status === "complete") && (
                <Link className="rounded-lg bg-neutral-900 px-3 py-2 text-white" href={`/admin/t/${t.id}/posts`}>Today&apos;s posts</Link>
              )}
              <Link className="rounded-lg bg-neutral-200 px-3 py-2" href={`/admin/t/${t.id}/flagged`}>Flagged</Link>
            </div>
          </section>
        ))}
        <CreateTournamentForm />
      </main>
    </>
  );
}

import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { fmtDay, fmtTime, toLocalInput } from "@/components/admin/format";
import { assertUuid, requireAdminPage } from "@/components/admin/guard";
import { CloseTimeForm, MoveDayForm, OverrideButtons } from "@/components/admin/RoundTools";
import { AdminError } from "@/lib/admin-auth";
import { getTournament, listSchedule } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

const statusLabel = { scheduled: "Not started", open: "Open now", closed: "Finished" } as const;

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = assertUuid((await params).id);
  const t = await getTournament(id).catch((e) => (e instanceof AdminError ? null : Promise.reject(e)));
  if (!t) notFound();
  const days = await listSchedule(id);
  return (
    <>
      <AdminNav tournamentId={id} />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">{t.name}: schedule</h1>
        {days.length === 0 && <p className="text-neutral-600">The bracket has not started yet.</p>}
        {days.map((d, i) => (
          <section key={d.key} className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">Game day {i + 1}: {fmtDay(d.opens_at)}</h2>
                <p className="text-sm text-neutral-600">
                  {fmtTime(d.opens_at)} on {fmtDay(d.opens_at)} to {fmtTime(d.closes_at)} on {fmtDay(d.closes_at)} (Eastern)
                </p>
                <p className="text-sm text-neutral-600">{[...new Set(d.matchups.map((m) => m.round_name))].join(", ")}</p>
              </div>
              <span className="rounded-full bg-neutral-200 px-3 py-1 text-sm font-semibold">{statusLabel[d.status]}</span>
            </div>
            {d.status === "scheduled" && (
              <MoveDayForm
                tournamentId={id}
                groupOpensAt={d.key}
                opens={toLocalInput(d.opens_at)}
                closes={toLocalInput(d.closes_at)}
              />
            )}
            {d.status === "open" && d.matchups.some((m) => m.status === "open") && (
              <CloseTimeForm tournamentId={id} groupOpensAt={d.key} closes={toLocalInput(d.closes_at)} />
            )}
            <ul className="space-y-3">
              {d.matchups.map((m) => {
                const a = m.entrant_a_id ? { id: m.entrant_a_id, name: m.a_name ?? m.a_handle ?? "A" } : null;
                const b = m.entrant_b_id ? { id: m.entrant_b_id, name: m.b_name ?? m.b_handle ?? "B" } : null;
                const winner = m.winner_id === m.entrant_a_id ? a?.name : m.winner_id === m.entrant_b_id ? b?.name : null;
                return (
                  <li key={m.id} className="rounded-lg border border-neutral-200 p-3 text-sm">
                    <p className="font-semibold">
                      {a?.name ?? "TBD"} <span className="font-normal text-neutral-500">vs</span> {b?.name ?? "TBD"}
                    </p>
                    <p className="text-neutral-600">{m.round_name} · {statusLabel[m.status]}</p>
                    {m.status !== "scheduled" && <p>{m.status === "open" ? "Live count" : "Final count"}: {m.live_a} to {m.live_b}</p>}
                    {winner && <p>Winner: <b>{winner}</b> ({m.decided_by})</p>}
                    {m.status !== "scheduled" && a && b && <OverrideButtons matchupId={m.id} a={a} b={b} live={m.status === "open"} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}

import { notFound } from "next/navigation";
import { AddEntrants } from "@/components/admin/AddEntrants";
import { AdminNav } from "@/components/admin/AdminNav";
import { assertUuid, requireAdminPage } from "@/components/admin/guard";
import { ActionButton } from "@/components/admin/ui";
import { AdminError } from "@/lib/admin-auth";
import { getTournament, listPending } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = assertUuid((await params).id);
  const t = await getTournament(id).catch((e) => (e instanceof AdminError ? null : Promise.reject(e)));
  if (!t) notFound();
  const pending = await listPending(id);
  return (
    <>
      <AdminNav tournamentId={id} />
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-bold">{t.name}: review</h1>
        <p className="text-neutral-600">{pending.length} waiting, oldest first. Tap the handle to check the profile.</p>
        {pending.map((e) => (
          <section key={e.id} className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4">
            <div>
              <a
                href={`https://www.instagram.com/${e.ig_handle}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-bold text-blue-700 underline"
              >
                @{e.ig_handle}
              </a>
              <p className="text-base">{e.display_name}</p>
              <p className="text-sm text-neutral-600">{e.upvote_count} upvotes</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ActionButton big className="w-full" path="/api/admin/entrants/set-status" body={{ id: e.id, action: "approve" }} tone="green">
                Approve
              </ActionButton>
              <ActionButton big className="w-full" path="/api/admin/entrants/set-status" body={{ id: e.id, action: "reject" }} tone="red">
                Reject
              </ActionButton>
            </div>
          </section>
        ))}
        <AddEntrants tournamentId={id} />
      </main>
    </>
  );
}

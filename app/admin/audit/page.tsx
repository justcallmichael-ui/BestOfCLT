import { AdminNav } from "@/components/admin/AdminNav";
import { fmtDate } from "@/components/admin/format";
import { requireAdminPage } from "@/components/admin/guard";
import { listAudit } from "@/lib/services/admin";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireAdminPage();
  const rows = await listAudit(200);
  return (
    <>
      <AdminNav />
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-6">
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="text-sm text-neutral-600">Latest {rows.length} entries.</p>
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-neutral-300 bg-white p-3 text-sm">
            <p className="font-semibold">{r.action} <span className="font-normal text-neutral-500">by {r.actor}, {fmtDate(r.created_at)}</span></p>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-neutral-600">{JSON.stringify(r.details)}</pre>
          </div>
        ))}
      </main>
    </>
  );
}

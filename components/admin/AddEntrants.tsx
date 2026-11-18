"use client";

import { useState } from "react";
import { Btn, ErrorText, Field, inputCls, useAdminPost } from "./ui";

type BulkReport = { added: unknown[]; skipped: { line: string; reason: string }[] };

export function AddEntrants({ tournamentId }: { tournamentId: string }) {
  const single = useAdminPost();
  const bulk = useAdminPost();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState<BulkReport | null>(null);
  const [addedOne, setAddedOne] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await bulk.run<BulkReport>("/api/admin/entrants/bulk", { tournamentId, text });
          if (r) {
            setReport(r);
            setText("");
          }
        }}
      >
        <h2 className="text-lg font-bold">Add places</h2>
        <p className="text-sm text-neutral-600">
          Paste one place per line. An Instagram handle or profile link is all you need. To set the name yourself, add a
          comma and the name. Places are approved right away.
        </p>
        <textarea
          className={`${inputCls} min-h-40 py-2 font-mono`}
          value={text}
          placeholder={"pie_zaa\nbirdpizzeria, Bird Pizzeria\ninstagram.com/salspizzafactory"}
          autoCapitalize="none"
          onChange={(e) => setText(e.target.value)}
        />
        <Btn big className="w-full" disabled={bulk.busy || !text.trim()}>
          Add places
        </Btn>
        <ErrorText>{bulk.error}</ErrorText>
        {report && (
          <div className="text-sm" role="status">
            <p className="font-semibold text-green-700">
              {report.added.length} added, {report.skipped.length} skipped
            </p>
            {report.skipped.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {report.skipped.map((s, i) => (
                  <li key={i}>
                    <span className="font-mono">{s.line}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>

      <form
        className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await single.run("/api/admin/entrants/add", { tournamentId, handle, displayName: name });
          if (r) {
            setAddedOne(handle);
            setHandle("");
            setName("");
          }
        }}
      >
        <h2 className="text-lg font-bold">Add one place</h2>
        <Field label="Instagram handle or profile link">
          <input className={inputCls} value={handle} placeholder="@pizzaplace" autoCapitalize="none" onChange={(e) => setHandle(e.target.value)} />
        </Field>
        <Field label="Name (optional)">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Btn big className="w-full" disabled={single.busy || !handle.trim()}>
          Add
        </Btn>
        <ErrorText>{single.error}</ErrorText>
        {addedOne && !single.error && (
          <p className="text-sm font-semibold text-green-700" role="status">
            Added {addedOne}
          </p>
        )}
      </form>
    </div>
  );
}

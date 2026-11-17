"use client";

import { useState } from "react";
import { Btn, ErrorText, Field, inputCls, useAdminPost } from "./ui";

export function AddEntrants({ tournamentId }: { tournamentId: string }) {
  const single = useAdminPost();
  const bulk = useAdminPost();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState<{ added: unknown[]; skipped: { line: string; reason: string }[] } | null>(null);
  return (
    <div className="space-y-6">
      <form
        className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await single.run("/api/admin/entrants/add", { tournamentId, handle, displayName: name });
          if (r) {
            setHandle("");
            setName("");
          }
        }}
      >
        <h2 className="text-lg font-bold">Add entrant (approved right away)</h2>
        <Field label="Instagram handle">
          <input className={inputCls} value={handle} placeholder="@pizzaplace" autoCapitalize="none" onChange={(e) => setHandle(e.target.value)} />
        </Field>
        <Field label="Display name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Btn big className="w-full" disabled={single.busy || !handle || !name}>
          Add
        </Btn>
        <ErrorText>{single.error}</ErrorText>
      </form>

      <form
        className="space-y-3 rounded-xl border border-neutral-300 bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await bulk.run<{ added: unknown[]; skipped: { line: string; reason: string }[] }>("/api/admin/entrants/bulk", {
            tournamentId,
            text,
          });
          if (r) {
            setReport(r);
            setText("");
          }
        }}
      >
        <h2 className="text-lg font-bold">Bulk add</h2>
        <p className="text-sm text-neutral-600">One per line: handle, Display Name</p>
        <textarea
          className={`${inputCls} min-h-40 py-2 font-mono`}
          value={text}
          placeholder={"@pizzaplace, Pizza Place\nanother.spot, Another Spot"}
          autoCapitalize="none"
          onChange={(e) => setText(e.target.value)}
        />
        <Btn big className="w-full" disabled={bulk.busy || !text.trim()}>
          Add all
        </Btn>
        <ErrorText>{bulk.error}</ErrorText>
        {report && (
          <div className="text-sm">
            <p className="font-semibold text-green-700">Added {report.added.length}</p>
            {report.skipped.length > 0 && (
              <div className="mt-1">
                <p className="font-semibold text-red-700">Skipped {report.skipped.length}</p>
                <ul className="list-disc pl-5">
                  {report.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono">{s.line}</span>: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

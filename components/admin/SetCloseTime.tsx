"use client";

import { useState } from "react";
import { parseEasternInput } from "./format";
import { Btn, ErrorText, inputCls, useAdminPost } from "./ui";

/** Sets when nominations close. The public countdown on the home page counts down to this time. */
export function SetCloseTime({
  tournamentId,
  current,
  currentIso,
}: {
  tournamentId: string;
  current: string;
  currentIso?: string | null;
}) {
  const { run, busy, error } = useAdminPost();
  const [v, setV] = useState(current);
  const when = parseEasternInput(v);
  // Extending adds time to the saved close time, or to right now if none is saved or it has passed.
  const extend = (hours: number) => {
    const saved = currentIso ? new Date(currentIso).getTime() : 0;
    const base = Math.max(saved, Date.now());
    void run("/api/admin/tournaments/update", {
      id: tournamentId,
      nominationsCloseAt: new Date(base + hours * 3_600_000).toISOString(),
    });
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-700">
        Nominations close and voting starts (Eastern time). Shows as a countdown on the home page.
        <input className={inputCls} type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Btn
          tone="light"
          disabled={busy || !when}
          onClick={() => void run("/api/admin/tournaments/update", { id: tournamentId, nominationsCloseAt: when!.toISOString() })}
        >
          {busy ? "Saving..." : "Save time"}
        </Btn>
        <Btn
          tone="light"
          disabled={busy}
          onClick={() => {
            setV("");
            void run("/api/admin/tournaments/update", { id: tournamentId, nominationsCloseAt: null });
          }}
        >
          Clear
        </Btn>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-neutral-700">Extend by</span>
        <Btn tone="light" disabled={busy} onClick={() => extend(1)}>1 hour</Btn>
        <Btn tone="light" disabled={busy} onClick={() => extend(24)}>1 day</Btn>
        <Btn tone="light" disabled={busy} onClick={() => extend(72)}>3 days</Btn>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

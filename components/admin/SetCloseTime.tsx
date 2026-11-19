"use client";

import { useState } from "react";
import { parseEasternInput } from "./format";
import { Btn, ErrorText, inputCls, useAdminPost } from "./ui";

/** Sets when nominations close. The public countdown on the home page counts down to this time. */
export function SetCloseTime({ tournamentId, current }: { tournamentId: string; current: string }) {
  const { run, busy, error } = useAdminPost();
  const [v, setV] = useState(current);
  const when = parseEasternInput(v);
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
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

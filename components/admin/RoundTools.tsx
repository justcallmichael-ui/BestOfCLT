"use client";

import { useState } from "react";
import { ActionButton, Btn, ErrorText, inputCls, useAdminPost } from "./ui";
import { parseEasternInput } from "./format";

/** Move a game day that has not started: new open and close time (Eastern). */
export function MoveDayForm({
  tournamentId,
  groupOpensAt,
  opens,
  closes,
}: {
  tournamentId: string;
  groupOpensAt: string;
  opens: string;
  closes: string;
}) {
  const { run, busy, error } = useAdminPost();
  const [o, setO] = useState(opens);
  const [c, setC] = useState(closes);
  const opensAt = parseEasternInput(o);
  const closesAt = parseEasternInput(c);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-700">Move this game day (Eastern time)</p>
      <label className="block text-sm">
        Opens
        <input className={inputCls} type="datetime-local" value={o} onChange={(e) => setO(e.target.value)} />
      </label>
      <label className="block text-sm">
        Closes
        <input className={inputCls} type="datetime-local" value={c} onChange={(e) => setC(e.target.value)} />
      </label>
      <Btn
        disabled={busy || !opensAt || !closesAt || (o === opens && c === closes)}
        onClick={() =>
          void run("/api/admin/schedule/move", {
            tournamentId,
            groupOpensAt,
            opensAt: opensAt!.toISOString(),
            closesAt: closesAt!.toISOString(),
          })
        }
      >
        Save new times
      </Btn>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Change when a game day that is open will close. */
export function CloseTimeForm({
  tournamentId,
  groupOpensAt,
  closes,
}: {
  tournamentId: string;
  groupOpensAt: string;
  closes: string;
}) {
  const { run, busy, error } = useAdminPost();
  const [c, setC] = useState(closes);
  const closesAt = parseEasternInput(c);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-neutral-700">Change close time (Eastern time)</p>
      <div className="flex gap-2">
        <input className={inputCls} type="datetime-local" value={c} onChange={(e) => setC(e.target.value)} />
        <Btn
          disabled={busy || !closesAt || c === closes}
          onClick={() =>
            void run("/api/admin/schedule/close-time", { tournamentId, groupOpensAt, closesAt: closesAt!.toISOString() })
          }
        >
          Save
        </Btn>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function OverrideButtons({
  matchupId,
  a,
  b,
  live,
}: {
  matchupId: string;
  a: { id: string; name: string } | null;
  b: { id: string; name: string } | null;
  /** True when the game is still open: choosing a winner ends it now. */
  live?: boolean;
}) {
  const note = live ? " This ends the game now." : "";
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {a && (
        <ActionButton path="/api/admin/matchups/override" body={{ matchupId, winnerId: a.id }} tone="light" confirmText={`Make ${a.name} the winner?${note}`}>
          Make {a.name} win
        </ActionButton>
      )}
      {b && (
        <ActionButton path="/api/admin/matchups/override" body={{ matchupId, winnerId: b.id }} tone="light" confirmText={`Make ${b.name} the winner?${note}`}>
          Make {b.name} win
        </ActionButton>
      )}
    </div>
  );
}

/** Start the bracket. The start time defaults to the next noon Eastern, passed in from the server. */
export function StartBracketForm({ tournamentId, defaultStart }: { tournamentId: string; defaultStart: string }) {
  const { run, busy, error } = useAdminPost();
  const [v, setV] = useState(defaultStart);
  const startAt = parseEasternInput(v);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-700">
        First game day opens (Eastern time)
        <input className={inputCls} type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <Btn
        big
        className="w-full"
        disabled={busy || !startAt}
        onClick={() => {
          if (!window.confirm("Lock seeding and start the bracket? This cannot be undone.")) return;
          void run("/api/admin/tournaments/start", { id: tournamentId, startAt: startAt!.toISOString() });
        }}
      >
        {busy ? "Working..." : "Lock seeding and start bracket"}
      </Btn>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Pushes every game that has not finished back by some hours. Works as a pause: open games get more time. */
export function DelayForm({ tournamentId }: { tournamentId: string }) {
  const { run, busy, error } = useAdminPost();
  const [h, setH] = useState("24");
  const hours = Number(h);
  const valid = Number.isInteger(hours) && hours >= 1 && hours <= 336;
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-700">
        Delay all remaining games (hours)
        <input className={inputCls} type="number" min={1} max={336} value={h} onChange={(e) => setH(e.target.value)} />
      </label>
      <Btn
        tone="light"
        disabled={busy || !valid}
        onClick={() => {
          if (!window.confirm(`Push every game that has not finished back by ${hours} hours?`)) return;
          void run("/api/admin/schedule/delay", { tournamentId, hours });
        }}
      >
        {busy ? "Working..." : "Delay games"}
      </Btn>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

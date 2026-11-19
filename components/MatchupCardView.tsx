import type { Entrant, MatchupCard } from "@/lib/client/api";
import { formatScore, formatWhen } from "@/lib/client/time";
import { PlaceLogo } from "./PlaceLogo";

function Side({
  e,
  score,
  winner,
  lost,
}: {
  e: Entrant | null;
  score: number | null;
  winner: boolean;
  lost: boolean;
}) {
  if (!e) {
    return (
      <div className="flex min-h-12 items-center px-3 py-2 text-muted">
        <span className="display text-lg tracking-widest">TBD</span>
      </div>
    );
  }
  return (
    <div
      className={`flex min-h-12 items-center gap-2 border-l-4 px-3 py-2 ${
        winner ? "border-accent bg-accent text-accent-ink" : lost ? "border-transparent text-muted" : "border-transparent"
      }`}
    >
      <span className={`display w-6 shrink-0 text-center text-base ${winner ? "" : "text-accent"}`}>{e.seed ?? ""}</span>
      <PlaceLogo handle={e.igHandle} name={e.displayName} size={32} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate leading-tight ${winner ? "text-lg font-extrabold" : "text-base font-semibold"}`}>
          {e.displayName}
        </span>
        <span className={`block truncate text-xs ${winner ? "" : "text-muted"}`}>@{e.igHandle}</span>
      </span>
      {score !== null ? <span className="text-lg font-bold tabular-nums">{formatScore(score)}</span> : null}
      {winner ? <span className="sr-only">Winner</span> : null}
    </div>
  );
}

/** Scoreboard style card for the home page sections. */
export function MatchupCardView({ m, now }: { m: MatchupCard; now?: number }) {
  const decided = m.status === "closed" && m.winnerId !== null;
  const label = `${m.a?.displayName ?? "To be decided"} versus ${m.b?.displayName ?? "to be decided"}`;
  return (
    <div role="group" aria-label={label} className="overflow-hidden rounded-xl border-2 border-line bg-panel-2">
      <Side e={m.a} score={m.votesA} winner={decided && m.winnerId === m.a?.id} lost={decided && m.winnerId !== m.a?.id} />
      <div className="h-0.5 bg-line" />
      <Side e={m.b} score={m.votesB} winner={decided && m.winnerId === m.b?.id} lost={decided && m.winnerId !== m.b?.id} />
      <div className="flex items-center justify-between gap-2 border-t-2 border-line px-3 py-2 text-sm text-muted">
        <span>{m.roundName}</span>
        {m.status === "scheduled" ? <span>Opens {formatWhen(m.opensAt, now)}</span> : null}
        {m.status === "open" ? <span className="display text-base text-accent">Live</span> : null}
        {m.status === "closed" ? <span>Final</span> : null}
      </div>
    </div>
  );
}

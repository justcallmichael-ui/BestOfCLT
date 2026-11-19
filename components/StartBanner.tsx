"use client";

import { useNow, useTournament } from "@/lib/client/hooks";

/** Red bar at the top of every page while nominations are open: counts down to when voting starts. */
export function StartBanner({ slug }: { slug: string }) {
  const { data } = useTournament(slug);
  const now = useNow(1000);
  const closeAt = data?.tournament.nominationsCloseAt;
  if (data?.tournament.status !== "nominations" || !closeAt) return null;
  const target = new Date(closeAt).getTime();
  if (Number.isNaN(target)) return null;
  const total = Math.max(0, Math.floor((target - now) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = total === 0 ? "Nominations are closing. Voting starts soon." : null;
  return (
    <div className="bg-accent px-3 py-2 text-center text-white" role="status">
      {text ? (
        <p className="text-sm font-bold">{text}</p>
      ) : (
        <p className="text-sm font-bold sm:text-base">
          <span className="mr-2 font-semibold opacity-90">Voting starts in</span>
          <span className="tabular-nums">
            {d > 0 ? `${d}d ` : ""}
            {pad(h)}h {pad(m)}m {pad(s)}s
          </span>
        </p>
      )}
    </div>
  );
}

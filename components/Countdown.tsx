"use client";

import { useNow } from "@/lib/client/hooks";

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

export function Countdown({
  to,
  label,
  doneText = "Time is up",
}: {
  to: string;
  label: string;
  doneText?: string;
}) {
  const now = useNow(1000);
  const target = new Date(to).getTime();
  if (Number.isNaN(target)) return null;
  const left = target - now;
  if (left <= 0) {
    return (
      <p className="display text-2xl text-accent" role="status">
        {doneText}
      </p>
    );
  }
  const { d, h, m, s } = parts(left);
  const cells: [number, string][] = d > 0 ? [[d, "days"], [h, "hrs"], [m, "min"]] : [[h, "hrs"], [m, "min"], [s, "sec"]];
  const spoken = d > 0 ? `${d} days, ${h} hours` : h > 0 ? `${h} hours, ${m} minutes` : `${m} minutes`;
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className="sr-only">{spoken}</p>
      <div className="mt-2 flex gap-2" aria-hidden="true">
        {cells.map(([n, unit]) => (
          <div key={unit} className="min-w-[4.5rem] rounded-xl border-2 border-line bg-ink px-3 py-2 text-center">
            <div className="display text-4xl tabular-nums">{String(n).padStart(2, "0")}</div>
            <div className="text-xs uppercase tracking-widest text-muted">{unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

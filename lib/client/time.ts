// Visitor-local time formatting. All callers are client components that render after data loads.

function dayKey(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}

function clock(d: Date): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric" };
  if (d.getMinutes() !== 0) opts.minute = "2-digit";
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

/** "Today 12 PM", "Tomorrow 12 PM", "Thu 12 PM". */
export function formatWhen(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = dayKey(d) - dayKey(new Date(nowMs));
  const time = clock(d);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  if (diff > 1 && diff < 7) return `${weekday} ${time}`;
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  return `${weekday} ${date} ${time}`;
}

export function formatScore(n: number | null): string | null {
  return n === null ? null : n.toLocaleString("en-US");
}

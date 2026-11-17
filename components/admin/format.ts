const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "none";
  return fmt.format(new Date(d)) + " ET";
}

/** Value for a datetime-local input, in Eastern time. */
export function toLocalInput(d: Date | string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
  return parts.replace(" ", "T");
}

export { parseEasternInput } from "@/lib/services/schedule";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

/** "Thu, Jan 3" in Eastern time. */
export function fmtDay(d: Date | string): string {
  return dayFmt.format(new Date(d));
}

/** "12:00 PM" in Eastern time. */
export function fmtTime(d: Date | string): string {
  return timeFmt.format(new Date(d));
}

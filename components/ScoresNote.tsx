"use client";

/** "Scores update every 10 minutes. Last update 12:40 PM." in the visitor's local time. */
export function ScoresNote({ asOf }: { asOf: string | null | undefined }) {
  const d = asOf ? new Date(asOf) : null;
  const valid = d !== null && !Number.isNaN(d.getTime());
  const time = valid
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d)
    : null;
  return (
    <p className="text-sm text-muted">
      Scores update every 10 minutes.{time ? ` Last update ${time}.` : ""}
    </p>
  );
}

import Link from "next/link";
import { LogoutButton } from "./ui";

export function AdminNav({ tournamentId }: { tournamentId?: string }) {
  const link = "rounded-lg bg-neutral-200 px-3 py-2 text-sm font-medium";
  return (
    <header className="border-b border-neutral-300 bg-white">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-4 py-3">
        <Link href="/admin" className="mr-2 font-bold">Admin</Link>
        {tournamentId && (
          <>
            <Link className={link} href={`/admin/t/${tournamentId}/review`}>Review</Link>
            <Link className={link} href={`/admin/t/${tournamentId}/entrants`}>Entrants</Link>
            <Link className={link} href={`/admin/t/${tournamentId}/rounds`}>Schedule</Link>
            <Link className={link} href={`/admin/t/${tournamentId}/posts`}>Today&apos;s posts</Link>
            <Link className={link} href={`/admin/t/${tournamentId}/flagged`}>Flagged</Link>
          </>
        )}
        <Link className={link} href="/admin/audit">Log</Link>
        <span className="ml-auto"><LogoutButton /></span>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTournament } from "@/lib/client/hooks";

export function TournamentNav({ slug, initialStatus }: { slug: string; initialStatus?: string | null }) {
  const pathname = usePathname();
  // The server provides the phase, so the tab set is right on first paint. Only fetch as a fallback.
  const { data } = useTournament(slug, { enabled: !initialStatus });
  const base = `/t/${encodeURIComponent(slug)}`;
  // Nominations are over once the bracket starts, so the tab only shows before that.
  const phase = initialStatus ?? data?.tournament.status;
  const showNominate = phase === "nominations" || phase === "draft";
  // Until the phase is known, keep the Nominate slot in place (invisible) so nothing shifts.
  const pending = !phase;
  const items = [
    { href: base, label: "Home", hidden: false },
    ...(showNominate || pending ? [{ href: `${base}/nominate`, label: "Nominate", hidden: pending }] : []),
    { href: `${base}/vote`, label: "Vote", hidden: false },
    { href: `${base}/bracket`, label: "Bracket", hidden: false },
    { href: `${base}/how-it-works`, label: "How it works", hidden: false },
  ];
  return (
    <nav
      aria-label="Tournament"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:static md:border-b md:border-t-0 md:pb-0"
    >
      <ul className="mx-auto flex w-full max-w-5xl gap-1 p-1.5 md:justify-center md:gap-2 md:p-2">
        {items.map((item) => {
          const active = pathname === item.href || (item.href === base && pathname === "/");
          return (
            <li key={item.href} className="flex-1" aria-hidden={item.hidden || undefined}>
              <Link
                href={item.href}
                tabIndex={item.hidden ? -1 : undefined}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center whitespace-nowrap rounded-full text-[0.78rem] font-bold sm:text-[0.95rem] md:px-6 ${
                  active ? "bg-accent text-white" : "text-muted hover:bg-panel-2"
                } ${item.hidden ? "invisible" : ""
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

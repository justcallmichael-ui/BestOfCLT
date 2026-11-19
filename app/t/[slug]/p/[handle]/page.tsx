import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import { brand } from "@/lib/config";
import { SharePageButton } from "@/components/share/SharePageButton";
import { StoryButton } from "@/components/share/StoryButton";
import { advanceDueRounds } from "@/lib/services/bracket";
import {
  entrantPageUrl,
  fmtClock,
  fmtDayShort,
  getEntrantShareByHandle,
  type EntrantShare,
} from "@/lib/share/posts";

export const dynamic = "force-dynamic";

const load = cache(async (slug: string, handle: string): Promise<EntrantShare | null> => {
  await advanceDueRounds(new Date()).catch(() => undefined);
  return getEntrantShareByHandle(slug, decodeURIComponent(handle));
});

type Props = { params: Promise<{ slug: string; handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, handle } = await params;
  const v = await load(slug, handle);
  if (!v) return { title: "Not found" };
  const title = `Vote for ${v.entrant.displayName}`;
  const description = `${v.entrant.displayName} (@${v.entrant.igHandle}) is in the ${v.tournament.name}. Vote at ${new URL(brand.siteUrl).host}.`;
  const image = { url: `/api/og/entrant?id=${v.entrant.id}&size=og`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: brand.name, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

const when = (iso: string) => `${fmtDayShort(iso)} at ${fmtClock(iso)} ET`;

export default async function EntrantPage({ params }: Props) {
  const { slug, handle } = await params;
  const v = await load(slug, handle);
  if (!v) notFound();
  const { entrant, current, results, tournament } = v;
  const open = current?.matchup.status === "open";
  const opp = current?.opponent ?? null;
  const pageUrl = entrantPageUrl(tournament.slug, entrant.igHandle);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      <div className="flex flex-col gap-6">
        <div>
          <p className="display inline-block rounded-md bg-accent px-2 py-1 text-base text-accent-ink">
            {entrant.seed != null ? `Seed ${entrant.seed}` : tournament.category}
          </p>
          <h1 className="display mt-3 text-5xl sm:text-6xl">{entrant.displayName}</h1>
          <a
            href={`https://www.instagram.com/${entrant.igHandle}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-12 items-center text-lg text-muted underline underline-offset-4"
          >
            @{entrant.igHandle}
          </a>
        </div>

        {v.champion ? (
          <section className="panel p-5">
            <h2 className="display text-3xl text-accent">Champion</h2>
            <p className="mt-2 text-lg text-muted">{tournament.name}</p>
          </section>
        ) : current ? (
          <section className="panel flex flex-col gap-4 p-5" aria-labelledby="next">
            <h2 id="next" className="display text-xl text-accent">
              {open ? "Voting now" : "Up next"} · {current.matchup.roundName}
            </h2>
            <p className="display text-3xl">
              vs {opp ? `${opp.seed != null ? `(${opp.seed}) ` : ""}${opp.displayName}` : "TBD"}
            </p>
            {opp && <p className="text-muted">@{opp.igHandle}</p>}
            <p className="text-lg text-muted">
              {open ? `Closes ${when(current.matchup.closesAt)}` : `Voting opens ${when(current.matchup.opensAt)}`}
            </p>
            {open && (
              <Link href={`/t/${encodeURIComponent(tournament.slug)}/vote`} className="btn btn-primary">
                Vote
              </Link>
            )}
          </section>
        ) : (
          <section className="panel p-5">
            <p className="text-lg text-muted">
              {v.eliminated
                ? "This place is out of the bracket. Thanks for voting."
                : entrant.seed == null && tournament.status !== "nominations"
                  ? "This place did not make the bracket field."
                  : "The bracket has not started yet. Check back soon."}
            </p>
          </section>
        )}

        {results.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="results">
            <h2 id="results" className="display text-2xl">
              Results so far
            </h2>
            <ul className="flex flex-col gap-3">
              {results.map((r) => (
                <li key={r.matchup.id} className="panel flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm text-muted">{r.matchup.roundName}</p>
                    <p className="truncate text-lg">
                      {r.won ? "Beat" : "Lost to"} {r.opponent?.displayName ?? "TBD"}
                    </p>
                  </div>
                  <p className={`display shrink-0 text-2xl ${r.won ? "text-accent" : "text-muted"}`}>
                    {r.votesFor} to {r.votesAgainst}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <StoryButton entrantId={entrant.id} handle={entrant.igHandle} url={pageUrl} title={`Vote for ${entrant.displayName}`} />
          <SharePageButton url={pageUrl} title={`Vote for ${entrant.displayName}`} />
          <a
            href={`/api/og/entrant?id=${entrant.id}`}
            download={`${tournament.slug}-vote-for-${entrant.igHandle}.png`}
            className="btn btn-ghost"
          >
            Download story graphic
          </a>
        </div>
      </div>
    </div>
  );
}

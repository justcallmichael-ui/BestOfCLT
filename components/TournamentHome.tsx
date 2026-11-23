"use client";

import Link from "next/link";
import type { MatchupCard, TournamentState } from "@/lib/client/api";
import { useRefreshAt, useTournament, instagramUrl } from "@/lib/client/hooks";
import { isNoIg } from "@/lib/handles";
import { MatchupCardView } from "./MatchupCardView";
import { NominatePanel } from "./NominatePanel";
import { Countdown } from "./Countdown";
import { ScoresNote } from "./ScoresNote";
import { ErrorBlock, LoadingBlock } from "./Status";

export function TournamentHome({ slug }: { slug: string }) {
  const { data, error, refetch } = useTournament(slug, { refresh: true });
  // A countdown on this page reaching zero means a matchup opened or closed: refetch.
  useRefreshAt(
    data
      ? [
          data.tournament.status === "nominations" ? data.tournament.nominationsCloseAt : null,
          ...data.live.map((m) => m.closesAt),
          ...data.upNext.map((m) => m.opensAt),
          data.nextOpensAt,
        ]
      : [],
    refetch,
  );
  const base = `/t/${encodeURIComponent(slug)}`;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      {error ? (
        <ErrorBlock message={error} />
      ) : !data ? (
        <LoadingBlock />
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <p className="display inline-block rounded-md bg-accent px-2 py-1 text-base text-accent-ink">
              {data.tournament.category}
            </p>
            <h1 className="display mt-2 text-3xl sm:text-5xl">{data.tournament.name}</h1>
          </div>

          {data.tournament.status === "nominations" ? (
            <>
              <div className="flex flex-col gap-3">
                <p className="text-base text-muted">
                  Upvote your favorites or add a place that is missing. The top {data.tournament.fieldSize} by upvotes
                  make the bracket.
                </p>
              </div>
              <Link href={`${base}/how-it-works`} className="btn btn-ghost">
                How it works
              </Link>
              {data.tournament.nominationsCloseAt ? (
                <div className="flex justify-center text-center">
                  <Countdown
                    to={data.tournament.nominationsCloseAt}
                    label="Voting starts in"
                    doneText="Nominations are closing. Voting starts soon."
                  />
                </div>
              ) : null}
              <NominatePanel slug={slug} embedded />
            </>
          ) : data.tournament.status === "bracket" ? (
            <>
              <Link href={`${base}/how-it-works`} className="btn btn-ghost">
                How it works
              </Link>
              <BracketPhase data={data} base={base} />
              <ScoresNote asOf={data.scoresAsOf} />
            </>
          ) : data.tournament.status === "complete" ? (
            <>
              <section className="panel flex flex-col gap-4 p-5" aria-labelledby="phase">
                <h2 id="phase" className="display text-xl text-accent">
                  Champion
                </h2>
                {data.champion ? (
                  <div>
                    <p className="display text-5xl">{data.champion.displayName}</p>
                    {isNoIg(data.champion.igHandle) ? null : (
                      <a
                        href={instagramUrl(data.champion.igHandle)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex min-h-12 items-center text-lg text-muted underline underline-offset-4"
                      >
                        @{data.champion.igHandle}
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-lg text-muted">The tournament is over.</p>
                )}
                <Link href={`${base}/bracket`} className="btn btn-primary">
                  See the full bracket
                </Link>
              </section>
              <Results list={data.latestResults} heading="Final results" />
              <Link href={`${base}/how-it-works`} className="btn btn-ghost">
                How it works
              </Link>
            </>
          ) : (
            <section className="panel p-5">
              <p className="text-lg text-muted">This tournament is not open yet. Check back soon.</p>
            </section>
          )}
          {data.totalVotes ? (
            <p className="pt-2 text-center text-base font-bold" aria-live="polite">
              {data.totalVotes.toLocaleString("en-US")} {data.totalVotes === 1 ? "vote" : "votes"} cast in this contest so far
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CardList({ list }: { list: MatchupCard[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {list.map((m) => (
        <li key={m.id}>
          <MatchupCardView m={m} />
        </li>
      ))}
    </ul>
  );
}

function Results({ list, heading = "Latest results" }: { list: MatchupCard[]; heading?: string }) {
  if (list.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="results">
      <h2 id="results" className="display text-3xl">
        {heading}
      </h2>
      <CardList list={list} />
    </section>
  );
}

function BracketPhase({ data, base }: { data: TournamentState; base: string }) {
  const live = data.live.length > 0;
  const upNext = data.upNext.length > 0 ? (
    <section className="panel flex flex-col gap-4 p-5" aria-labelledby="upnext">
      <h2 id="upnext" className="display text-3xl">
        Up next
      </h2>
      {!live && data.nextOpensAt ? (
        <Countdown to={data.nextOpensAt} label="Voting opens in" doneText="Voting is opening" />
      ) : null}
      <CardList list={data.upNext} />
    </section>
  ) : null;

  return (
    <>
      {live ? (
        <section className="panel flex flex-col gap-5 p-5" aria-labelledby="live">
          <h2 id="live" className="display text-3xl">
            Live now
          </h2>
          <Countdown
            to={data.live.reduce((min, m) => (m.closesAt < min ? m.closesAt : min), data.live[0].closesAt)}
            label="Voting closes in"
            doneText="Voting is closing"
          />
          <CardList list={data.live} />
          <Link href={`${base}/vote`} className="btn btn-primary">
            Vote now
          </Link>
        </section>
      ) : null}
      {!live && !upNext ? (
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="soon">
          <h2 id="soon" className="display text-3xl">
            More games soon
          </h2>
          <p className="text-lg text-muted">Check the bracket to see how it stands.</p>
        </section>
      ) : null}
      {upNext}
      <Results list={data.latestResults} />
      <Link href={`${base}/bracket`} className="btn btn-ghost">
        See the bracket
      </Link>
    </>
  );
}

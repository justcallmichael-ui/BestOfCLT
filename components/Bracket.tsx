"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type BracketMatchup, type BracketRound, type Entrant } from "@/lib/client/api";
import { prefersReducedMotion, useRefreshAt, useScoresRefresh } from "@/lib/client/hooks";
import { formatScore, formatWhen } from "@/lib/client/time";
import { atHandle } from "@/lib/handles";
import { PlaceLogo } from "./PlaceLogo";
import { ScoresNote } from "./ScoresNote";
import { ErrorBlock, LoadingBlock } from "./Status";

const score = formatScore;

const hasLive = (r: BracketRound) => r.matchups.some((m) => m.status === "open");

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function Bracket({ slug }: { slug: string }) {
  const [rounds, setRounds] = useState<BracketRound[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const cols = useRef<(HTMLLIElement | null)[]>([]);
  const positioned = useRef(false);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .getBracket(slug)
      .then((r) => {
        if (cancelled) return;
        setRounds([...r.rounds].sort((x, y) => x.number - y.number));
        setAsOf(r.scoresAsOf ?? null);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, tick]);

  // Scores refresh every 10 minutes, when the tab returns after a while, and when a matchup opens or closes.
  useScoresRefresh(load);
  useRefreshAt(
    (rounds ?? []).flatMap((r) =>
      r.matchups.flatMap((m) => (m.status === "closed" ? [] : [m.status === "scheduled" ? m.opensAt : null, m.closesAt])),
    ),
    load,
  );

  // Jump to the live round once, the first time data arrives.
  useEffect(() => {
    if (!rounds || positioned.current) return;
    positioned.current = true;
    let idx = rounds.findIndex(hasLive);
    if (idx < 0) idx = rounds.findIndex((r) => r.status === "open");
    if (idx < 0) {
      for (let i = rounds.length - 1; i >= 0; i--) {
        if (rounds[i].status === "closed") {
          idx = i;
          break;
        }
      }
    }
    if (idx <= 0) return;
    const sc = scroller.current;
    const col = cols.current[idx];
    if (sc && col) sc.scrollTo({ left: col.offsetLeft, behavior: "auto" });
  }, [rounds]);

  function onScroll() {
    const sc = scroller.current;
    if (!sc) return;
    let best = 0;
    let bestDist = Infinity;
    cols.current.forEach((c, i) => {
      if (!c) return;
      const d = Math.abs(c.offsetLeft - sc.scrollLeft);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    setActive((a) => (a === best ? a : best));
  }

  function jump(i: number) {
    const sc = scroller.current;
    const col = cols.current[i];
    if (!sc || !col) return;
    sc.scrollTo({ left: col.offsetLeft, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setActive(i);
  }

  return (
    <div className="mx-auto w-full max-w-[110rem] px-4 py-6">
      <h1 className="display text-5xl">The bracket</h1>
      {rounds && rounds.length > 0 ? (
        <div className="mt-2">
          <ScoresNote asOf={asOf} />
        </div>
      ) : null}
      {error ? (
        <div className="mt-5">
          <ErrorBlock message={error} onRetry={() => load()} />
        </div>
      ) : !rounds ? (
        <div className="mt-5">
          <LoadingBlock label="Loading the bracket" />
        </div>
      ) : rounds.length === 0 ? (
        <p className="panel mt-5 p-5 text-lg text-muted">The bracket is not set yet. It appears once nominations close.</p>
      ) : (
        <>
          <nav aria-label="Jump to round" className="scroll-hide -mx-4 mt-5 overflow-x-auto px-4">
            <ul className="flex w-max gap-2">
              {rounds.map((r, i) => (
                <li key={r.number}>
                  <button
                    type="button"
                    onClick={() => jump(i)}
                    aria-pressed={active === i}
                    className={`btn min-h-12 whitespace-nowrap text-base ${active === i ? "btn-primary" : "btn-ghost"}`}
                  >
                    {r.name}
                    {hasLive(r) ? <span className="rounded bg-ink px-1.5 py-0.5 text-xs text-accent">Live</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div
            ref={scroller}
            onScroll={onScroll}
            className="relative -mx-4 mt-5 overflow-x-auto px-4 pb-6 [scroll-snap-type:x_mandatory] lg:[scroll-snap-type:none]"
            tabIndex={0}
            aria-label="Bracket, scrolls sideways"
          >
            <ol className="flex w-max items-stretch gap-4 lg:gap-8">
              {rounds.map((round, ri) => (
                <li
                  key={round.number}
                  ref={(el) => {
                    cols.current[ri] = el;
                  }}
                  aria-label={round.name}
                  className={`w-[84vw] max-w-sm shrink-0 scroll-ml-4 [scroll-snap-align:start] lg:w-64 lg:scroll-ml-0 ${
                    ri < rounds.length - 1 ? "bracket-has-next" : ""
                  } ${ri > 0 ? "bracket-has-prev" : ""} flex flex-col`}
                >
                  <h2 className="display mb-3 text-2xl">
                    {round.name}
                    {hasLive(round) ? <span className="ml-2 text-base text-accent">Live</span> : null}
                  </h2>
                  <RoundList round={round} />
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

function RoundList({ round }: { round: BracketRound }) {
  const sorted = [...round.matchups].sort((a, b) => a.slot - b.slot);
  const pairs = chunk(sorted, 2);
  return (
    <ol className="bracket-col flex-1" aria-label={`${round.name} matchups`}>
      {pairs.map((pair) => (
        <li key={pair[0].id} className="bracket-pair" data-two={pair.length === 2}>
          <ol className="bracket-pair-list">
            {pair.map((m) => (
              <li key={m.id} className="bracket-match">
                <Match
                  m={m}
                  showRegion={m.region !== null && sorted[sorted.indexOf(m) - 1]?.region !== m.region}
                />
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function Match({ m, showRegion }: { m: BracketMatchup; showRegion: boolean }) {
  const decided = m.winnerId !== null;
  const statusText =
    m.status === "open" ? "Live" : m.status === "closed" ? "Final" : `Opens ${formatWhen(m.opensAt)}`;
  const label = `${m.a?.displayName ?? "To be decided"} versus ${m.b?.displayName ?? "to be decided"}, ${statusText}`;
  return (
    <>
      {showRegion ? <span className="bracket-region">Region {m.region}</span> : null}
      <div
        role="group"
        aria-label={label}
        className="bracket-card overflow-hidden rounded-xl border-2 border-line bg-panel"
      >
        <Slot e={m.a} votes={score(m.votesA)} winner={decided && m.winnerId === m.a?.id} lost={decided && m.winnerId !== m.a?.id} />
        <div className="h-0.5 bg-line" />
        <Slot e={m.b} votes={score(m.votesB)} winner={decided && m.winnerId === m.b?.id} lost={decided && m.winnerId !== m.b?.id} />
        <div className="flex items-center justify-between gap-2 border-t-2 border-line px-3 py-1.5 text-xs">
          {m.status === "open" ? (
            <span className="display rounded bg-accent px-1.5 py-0.5 text-sm text-accent-ink">Live</span>
          ) : m.status === "closed" ? (
            <span className="font-semibold uppercase tracking-widest text-muted">Final</span>
          ) : (
            <span className="text-muted">{statusText}</span>
          )}
        </div>
      </div>
    </>
  );
}

function Slot({ e, votes, winner, lost }: { e: Entrant | null; votes: string | null; winner: boolean; lost: boolean }) {
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
      <PlaceLogo handle={e.igHandle} name={e.displayName} size={24} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate leading-tight ${winner ? "text-base font-extrabold" : "text-sm font-semibold"} ${lost ? "line-through decoration-1" : ""}`}>
          {e.displayName}
        </span>
        <span className={`block truncate text-xs ${winner ? "" : "text-muted"}`}>{atHandle(e.igHandle)}</span>
      </span>
      {votes ? <span className="text-sm font-bold tabular-nums">{votes}</span> : null}
      {winner ? <span className="sr-only">Winner</span> : null}
    </div>
  );
}

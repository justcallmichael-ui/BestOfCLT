"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage, type NextMatchup } from "@/lib/client/api";
import { useTournament } from "@/lib/client/hooks";
import { brand } from "@/lib/config";
import { formatWhen } from "@/lib/client/time";
import { Countdown } from "./Countdown";
import { atHandle, isNoIg } from "@/lib/handles";
import { PlaceLogo } from "./PlaceLogo";
import { ErrorBlock, LoadingBlock } from "./Status";

type Choice = "a" | "b";
type Phase = "loading" | "voting" | "sent" | "empty" | "error";
type Matchup = NonNullable<NextMatchup["matchup"]>;
type Entrant = Matchup["a"];

const THRESHOLD = 80;
const MAX_DRAG = 170;
const SPLIT_MS = 1600;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function VoteScreen({ slug }: { slug: string }) {
  const { data: tState } = useTournament(slug);
  const base = `/t/${encodeURIComponent(slug)}`;

  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [nextOpensAt, setNextOpensAt] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [picked, setPicked] = useState<Choice | null>(null);
  const [split, setSplit] = useState<{ a: number; b: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firstTry, setFirstTry] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);

  const alive = useRef(true);
  const gesture = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applyNext = useCallback((r: NextMatchup) => {
    setMatchup(r.matchup);
    setRemaining(r.remaining);
    setNextOpensAt(r.nextOpensAt ?? null);
    setPicked(null);
    setSplit(null);
    setDrag(0);
    setLoadError(null);
    setPhase(r.matchup ? "voting" : "empty");
  }, []);

  // Fallback only: after a 409 or 429 the vote response carries no `next`.
  const loadNext = useCallback(async () => {
    try {
      const r = await api.nextMatchup(slug);
      if (!alive.current) return;
      applyNext(r);
    } catch (e) {
      if (!alive.current) return;
      setLoadError(errorMessage(e));
      setPhase("error");
    }
  }, [slug, applyNext]);

  useEffect(() => {
    let cancelled = false;
    api
      .nextMatchup(slug)
      .then((r) => {
        if (cancelled) return;
        setMatchup(r.matchup);
        setRemaining(r.remaining);
        setNextOpensAt(r.nextOpensAt ?? null);
        setPhase(r.matchup ? "voting" : "empty");
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(errorMessage(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [slug, firstTry]);

  const castVote = useCallback(
    async (choice: Choice) => {
      if (phase !== "voting" || !matchup) return;
      const id = matchup.id;
      setPicked(choice);
      setPhase("sent");
      setNotice(null);
      setDrag(0);
      setDragging(false);
      const startedAt = Date.now();
      let next: NextMatchup | null = null;
      try {
        const r = await api.vote(id, choice);
        if (!alive.current) return;
        next = r.next ?? null;
        setSplit({ a: r.votesA, b: r.votesB });
        await sleep(Math.max(0, SPLIT_MS - (Date.now() - startedAt)));
      } catch (e) {
        if (!alive.current) return;
        if (e instanceof ApiError && (e.status === 409 || e.status === 429)) {
          setNotice(
            e.status === 409
              ? "That game just closed. Loading what is next."
              : "Too many votes from your connection. Loading what is next.",
          );
          await sleep(1200);
        } else {
          setNotice("Your vote did not go through. Check your connection and try again.");
          setPicked(null);
          setPhase("voting");
          return;
        }
      }
      if (!alive.current) return;
      if (next) {
        setNotice(null);
        applyNext(next);
      } else {
        await loadNext();
      }
    },
    [phase, matchup, loadNext, applyNext],
  );

  useEffect(() => {
    if (phase !== "voting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") void castVote("a");
      else if (e.key === "ArrowRight") void castVote("b");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, castVote]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "voting") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.captured) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        g.captured = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        setDragging(true);
      } else {
        if (Math.abs(dy) > 10) gesture.current = null;
        return;
      }
    }
    setDrag(Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !g.captured || e.pointerId !== g.id) return;
    suppressClick.current = true;
    setDragging(false);
    const dx = e.clientX - g.x;
    if (dx <= -THRESHOLD) void castVote("a");
    else if (dx >= THRESHOLD) void castVote("b");
    else setDrag(0);
  }

  function onPointerCancel() {
    gesture.current = null;
    setDragging(false);
    setDrag(0);
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }

  if (phase === "loading") {
    return (
      <Shell>
        <LoadingBlock label="Loading matchup" />
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <ErrorBlock
          message={loadError ?? "Could not load the next matchup."}
          onRetry={() => {
            setPhase("loading");
            setFirstTry((n) => n + 1);
          }}
        />
      </Shell>
    );
  }

  if (phase === "empty" || !matchup) {
    const status = tState?.tournament.status;
    return (
      <Shell>
        <div className="flex flex-col gap-5">
          {status === "nominations" ? (
            <section className="panel flex flex-col gap-4 p-5">
              <h1 className="display text-4xl">Voting has not started</h1>
              <p className="text-lg text-muted">Head to nominations while you wait.</p>
              <Link href={`${base}/nominate`} className="btn btn-primary">
                Nominate and upvote
              </Link>
            </section>
          ) : status === "complete" ? (
            <section className="panel flex flex-col gap-4 p-5">
              <h1 className="display text-4xl">Voting is over</h1>
              <p className="text-lg text-muted">See who took the title.</p>
              <Link href={`${base}/bracket`} className="btn btn-primary">
                See the bracket
              </Link>
            </section>
          ) : (
            <section className="panel flex flex-col gap-5 p-5">
              <h1 className="display text-4xl">You&apos;re all caught up</h1>
              {nextOpensAt ? (
                <>
                  <p className="text-lg text-muted">
                    You voted on every open matchup. Next games open {formatWhen(nextOpensAt)}.
                  </p>
                  <Countdown to={nextOpensAt} label="Next games open in" doneText="Next games are opening" />
                </>
              ) : (
                <p className="text-lg text-muted">
                  You voted on every open matchup. No more games are scheduled right now.
                </p>
              )}
              <Link href={`${base}/bracket`} className="btn btn-primary">
                See the bracket
              </Link>
            </section>
          )}
        </div>
      </Shell>
    );
  }

  const total = split ? split.a + split.b : 0;
  const progress = Math.min(1, Math.abs(drag) / THRESHOLD);
  const leaning: Choice | null = drag < -4 ? "a" : drag > 4 ? "b" : null;

  return (
    <Shell>
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <h1 className="display text-3xl">{matchup.roundName}</h1>
          <p className="text-sm font-semibold uppercase tracking-widest text-muted">
            {remaining > 0 ? `${remaining} left` : "Last one"}
          </p>
        </div>

        <div
          className="relative"
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
        >
          <div className="grid grid-cols-2 gap-3">
            <VoteCard
              side="a"
              entrant={matchup.a}
              state={cardState("a", picked, leaning)}
              progress={leaning === "a" ? progress : 0}
              drag={leaning === "a" ? drag : leaning === "b" ? drag : 0}
              leaning={leaning}
              dragging={dragging}
              disabled={phase !== "voting"}
              pct={split ? pct(split.a, total) : null}
              waiting={phase === "sent" && !split}
              onPick={() => void castVote("a")}
            />
            <VoteCard
              side="b"
              entrant={matchup.b}
              state={cardState("b", picked, leaning)}
              progress={leaning === "b" ? progress : 0}
              drag={leaning === "b" ? drag : leaning === "a" ? drag : 0}
              leaning={leaning}
              dragging={dragging}
              disabled={phase !== "voting"}
              pct={split ? pct(split.b, total) : null}
              waiting={phase === "sent" && !split}
              onPick={() => void castVote("b")}
            />
          </div>
          <span
            aria-hidden="true"
            className="display pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-ink bg-accent text-xl text-accent-ink"
          >
            VS
          </span>
        </div>

        <Countdown to={matchup.closesAt} label="This game closes in" doneText="This game is closing" />

        <div aria-live="polite" className="min-h-12">
          {notice ? (
            <p role="alert" className="rounded-xl border-2 border-accent bg-panel px-4 py-3 text-base">
              {notice}
            </p>
          ) : phase === "sent" ? (
            <p className="py-3 text-center text-base text-muted">
              {split ? "Vote counted. Here is how the city split." : "Vote sent."}
            </p>
          ) : (
            <p className="flex items-center justify-center gap-3 py-3 text-base text-muted">
              <Arrow dir="left" /> Swipe toward your pick, or tap it <Arrow dir="right" />
            </p>
          )}
        </div>

        <p className="text-center text-sm text-muted">
          <a
            href={brand.igUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Results post on @{brand.igHandle}
          </a>
        </p>
      </div>
    </Shell>
  );
}

function cardState(side: Choice, picked: Choice | null, leaning: Choice | null): "idle" | "lean" | "picked" | "lost" | "dim" {
  if (picked) return picked === side ? "picked" : "lost";
  if (leaning) return leaning === side ? "lean" : "dim";
  return "idle";
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-xl px-4 py-5">{children}</div>;
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
    </svg>
  );
}

function VoteCard({
  side,
  entrant,
  state,
  progress,
  drag,
  leaning,
  dragging,
  disabled,
  pct: percent,
  waiting,
  onPick,
}: {
  side: Choice;
  entrant: Entrant;
  state: "idle" | "lean" | "picked" | "lost" | "dim";
  progress: number;
  drag: number;
  leaning: Choice | null;
  dragging: boolean;
  disabled: boolean;
  pct: number | null;
  waiting: boolean;
  onPick: () => void;
}) {
  let transform = "none";
  let opacity = 1;
  if (state === "lean") {
    transform = `translateX(${drag * 0.3}px) rotate(${drag / 22}deg) scale(${1 + 0.05 * progress})`;
  } else if (state === "dim" && leaning) {
    transform = `scale(${1 - 0.04 * Math.min(1, Math.abs(drag) / THRESHOLD)})`;
    opacity = 1 - 0.4 * Math.min(1, Math.abs(drag) / THRESHOLD);
  } else if (state === "picked") {
    transform = "scale(1.03)";
  } else if (state === "lost") {
    transform = "scale(0.96)";
    opacity = 0.55;
  }
  const highlighted = state === "lean" || state === "picked";
  const label = `Vote for ${entrant.displayName}${isNoIg(entrant.igHandle) ? "" : `, ${atHandle(entrant.igHandle)}`}${entrant.seed ? `, seed ${entrant.seed}` : ""}`;

  return (
    <button
      type="button"
      data-dragging={dragging}
      disabled={disabled}
      aria-label={label}
      onClick={onPick}
      className="vote-card"
      style={{
        transform,
        opacity,
        borderColor: highlighted ? "var(--color-accent)" : undefined,
        boxShadow: highlighted ? `0 0 0 ${2 + 4 * (state === "picked" ? 1 : progress)}px color-mix(in srgb, var(--color-accent) 35%, transparent)` : undefined,
        zIndex: highlighted ? 5 : 1,
      }}
    >
      <span className="flex items-start justify-between">
        {entrant.seed ? (
          <span className="display rounded-md bg-ink px-2 py-1 text-lg text-accent">#{entrant.seed} seed</span>
        ) : (
          <span />
        )}
        <span
          aria-hidden="true"
          className="display rounded-md bg-accent px-2 py-1 text-base text-accent-ink"
          style={{ opacity: state === "picked" ? 1 : progress }}
        >
          Pick
        </span>
      </span>

      <span className="block">
        {percent !== null ? (
          <span className="display mb-2 block text-6xl text-accent" aria-label={`${percent} percent`}>
            {percent}%
          </span>
        ) : waiting && state === "picked" ? (
          <span className="display mb-2 block text-3xl text-muted" aria-hidden="true">
            ...
          </span>
        ) : null}
        <span className="mb-3 block">
          <PlaceLogo handle={entrant.igHandle} name={entrant.displayName} size={72} />
        </span>
        <span className="display block text-balance break-words text-3xl sm:text-4xl">{entrant.displayName}</span>
        <span className="mt-1 block break-all text-base text-muted">{atHandle(entrant.igHandle)}</span>
        <span className="sr-only">{side === "a" ? "Left option" : "Right option"}</span>
      </span>
    </button>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  errorMessage,
  type EntrantRow,
  type NominateResult,
} from "@/lib/client/api";
import { instagramUrl, useTournament } from "@/lib/client/hooks";
import { VOTES_PER_VOTER } from "@/lib/config";
import Link from "next/link";
import { StoryButton } from "./share/StoryButton";
import { PlaceLogo } from "./PlaceLogo";
import { ErrorBlock, LoadingBlock } from "./Status";

const RESULT_TEXT: Record<NominateResult, { text: string; good: boolean }> = {
  created_pending: { text: "Added. It is on the list now.", good: true },
  upvoted: { text: "That place is already on the list. We added your upvote.", good: true },
  already_upvoted: { text: "You already upvoted that place.", good: true },
  no_votes_left: { text: "You are out of votes. You get " + VOTES_PER_VOTER + " during nominations.", good: false },
  rejected: { text: "That place cannot be added to this tournament.", good: false },
  closed: { text: "Nominations are closed.", good: false },
  invalid_handle: {
    text: "That does not look like an Instagram handle. Type @name or paste the profile link.",
    good: false,
  },
};

export function NominatePanel({ slug, embedded = false }: { slug: string; embedded?: boolean }) {
  const { data: tState } = useTournament(slug);
  const [entrants, setEntrants] = useState<EntrantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formResult, setFormResult] = useState<{ text: string; good: boolean } | null>(null);

  const closed = !!tState && tState.tournament.status !== "nominations";
  const category = tState?.tournament.category?.toLowerCase() ?? "pizza";

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .getEntrants(slug)
      .then((r) => {
        if (cancelled) return;
        setEntrants(r.entrants);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, tick]);

  const filtered = useMemo(() => {
    if (!entrants) return [];
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return entrants;
    return entrants.filter(
      (e) => e.displayName.toLowerCase().includes(q) || e.igHandle.toLowerCase().includes(q),
    );
  }, [entrants, query]);

  // The place named in the link, shown only after the list has loaded on the client.
  const focus =
    entrants && typeof window !== "undefined"
      ? (/^#place-(.+)$/.exec(decodeURIComponent(window.location.hash))?.[1] ?? null)
      : null;
  useEffect(() => {
    if (focus) document.getElementById(`place-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  const [shareRow, setShareRow] = useState<EntrantRow | null>(null);
  const votesLeft = Math.max(0, VOTES_PER_VOTER - (entrants?.filter((e) => e.upvotedByMe).length ?? 0));

  async function upvote(row: EntrantRow) {
    if (row.upvotedByMe || pending.has(row.id) || closed) return;
    setRowNotice(null);
    setPending((p) => new Set(p).add(row.id));
    setEntrants((list) =>
      list?.map((e) => (e.id === row.id ? { ...e, upvotedByMe: true, upvoteCount: e.upvoteCount + 1 } : e)) ?? list,
    );
    try {
      const r = await api.upvote(row.id);
      setEntrants((list) =>
        list?.map((e) => (e.id === row.id ? { ...e, upvotedByMe: true, upvoteCount: r.upvoteCount } : e)) ?? list,
      );
      setShareRow(row);
    } catch (e) {
      setEntrants((list) => list?.map((x) => (x.id === row.id ? row : x)) ?? list);
      setRowNotice(
        e instanceof ApiError && e.status === 429
          ? "Too many upvotes from your connection. Try again a little later."
          : e instanceof ApiError && e.status === 409
            ? "Nominations are closed."
            : e instanceof ApiError && e.status === 422
              ? "You are out of votes. You get " + VOTES_PER_VOTER + " during nominations."
              : "Your upvote did not go through. Try again.",
      );
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(row.id);
        return next;
      });
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting || !handle.trim()) return;
    setSubmitting(true);
    setFormResult(null);
    try {
      const r = await api.nominate(slug, handle.trim(), name.trim() || undefined);
      const msg = RESULT_TEXT[r.result] ?? { text: "Done.", good: true };
      setFormResult(msg);
      if (r.result === "created_pending" || r.result === "upvoted" || r.result === "already_upvoted") {
        setHandle("");
        setName("");
      }
      if (r.result === "upvoted" || r.result === "created_pending") load();
    } catch (e) {
      setFormResult({
        text:
          e instanceof ApiError && e.status === 429
            ? "You have added a lot of places today. Try again tomorrow."
            : e instanceof ApiError && e.status === 409
              ? RESULT_TEXT.closed.text
              : errorMessage(e),
        good: false,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={embedded ? "w-full" : "mx-auto w-full max-w-xl px-4 py-6"}>
      {embedded ? null : (
        <>
          <h1 className="display text-4xl">Nominate</h1>
          <p className="mt-3 text-lg text-muted">
            Local Charlotte area {category} places only. No national chains.
          </p>
        </>
      )}
      {closed ? (
        <p role="status" className="mt-4 rounded-xl border-2 border-accent bg-panel px-4 py-3">
          Nominations are closed. You can still browse the list.
        </p>
      ) : null}

      <section aria-labelledby="list-h" className={embedded ? "" : "mt-8"}>
        <h2 id="list-h" className="display text-3xl">
          The list
        </h2>
        <p className="mt-2 font-bold" aria-live="polite">
          You have {votesLeft} of {VOTES_PER_VOTER} votes left. Pick your favorites.
        </p>
        {shareRow ? (
          <div className="panel mt-3 flex flex-col gap-2 p-4">
            <p className="font-bold">You upvoted {shareRow.displayName}. Tell your followers.</p>
            <StoryButton
              entrantId={shareRow.id}
              handle={shareRow.igHandle}
              url={`/p/${encodeURIComponent(shareRow.igHandle)}`}
              title={`Vote for ${shareRow.displayName}`}
              label="Share on your story"
            />
          </div>
        ) : null}
        <label htmlFor="search" className="sr-only">
          Search places
        </label>
        <input
          id="search"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCapitalize="none"
          placeholder="Search by name or @handle"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field mt-3"
        />
        <div aria-live="polite" className="mt-3">
          {rowNotice ? (
            <p role="alert" className="rounded-xl border-2 border-accent bg-panel px-4 py-3">
              {rowNotice}
            </p>
          ) : null}
        </div>
        <div className="mt-3">
          {error ? (
            <ErrorBlock message={error} onRetry={() => load()} />
          ) : !entrants ? (
            <LoadingBlock label="Loading the list" />
          ) : filtered.length === 0 ? (
            <p className="panel p-5 text-muted">
              {entrants.length === 0
                ? "No places yet. Be the first to add one below."
                : "No match. Add it below if it is missing."}
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {filtered.map((row, i) => (
                <li
                  key={row.id}
                  id={`place-${row.igHandle}`}
                  style={{ background: i % 2 === 0 ? "#fde6e3" : "#fffdf8", border: "2px solid #f82d26" }}
                  className={`panel flex min-h-14 scroll-mt-24 flex-wrap items-center gap-3 border-2 border-accent p-2.5 ${focus === row.igHandle ? "outline outline-4 outline-offset-2 outline-accent" : ""}`}
                >
                  <PlaceLogo handle={row.igHandle} name={row.displayName} size={44} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/p/${encodeURIComponent(row.igHandle)}`}
                      aria-label={`${row.displayName}: open the place page`}
                      className="block truncate text-base font-bold hover:underline"
                    >
                      {row.displayName}
                    </Link>
                    <a
                      href={instagramUrl(row.igHandle)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`@${row.igHandle} on Instagram (opens in a new tab)`}
                      className="block truncate text-sm text-muted underline decoration-line underline-offset-2 hover:text-chalk"
                    >
                      @{row.igHandle}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => void upvote(row)}
                    disabled={row.upvotedByMe || closed || pending.has(row.id) || votesLeft === 0}
                    aria-label={
                      row.upvotedByMe
                        ? `You upvoted ${row.displayName}. ${row.upvoteCount} upvotes`
                        : `Upvote ${row.displayName}. ${row.upvoteCount} upvotes so far`
                    }
                    className={`btn min-w-20 flex-col gap-1 ${row.upvotedByMe || votesLeft === 0 ? "btn-ghost" : "btn-primary"}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3l9 16H3z" />
                      </svg>
                      <span className="text-xl tabular-nums">{row.upvoteCount}</span>
                    </span>
                    <span className="text-xs tracking-widest">{row.upvotedByMe ? "Upvoted" : "Upvote"}</span>
                  </button>
                  <div className="flex basis-full justify-center">
                    <StoryButton
                      compact
                      entrantId={row.id}
                      handle={row.igHandle}
                      url={`/p/${encodeURIComponent(row.igHandle)}`}
                      title={`Vote for ${row.displayName}`}
                      label="Share to story"
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <section aria-labelledby="add-h" className="panel mt-8 p-4">
        <h2 id="add-h" className="display text-3xl">
          Add a place
        </h2>
        <p className="mt-2 text-muted">
          Paste its Instagram handle or profile link. Only local Charlotte area {category} spots, no national chains.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="handle" className="mb-1 block font-semibold">
              Instagram handle or profile link
            </label>
            <input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@name or instagram.com/name"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              inputMode="url"
              required
              className="field"
            />
          </div>
          <div>
            <label htmlFor="pname" className="mb-1 block font-semibold">
              Place name <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name as people know it"
              maxLength={80}
              autoComplete="off"
              className="field"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting || closed || !handle.trim()}>
            {submitting ? "Adding..." : "Add this place"}
          </button>
          <div aria-live="polite">
            {formResult ? (
              <p
                role="status"
                className={`rounded-xl border-2 px-4 py-3 ${formResult.good ? "border-accent" : "border-line"} bg-ink`}
              >
                {formResult.text}
              </p>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

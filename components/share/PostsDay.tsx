import { CopyButton } from "./CopyButton";
import { ImageCard } from "./ImageCard";
import { fmtDayLong, fmtClock, type PostsSection, type ShareTournament } from "@/lib/share/posts";

const statusLabel = { scheduled: "Not started", open: "Open now", closed: "Finished" } as const;

const dateStamp = (iso: string) => iso.slice(0, 10);

/** One game day on the "Today's posts" page. Server component; the buttons inside are client components. */
export function PostsDay({
  section,
  tournament,
  voteUrl,
  v,
}: {
  section: PostsSection;
  tournament: ShareTournament;
  voteUrl: string;
  /** Cache buster so previews are never ten minutes stale. */
  v: number;
}) {
  const { day } = section;
  const t = tournament.id;
  const base = tournament.slug;
  const q = (path: string, params: Record<string, string>) =>
    `/api/og/${path}?${new URLSearchParams({ ...params, v: String(v) }).toString()}`;
  const dayQs = { t, day: day.key };
  const stamp = dateStamp(day.opensAt);
  const closed = day.status === "closed";

  const entrants = new Map<string, { id: string; handle: string; name: string }>();
  for (const m of day.matchups) {
    for (const e of [m.a, m.b]) if (e) entrants.set(e.id, { id: e.id, handle: e.igHandle, name: e.displayName });
  }

  return (
    <section className="space-y-5 rounded-xl border border-neutral-300 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{section.title}</p>
          <h2 className="text-xl font-bold">{fmtDayLong(day.opensAt)}</h2>
          <p className="text-sm text-neutral-600">
            {day.roundNames.join(", ")} · {day.matchups.length} matchup{day.matchups.length === 1 ? "" : "s"} · opens{" "}
            {fmtClock(day.opensAt)} ET
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-200 px-3 py-1 text-sm font-semibold">{statusLabel[day.status]}</span>
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-xs md:mx-0">
          {closed ? (
            <ImageCard
              src={q("results", dayQs)}
              fileName={`${base}-results-${stamp}.png`}
              label="Results (feed post)"
              ratio={1080 / 1350}
              priority
            />
          ) : (
            <ImageCard
              src={q("day", dayQs)}
              fileName={`${base}-todays-matchups-${stamp}.png`}
              label="Today's matchups (story)"
              ratio={1080 / 1920}
              priority
            />
          )}
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="font-bold">Voting link</h3>
            <p className="break-all rounded-lg bg-neutral-100 px-3 py-2 text-sm">{voteUrl}</p>
            <CopyButton text={voteUrl} label="Copy voting link" className="w-full sm:w-auto" />
          </div>

          <div className="space-y-2">
            <h3 className="font-bold">Handles to tag</h3>
            {section.tags.length === 0 ? (
              <p className="text-sm text-neutral-600">No restaurants decided for this day yet.</p>
            ) : (
              <>
                <ul className="flex flex-wrap gap-2">
                  {section.tags.map((tag) => (
                    <li key={tag}>
                      <CopyButton text={tag} label={tag} className="min-h-10 px-3 text-sm" />
                    </li>
                  ))}
                </ul>
                <CopyButton text={section.tags.join(" ")} label={`Copy all (${section.tags.length})`} className="w-full sm:w-auto" />
              </>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="font-bold">Caption{section.captions.length > 1 ? "s" : ""}</h3>
            {section.captions.length > 1 && (
              <p className="text-sm text-neutral-600">
                Instagram allows 20 @ mentions per caption, so this day is split into {section.captions.length} captions.
              </p>
            )}
            {section.captions.map((c, i) => (
              <div key={i} className="space-y-2">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-3 font-sans text-sm">{c}</pre>
                <CopyButton
                  text={c}
                  label={section.captions.length > 1 ? `Copy caption ${i + 1} of ${section.captions.length}` : "Copy caption"}
                  className="w-full sm:w-auto"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-neutral-200 p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Matchup stories ({day.matchups.length})
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4">
          {day.matchups.map((m) => (
            <ImageCard
              key={m.id}
              src={q("matchup", { id: m.id })}
              fileName={`${base}-story-${m.a?.igHandle ?? "tbd"}-vs-${m.b?.igHandle ?? "tbd"}.png`}
              label={`${m.a?.displayName ?? "TBD"} vs ${m.b?.displayName ?? "TBD"}`}
              ratio={1080 / 1920}
            />
          ))}
        </div>
      </details>

      <details className="rounded-lg border border-neutral-200 p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Carousel slides ({day.matchups.length})
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4">
          {day.matchups.map((m, i) => (
            <ImageCard
              key={m.id}
              src={q("slide", { id: m.id })}
              fileName={`${base}-slide-${String(i + 1).padStart(2, "0")}-${m.a?.igHandle ?? "tbd"}-vs-${m.b?.igHandle ?? "tbd"}.png`}
              label={`Slide ${i + 1}`}
              ratio={1080 / 1350}
            />
          ))}
        </div>
      </details>

      {entrants.size > 0 && (
        <details className="rounded-lg border border-neutral-200 p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            Restaurant graphics ({entrants.size})
          </summary>
          <p className="pt-2 text-sm text-neutral-600">Send these to the restaurants so they can share their own matchup.</p>
          <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4">
            {[...entrants.values()].map((e) => (
              <ImageCard
                key={e.id}
                src={q("entrant", { id: e.id })}
                fileName={`${base}-vote-for-${e.handle}.png`}
                label={e.name}
                ratio={1080 / 1920}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

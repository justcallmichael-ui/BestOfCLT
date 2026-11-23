/* JSX for the share graphics. Rendered by next/og (satori): every element with more than one child
   must be display:flex, and only the default bundled font is available. Colors come from `palette`. */
import type { ReactElement, ReactNode } from "react";
import { brand, palette as p } from "@/lib/config";
import { atHandle } from "@/lib/handles";
import type { PublicEntrant } from "@/lib/services/bracket";
import {
  fmtClock,
  fmtDayLong,
  fmtDayShort,
  fmtWeekday,
  matchupResult,
  type EntrantShare,
  type ShareDay,
  type ShareMatchup,
} from "@/lib/share/posts";

export const SIZES = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
  og: { width: 1200, height: 630 },
} as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function nameSize(name: string, big: number): number {
  const n = name.length;
  if (n <= 14) return big;
  if (n <= 20) return Math.round(big * 0.85);
  if (n <= 28) return Math.round(big * 0.7);
  return Math.round(big * 0.58);
}

const whenOpens = (iso: string) => `Voting opens ${fmtWeekday(iso)} at ${fmtClock(iso)} ET`;

type CardState = "normal" | "winner" | "loser";

function SeedBadge({ seed, size, inverted }: { seed: number | null; size: number; inverted: boolean }) {
  if (seed == null) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        flexShrink: 0,
        background: inverted ? p.accentText : p.accent,
        color: inverted ? p.accent : p.accentText,
        fontSize: Math.round(size * 0.5),
      }}
    >
      {String(seed)}
    </div>
  );
}

function PlaceCard({
  e,
  state,
  votes,
  height,
  nameBase,
  handleSize,
  badge,
}: {
  e: PublicEntrant | null;
  state: CardState;
  votes: number | null;
  height: number;
  nameBase: number;
  handleSize: number;
  badge: number;
}) {
  const winner = state === "winner";
  const fg = winner ? p.accentText : state === "loser" ? p.muted : p.text;
  const sub = winner ? p.accentText : p.muted;
  const name = e ? clip(e.displayName, 36) : "TBD";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        height,
        padding: "0 40px",
        gap: 32,
        borderRadius: 36,
        background: winner ? p.accent : p.panel,
        border: `4px solid ${winner ? p.accent : p.muted}`,
        color: fg,
      }}
    >
      <SeedBadge seed={e?.seed ?? null} size={badge} inverted={winner} />
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <div style={{ display: "flex", fontSize: nameSize(name, nameBase), lineHeight: 1.05 }}>{name}</div>
        <div style={{ display: "flex", marginTop: 10, fontSize: handleSize, color: sub }}>
          {e ? atHandle(e.igHandle) : "Winner of an earlier game"}
        </div>
      </div>
      {votes != null ? (
        <div style={{ display: "flex", fontSize: Math.round(nameBase * 1.3), flexShrink: 0 }}>{String(votes)}</div>
      ) : null}
    </div>
  );
}

function Header({ title, sub, top }: { title: string; sub?: string; top: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: top }}>
      <div style={{ display: "flex", fontSize: 44, letterSpacing: 8, textTransform: "uppercase", color: p.accent }}>
        {brand.name}
      </div>
      <div style={{ display: "flex", marginTop: 26, fontSize: 76, textTransform: "uppercase", letterSpacing: 2 }}>
        {title}
      </div>
      {sub ? <div style={{ display: "flex", marginTop: 12, fontSize: 40, color: p.muted }}>{sub}</div> : null}
    </div>
  );
}

function Frame({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: w,
        height: h,
        padding: "0 60px",
        background: p.background,
        color: p.text,
      }}
    >
      {children}
    </div>
  );
}

// ---------- Matchup (story and feed slide) ----------

export function MatchupArt({ m, format }: { m: ShareMatchup; format: "story" | "slide" }): ReactElement {
  const story = format === "story";
  const { width, height } = story ? SIZES.story : SIZES.feed;
  const res = matchupResult(m);
  const closed = m.status === "closed";
  const stateOf = (id: string | undefined): CardState =>
    !closed || !res || !id ? "normal" : id === res.winner.id ? "winner" : "loser";
  const cardH = story ? 290 : 270;
  const status =
    m.status === "scheduled"
      ? whenOpens(m.opensAt)
      : m.status === "open"
        ? "Vote now"
        : res
          ? `Final: ${res.winnerVotes} to ${res.loserVotes}`
          : "Final";
  const statusSub =
    m.status === "open" ? `Closes ${fmtWeekday(m.closesAt)} at ${fmtClock(m.closesAt)} ET` : undefined;
  return (
    <Frame w={width} h={height}>
      <Header title={m.roundName} top={story ? 170 : 80} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: story ? 60 : 36 }}>
        <PlaceCard
          e={m.a}
          state={stateOf(m.a?.id)}
          votes={closed ? m.votesA : null}
          height={cardH}
          nameBase={story ? 80 : 72}
          handleSize={36}
          badge={story ? 96 : 88}
        />
        <div
          style={{
            display: "flex",
            fontSize: story ? 110 : 80,
            color: p.accent,
            letterSpacing: 6,
            padding: story ? "24px 0" : "10px 0",
          }}
        >
          VS
        </div>
        <PlaceCard
          e={m.b}
          state={stateOf(m.b?.id)}
          votes={closed ? m.votesB : null}
          height={cardH}
          nameBase={story ? 80 : 72}
          handleSize={36}
          badge={story ? 96 : 88}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: story ? 56 : 36 }}>
        <div
          style={{
            display: "flex",
            fontSize: m.status === "open" ? 76 : 52,
            textTransform: m.status === "open" ? "uppercase" : "none",
            color: m.status === "open" ? p.accent : p.text,
            textAlign: "center",
          }}
        >
          {status}
        </div>
        {statusSub ? (
          <div style={{ display: "flex", marginTop: 10, fontSize: 34, color: p.muted }}>{statusSub}</div>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------- Day (story) ----------

function CompactSide({ e, align }: { e: PublicEntrant | null; align: "left" | "right" }) {
  const name = e ? clip(e.displayName, 26) : "TBD";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 420,
        alignItems: align === "left" ? "flex-start" : "flex-end",
      }}
    >
      <div style={{ display: "flex", fontSize: nameSize(name, 40) - 4 }}>
        {e && e.seed != null ? `${e.seed}  ${name}` : name}
      </div>
      <div style={{ display: "flex", fontSize: 28, color: p.muted, marginTop: 4 }}>
        {e ? atHandle(e.igHandle) : "to be decided"}
      </div>
    </div>
  );
}

export function DayArt({ day }: { day: ShareDay }): ReactElement {
  const n = Math.max(1, day.matchups.length);
  const rowH = Math.max(72, Math.min(140, Math.floor(1100 / n)));
  return (
    <Frame w={SIZES.story.width} h={SIZES.story.height}>
      <Header title="Today's matchups" sub={`${fmtDayLong(day.opensAt)}  ·  ${day.roundNames.join(", ")}`} top={170} />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56, gap: 14 }}>
        {day.matchups.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              height: rowH,
              padding: "0 28px",
              borderRadius: 24,
              background: p.panel,
            }}
          >
            <CompactSide e={m.a} align="left" />
            <div style={{ display: "flex", fontSize: 30, color: p.accent }}>VS</div>
            <CompactSide e={m.b} align="right" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ---------- Results (feed) ----------

export function ResultsArt({ day }: { day: ShareDay }): ReactElement {
  const decided = day.matchups.filter((m) => matchupResult(m));
  const n = Math.max(1, decided.length);
  const rowH = Math.max(84, Math.min(150, Math.floor(860 / n)));
  return (
    <Frame w={SIZES.feed.width} h={SIZES.feed.height}>
      <Header title="Results" sub={`${day.roundNames.join(", ")}  ·  ${fmtDayShort(day.closesAt)}`} top={70} />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 40, gap: 12 }}>
        {decided.map((m) => {
          const r = matchupResult(m)!;
          const w = clip(r.winner.displayName, 24);
          const l = clip(r.loser.displayName, 24);
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: rowH,
                padding: "0 28px",
                borderRadius: 22,
                background: p.panel,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ display: "flex", fontSize: nameSize(w, 42), color: p.text }}>
                  {r.winner.seed != null ? `${r.winner.seed}  ${w}` : w}
                </div>
                <div style={{ display: "flex", fontSize: 28, color: p.muted, marginTop: 4 }}>
                  {`def. ${r.loser.seed != null ? `${r.loser.seed}  ` : ""}${l}`}
                </div>
              </div>
              <div style={{ display: "flex", fontSize: 42, color: p.accent, flexShrink: 0, marginLeft: 20 }}>
                {`${r.winnerVotes} to ${r.loserVotes}`}
              </div>
            </div>
          );
        })}
        {decided.length === 0 ? (
          <div style={{ display: "flex", fontSize: 40, color: p.muted }}>No final scores yet.</div>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------- Entrant (story and link preview) ----------

function entrantStatusLine(v: EntrantShare): { text: string; sub?: string; live: boolean } {
  const c = v.current;
  if (v.champion) return { text: "Champion", live: false };
  if (c && c.matchup.status === "open") {
    return { text: "Vote now", sub: `Closes ${fmtWeekday(c.matchup.closesAt)} at ${fmtClock(c.matchup.closesAt)} ET`, live: true };
  }
  if (c) return { text: whenOpens(c.matchup.opensAt), live: false };
  if (v.eliminated) return { text: "Thanks for voting", live: false };
  return { text: "Bracket coming soon", live: false };
}

export function EntrantArt({ v, format }: { v: EntrantShare; format: "story" | "og" }): ReactElement {
  const story = format === "story";
  const { width, height } = story ? SIZES.story : SIZES.og;
  const name = clip(v.entrant.displayName, 40);
  const st = entrantStatusLine(v);
  const c = v.current;
  const opp = c?.opponent ?? null;
  const oppLine = c
    ? `vs ${opp ? `${opp.seed != null ? `(${opp.seed}) ` : ""}${clip(opp.displayName, 30)}` : "TBD"}`
    : "";
  if (!story) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width,
          height,
          padding: "0 70px",
          background: p.background,
          color: p.text,
        }}
      >
        <div style={{ display: "flex", fontSize: 32, letterSpacing: 6, textTransform: "uppercase", color: p.accent }}>
          {brand.name}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontSize: 40, color: p.muted }}>Vote for</div>
        <div style={{ display: "flex", fontSize: nameSize(name, 108), textTransform: "uppercase", lineHeight: 1.05 }}>
          {name}
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 38, color: p.muted }}>
          {`${atHandle(v.entrant.igHandle)}${v.entrant.seed != null ? `${v.entrant.igHandle.startsWith("noig-") ? "" : "  ·  "}Seed ${v.entrant.seed}` : ""}`}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            padding: "18px 28px",
            borderRadius: 20,
            background: p.panel,
            fontSize: 38,
            color: st.live ? p.accent : p.text,
          }}
        >
          {c ? `${oppLine}  ·  ${st.text}` : st.text}
        </div>
      </div>
    );
  }
  const nominating = !c && !v.champion && !v.eliminated && v.tournament.status === "nominations";
  const host = brand.siteUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return (
    <Frame w={width} h={height}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 280 }}>
        <div style={{ display: "flex", fontSize: 44, letterSpacing: 8, textTransform: "uppercase", color: p.accent }}>
          {brand.name}
        </div>
        <div style={{ display: "flex", marginTop: 70, fontSize: 64, color: p.muted }}>Vote for</div>
        <div
          style={{
            display: "flex",
            marginTop: 10,
            fontSize: nameSize(name, 130),
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.05,
          }}
        >
          {name}
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 40, color: p.muted }}>
          {`${atHandle(v.entrant.igHandle)}${v.entrant.seed != null ? `${v.entrant.igHandle.startsWith("noig-") ? "" : "  ·  "}Seed ${v.entrant.seed}` : ""}`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 60 }}>
        {c ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
            <div style={{ display: "flex", fontSize: 40, color: p.muted }}>{c.matchup.roundName}</div>
            <div
              style={{
                display: "flex",
                marginTop: 16,
                padding: "26px 36px",
                borderRadius: 28,
                background: p.panel,
                fontSize: nameSize(oppLine, 56),
                textAlign: "center",
              }}
            >
              {oppLine}
            </div>
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            marginTop: c ? 36 : 0,
            fontSize: st.live ? 76 : 48,
            textTransform: st.live ? "uppercase" : "none",
            color: st.live ? p.accent : p.text,
            textAlign: "center",
          }}
        >
          {nominating ? `Nominated for ${clip(v.tournament.name, 40)}` : st.text}
        </div>
        {st.sub ? <div style={{ display: "flex", marginTop: 10, fontSize: 34, color: p.muted }}>{st.sub}</div> : null}
        <div
          style={{
            display: "flex",
            marginTop: 90,
            padding: "30px 60px",
            borderRadius: 999,
            background: p.accent,
            color: "#ffffff",
            fontSize: 64,
            textTransform: "uppercase",
            letterSpacing: 2,
          }}
        >
          Tap to vote
        </div>
        <div style={{ display: "flex", marginTop: 36, fontSize: 40, color: p.muted }}>
          {nominating ? "Takes 5 seconds. No signup." : "Takes 5 seconds."}
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 36, color: p.muted }}>{`${host}/p/${v.entrant.igHandle}`}</div>
      </div>
    </Frame>
  );
}

// ---------- Admin icon ----------

export function AdminIconArt({ size }: { size: number }): ReactElement {
  const letter = (brand.name.trim()[0] ?? "A").toUpperCase();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        background: p.accent,
        color: p.accentText,
        fontSize: Math.round(size * 0.56),
        textTransform: "uppercase",
      }}
    >
      {letter}
    </div>
  );
}

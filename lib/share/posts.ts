import { brand } from "@/lib/config";
import { getDb, type Db } from "@/lib/db";
import { normalizeHandle } from "@/lib/handles";
import type { MatchupCard, MatchupStatus, PublicEntrant } from "@/lib/services/bracket";

export const MAX_MENTIONS_PER_CAPTION = 20;
export const TZ = "America/New_York";

export type ShareMatchup = MatchupCard & { roundNumber: number };
export type DayStatus = "scheduled" | "open" | "closed";

export type ShareTournament = {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
};

export type ShareDay = {
  /** opens_at of the group as an ISO string. Also the grouping key. */
  key: string;
  opensAt: string;
  closesAt: string;
  status: DayStatus;
  roundNames: string[];
  matchups: ShareMatchup[];
  /** Unique handles without the @, in matchup order. */
  handles: string[];
};

// ---------- Formatting ----------

const dayLongFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });

/** "Thursday, Nov 19" in Eastern time. */
export const fmtDayLong = (d: Date | string) => dayLongFmt.format(new Date(d));
/** "Thursday" in Eastern time. */
export const fmtWeekday = (d: Date | string) => weekdayFmt.format(new Date(d));
/** "12:00 PM" in Eastern time. */
export const fmtClock = (d: Date | string) => timeFmt.format(new Date(d));
/** "Thu, Nov 19" in Eastern time. */
export const fmtDayShort = (d: Date | string) => shortFmt.format(new Date(d));

export function siteHost(siteUrl: string = brand.siteUrl): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

export function voteUrl(slug: string, siteUrl: string = brand.siteUrl): string {
  return `${siteUrl.replace(/\/+$/, "")}/t/${encodeURIComponent(slug)}/vote`;
}

/** Short link to a place: site/p/handle. Used for stories and bios. */
export function shortEntrantUrl(handle: string, siteUrl: string = brand.siteUrl): string {
  return `${siteUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(handle)}`;
}

export function entrantPageUrl(slug: string, handle: string, siteUrl: string = brand.siteUrl): string {
  return `${siteUrl.replace(/\/+$/, "")}/t/${encodeURIComponent(slug)}/p/${encodeURIComponent(handle)}`;
}

// ---------- Grouping and selection (pure) ----------

export function dayStatus(matchups: { status: MatchupStatus }[]): DayStatus {
  if (matchups.length > 0 && matchups.every((m) => m.status === "closed")) return "closed";
  if (matchups.some((m) => m.status === "open")) return "open";
  return "scheduled";
}

export function matchupHandles(matchups: MatchupCard[]): string[] {
  const out: string[] = [];
  for (const m of matchups) {
    for (const e of [m.a, m.b]) if (e && !out.includes(e.igHandle)) out.push(e.igHandle);
  }
  return out;
}

/** Groups matchups sharing the same opens_at into game days, ordered by time, then round and slot. */
export function groupGameDays(matchups: ShareMatchup[]): ShareDay[] {
  const groups = new Map<string, ShareMatchup[]>();
  for (const m of matchups) {
    const key = new Date(m.opensAt).toISOString();
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()]
    .sort((x, y) => Date.parse(x[0]) - Date.parse(y[0]))
    .map(([key, list]) => {
      const ms = [...list].sort((x, y) => x.roundNumber - y.roundNumber || x.slot - y.slot);
      const closes = Math.max(...ms.map((m) => Date.parse(m.closesAt)));
      return {
        key,
        opensAt: key,
        closesAt: new Date(closes).toISOString(),
        status: dayStatus(ms),
        roundNames: [...new Set(ms.map((m) => m.roundName))],
        matchups: ms,
        handles: matchupHandles(ms),
      };
    });
}

/**
 * Current day: the earliest day with a live matchup. Next day: the earliest day that has not started
 * and is not the current one. Last day: the finished day that closed most recently.
 */
export function pickPostDays(days: ShareDay[]): { current: ShareDay | null; next: ShareDay | null; last: ShareDay | null } {
  const current = days.find((d) => d.status === "open") ?? null;
  const next = days.find((d) => d.status === "scheduled" && d !== current) ?? null;
  const finished = days.filter((d) => d.status === "closed");
  let last: ShareDay | null = null;
  for (const d of finished) {
    if (!last || Date.parse(d.closesAt) >= Date.parse(last.closesAt)) last = d;
  }
  return { current, next, last };
}

// ---------- Captions (pure) ----------

export type CaptionLine = { text: string; mentions: number };

export function countMentions(text: string): number {
  return (text.match(/@[a-z0-9._]+/gi) ?? []).length;
}

/** Packs lines into captions with at most `limit` @ mentions each. Always returns at least one caption. */
export function splitByMentionLimit(
  intro: string,
  lines: CaptionLine[],
  outro: string,
  limit: number = MAX_MENTIONS_PER_CAPTION,
): string[] {
  const chunks: CaptionLine[][] = [];
  let cur: CaptionLine[] = [];
  let count = 0;
  for (const line of lines) {
    if (cur.length > 0 && count + line.mentions > limit) {
      chunks.push(cur);
      cur = [];
      count = 0;
    }
    cur.push(line);
    count += line.mentions;
  }
  if (cur.length > 0 || chunks.length === 0) chunks.push(cur);
  const total = chunks.length;
  return chunks.map((c, i) => {
    const head = total > 1 ? `${intro} (${i + 1}/${total})` : intro;
    return [head, ...(c.length ? ["", ...c.map((l) => l.text)] : []), "", outro].join("\n");
  });
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Captions for an upcoming or open day. Matchups with an undecided side are left out. */
export function announcementCaptions(day: ShareDay, host: string = siteHost()): string[] {
  const rounds = joinNames(day.roundNames);
  const intro =
    day.status === "open" ? `${rounds}: today's matchups are live.` : `${rounds}: ${fmtWeekday(day.opensAt)}'s matchups.`;
  const lines: CaptionLine[] = day.matchups
    .filter((m) => m.a && m.b)
    .map((m) => ({ text: `@${m.a!.igHandle} vs @${m.b!.igHandle}`, mentions: 2 }));
  return splitByMentionLimit(intro, lines, `Vote at ${host}. Link in bio.`);
}

/** Captions for a finished day: "@winner def. @loser, 123 to 98". */
export function resultsCaptions(day: ShareDay, host: string = siteHost()): string[] {
  const intro = `${joinNames(day.roundNames)} results.`;
  const lines: CaptionLine[] = [];
  for (const m of day.matchups) {
    const r = matchupResult(m);
    if (!r) continue;
    lines.push({
      text: `@${r.winner.igHandle} def. @${r.loser.igHandle}, ${r.winnerVotes} to ${r.loserVotes}`,
      mentions: 2,
    });
  }
  return splitByMentionLimit(intro, lines, `Full bracket at ${host}. Link in bio.`);
}

export function dayCaptions(day: ShareDay, host: string = siteHost()): string[] {
  return day.status === "closed" ? resultsCaptions(day, host) : announcementCaptions(day, host);
}

export type MatchupResult = {
  winner: PublicEntrant;
  loser: PublicEntrant;
  winnerVotes: number;
  loserVotes: number;
};

/** Winner and final score of a decided matchup, or null when undecided. */
export function matchupResult(m: MatchupCard): MatchupResult | null {
  if (!m.a || !m.b || !m.winnerId || m.status !== "closed") return null;
  const aWon = m.winnerId === m.a.id;
  const bWon = m.winnerId === m.b.id;
  if (!aWon && !bWon) return null;
  const va = m.votesA ?? 0;
  const vb = m.votesB ?? 0;
  return aWon
    ? { winner: m.a, loser: m.b, winnerVotes: va, loserVotes: vb }
    : { winner: m.b, loser: m.a, winnerVotes: vb, loserVotes: va };
}

// ---------- Queries ----------

type Row = {
  id: string;
  slot: number;
  region: number | null;
  status: MatchupStatus;
  opens_at: unknown;
  closes_at: unknown;
  votes_a: number | string;
  votes_b: number | string;
  winner_id: string | null;
  round_name: string;
  round_number: number;
  a_id: string | null;
  a_handle: string | null;
  a_name: string | null;
  a_seed: number | null;
  b_id: string | null;
  b_handle: string | null;
  b_name: string | null;
  b_seed: number | null;
  t_id: string;
  t_slug: string;
  t_name: string;
  t_category: string;
  t_status: string;
};

const SELECT = `select m.id, m.slot, m.region, m.status, m.opens_at, m.closes_at, m.votes_a, m.votes_b, m.winner_id,
    r.name as round_name, r.number as round_number,
    a.id as a_id, a.ig_handle as a_handle, a.display_name as a_name, a.seed as a_seed,
    b.id as b_id, b.ig_handle as b_handle, b.display_name as b_name, b.seed as b_seed,
    t.id as t_id, t.slug as t_slug, t.name as t_name, t.category as t_category, t.status as t_status
  from matchups m
  join rounds r on r.id = m.round_id
  join tournaments t on t.id = r.tournament_id
  left join entrants a on a.id = m.entrant_a_id
  left join entrants b on b.id = m.entrant_b_id`;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function toMatchup(r: Row): ShareMatchup {
  return {
    id: r.id,
    roundName: r.round_name,
    roundNumber: r.round_number,
    region: r.region,
    slot: r.slot,
    status: r.status,
    opensAt: iso(r.opens_at),
    closesAt: iso(r.closes_at),
    a: r.a_id ? { id: r.a_id, igHandle: r.a_handle!, displayName: r.a_name!, seed: r.a_seed } : null,
    b: r.b_id ? { id: r.b_id, igHandle: r.b_handle!, displayName: r.b_name!, seed: r.b_seed } : null,
    votesA: r.status === "scheduled" ? null : Number(r.votes_a),
    votesB: r.status === "scheduled" ? null : Number(r.votes_b),
    winnerId: r.winner_id,
  };
}

function toTournament(r: Row): ShareTournament {
  return { id: r.t_id, slug: r.t_slug, name: r.t_name, category: r.t_category, status: r.t_status };
}

const ORDER = ` order by r.number, m.slot`;

export async function getShareTournament(id: string, dbArg?: Db): Promise<ShareTournament | null> {
  const db = dbArg ?? getDb();
  const [t] = await db.query<{ id: string; slug: string; name: string; category: string; status: string }>(
    `select id, slug, name, category, status from tournaments where id = $1`,
    [id],
  );
  return t ?? null;
}

export async function getShareTournamentBySlug(slug: string, dbArg?: Db): Promise<ShareTournament | null> {
  const db = dbArg ?? getDb();
  const [t] = await db.query<{ id: string; slug: string; name: string; category: string; status: string }>(
    `select id, slug, name, category, status from tournaments where slug = $1`,
    [slug],
  );
  return t ?? null;
}

/** Every matchup of a tournament in bracket order. */
export async function loadShareMatchups(tournamentId: string, dbArg?: Db): Promise<ShareMatchup[]> {
  const db = dbArg ?? getDb();
  const rows = await db.query<Row>(`${SELECT} where r.tournament_id = $1${ORDER}`, [tournamentId]);
  return rows.map(toMatchup);
}

export async function loadShareDays(tournamentId: string, dbArg?: Db): Promise<ShareDay[]> {
  return groupGameDays(await loadShareMatchups(tournamentId, dbArg));
}

export async function getMatchupShare(
  id: string,
  dbArg?: Db,
): Promise<{ tournament: ShareTournament; matchup: ShareMatchup } | null> {
  const db = dbArg ?? getDb();
  const [row] = await db.query<Row>(`${SELECT} where m.id = $1`, [id]);
  return row ? { tournament: toTournament(row), matchup: toMatchup(row) } : null;
}

/** One game day: all matchups of the tournament with this opens_at. */
export async function getDayShare(
  tournamentId: string,
  opensAt: string,
  dbArg?: Db,
): Promise<{ tournament: ShareTournament; day: ShareDay } | null> {
  const db = dbArg ?? getDb();
  const rows = await db.query<Row>(
    `${SELECT} where r.tournament_id = $1 and m.opens_at = $2::timestamptz${ORDER}`,
    [tournamentId, opensAt],
  );
  if (rows.length === 0) return null;
  const [day] = groupGameDays(rows.map(toMatchup));
  return { tournament: toTournament(rows[0]), day };
}

export type EntrantShare = {
  tournament: ShareTournament;
  entrant: PublicEntrant & { status: string };
  /** Open matchup if any, else the next scheduled one. */
  current: { matchup: ShareMatchup; opponent: PublicEntrant | null; side: "a" | "b" } | null;
  /** Closed matchups, oldest first. */
  results: { matchup: ShareMatchup; opponent: PublicEntrant | null; won: boolean; votesFor: number; votesAgainst: number }[];
  eliminated: boolean;
  champion: boolean;
};

async function buildEntrantShare(
  db: Db,
  e: { id: string; tournament_id: string; ig_handle: string; display_name: string; seed: number | null; status: string },
): Promise<EntrantShare | null> {
  const [t] = await db.query<{ id: string; slug: string; name: string; category: string; status: string }>(
    `select id, slug, name, category, status from tournaments where id = $1`,
    [e.tournament_id],
  );
  if (!t) return null;
  const rows = await db.query<Row>(
    `${SELECT} where (m.entrant_a_id = $1 or m.entrant_b_id = $1)${ORDER}`,
    [e.id],
  );
  const ms = rows.map(toMatchup);
  const sideOf = (m: ShareMatchup): "a" | "b" => (m.a?.id === e.id ? "a" : "b");
  const opp = (m: ShareMatchup) => (sideOf(m) === "a" ? m.b : m.a);

  const open = ms.find((m) => m.status === "open");
  const scheduled = ms
    .filter((m) => m.status === "scheduled")
    .sort((x, y) => Date.parse(x.opensAt) - Date.parse(y.opensAt))[0];
  const cur = open ?? scheduled ?? null;

  const results = ms
    .filter((m) => m.status === "closed")
    .sort((x, y) => Date.parse(x.closesAt) - Date.parse(y.closesAt))
    .map((m) => {
      const side = sideOf(m);
      const mine = (side === "a" ? m.votesA : m.votesB) ?? 0;
      const theirs = (side === "a" ? m.votesB : m.votesA) ?? 0;
      return { matchup: m, opponent: opp(m), won: m.winnerId === e.id, votesFor: mine, votesAgainst: theirs };
    });
  const lost = results.some((r) => !r.won);
  const last = ms[ms.length - 1];
  const champion = !!last && last.status === "closed" && last.winnerId === e.id && last.roundName === "Championship";

  return {
    tournament: { id: t.id, slug: t.slug, name: t.name, category: t.category, status: t.status },
    entrant: { id: e.id, igHandle: e.ig_handle, displayName: e.display_name, seed: e.seed, status: e.status },
    current: cur ? { matchup: cur, opponent: opp(cur), side: sideOf(cur) } : null,
    results,
    eliminated: lost && !cur,
    champion,
  };
}

const ENTRANT_COLS = `id, tournament_id, ig_handle, display_name, seed, status`;
type EntrantDb = { id: string; tournament_id: string; ig_handle: string; display_name: string; seed: number | null; status: string };

/** Approved entrants only. Returns null for unknown or non approved ids. */
export async function getEntrantShareById(id: string, dbArg?: Db): Promise<EntrantShare | null> {
  const db = dbArg ?? getDb();
  const [e] = await db.query<EntrantDb>(`select ${ENTRANT_COLS} from entrants where id = $1 and status = 'approved'`, [id]);
  return e ? buildEntrantShare(db, e) : null;
}

/** Approved entrants only. The handle is normalized first. */
export async function getEntrantShareByHandle(slug: string, handle: string, dbArg?: Db): Promise<EntrantShare | null> {
  const h = normalizeHandle(handle);
  if (!h) return null;
  const db = dbArg ?? getDb();
  const [e] = await db.query<EntrantDb>(
    `select e.id, e.tournament_id, e.ig_handle, e.display_name, e.seed, e.status
     from entrants e join tournaments t on t.id = e.tournament_id
     where t.slug = $1 and e.ig_handle = $2 and e.status = 'approved'`,
    [slug, h],
  );
  return e ? buildEntrantShare(db, e) : null;
}

// ---------- Admin page data ----------

export type PostsSection = {
  kind: "current" | "next" | "last";
  title: string;
  day: ShareDay;
  captions: string[];
  /** Handles with a leading @. */
  tags: string[];
};

export type PostsData = {
  tournament: ShareTournament;
  voteUrl: string;
  host: string;
  sections: PostsSection[];
};

const TITLES = { current: "Current game day", next: "Next game day", last: "Last finished game day" } as const;

/** Everything the "Today's posts" page needs. Returns null for an unknown tournament. */
export async function getPostsData(tournamentId: string, dbArg?: Db): Promise<PostsData | null> {
  const db = dbArg ?? getDb();
  const tournament = await getShareTournament(tournamentId, db);
  if (!tournament) return null;
  const days = await loadShareDays(tournamentId, db);
  const { current, next, last } = pickPostDays(days);
  const host = siteHost();
  const sections: PostsSection[] = [];
  for (const [kind, day] of [["current", current], ["next", next], ["last", last]] as const) {
    if (!day) continue;
    sections.push({
      kind,
      title: TITLES[kind],
      day,
      captions: dayCaptions(day, host),
      tags: day.handles.map((h) => `@${h}`),
    });
  }
  return { tournament, voteUrl: voteUrl(tournament.slug), host, sections };
}

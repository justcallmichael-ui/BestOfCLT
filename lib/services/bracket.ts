import { getDb, type Db } from "@/lib/db";
import { buildSchedule, nextNoonEastern } from "@/lib/services/schedule";

export { nextNoonEastern };

export type PublicEntrant = { id: string; igHandle: string; displayName: string; seed: number | null };

export type MatchupStatus = "scheduled" | "open" | "closed";

export type MatchupCard = {
  id: string;
  roundName: string;
  region: number | null;
  slot: number;
  status: MatchupStatus;
  opensAt: string;
  closesAt: string;
  a: PublicEntrant | null;
  b: PublicEntrant | null;
  votesA: number | null;
  votesB: number | null;
  winnerId: string | null;
};

export type TournamentState = {
  tournament: {
    slug: string;
    name: string;
    category: string;
    status: string;
    fieldSize: number;
    nominationsCloseAt: string | null;
  };
  currentRound: { id: string; number: number; name: string; closesAt: string } | null;
  champion: PublicEntrant | null;
  live: MatchupCard[];
  upNext: MatchupCard[];
  latestResults: MatchupCard[];
  nextOpensAt: string | null;
};

export type BracketView = {
  rounds: {
    number: number;
    name: string;
    status: string;
    opensAt: string;
    closesAt: string;
    matchups: {
      id: string;
      slot: number;
      region: number | null;
      status: MatchupStatus;
      opensAt: string;
      closesAt: string;
      a: PublicEntrant | null;
      b: PublicEntrant | null;
      votesA: number | null;
      votesB: number | null;
      winnerId: string | null;
    }[];
  }[];
};

/** One entry per round that had matchups closed during a call. */
export type AdvanceResult = {
  tournamentId: string;
  closedRoundId: string;
  closedRoundNumber: number;
  /** Matchups closed and decided in this round during the call. */
  decided: number;
  nextRoundNumber: number | null;
  completed: boolean;
  championId: string | null;
};

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

/** Standard bracket order. Index i is the bracket position, value is the seed. Pairs are (2k, 2k+1). */
export function seedPositions(n: number): number[] {
  if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`seedPositions needs a power of two of at least 2, got ${n}`);
  }
  let order = [1];
  while (order.length < n) {
    const total = order.length * 2;
    order = order.flatMap((s) => [s, total + 1 - s]);
  }
  return order;
}

/** Largest of 64, 32, 16 that fits both the configured field size and the approved count. */
export function selectFieldSize(approvedCount: number, configuredFieldSize: number): number {
  const limit = Math.min(configuredFieldSize, approvedCount);
  for (const size of [64, 32, 16]) {
    if (size <= limit) return size;
  }
  throw new Error(
    `Need at least 16 approved entrants to start the bracket (have ${approvedCount}, field size ${configuredFieldSize})`,
  );
}

/** Round name from the number of matchups in the round. */
export function roundName(matchupCount: number): string {
  const names: Record<number, string> = {
    32: "Round of 64",
    16: "Round of 32",
    8: "Sweet 16",
    4: "Elite 8",
    2: "Final Four",
    1: "Championship",
  };
  return names[matchupCount] ?? `Round of ${matchupCount * 2}`;
}

function regionFor(slot: number, matchupCount: number): number | null {
  if (matchupCount < 4) return null;
  return Math.floor((slot * 4) / matchupCount) + 1;
}

export async function lockSeedingAndStart(
  tournamentId: string,
  now: Date,
  startAt?: Date,
  dbArg?: Db,
): Promise<{ tournamentId: string; fieldSize: number; rounds: number; startsAt: string }> {
  const db = dbArg ?? getDb();
  const start = startAt ?? nextNoonEastern(now);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid start time");
  return db.tx(async (t) => {
    const claimed = await t.query<{ field_size: number }>(
      `update tournaments set status = 'bracket', bracket_starts_at = $2::timestamptz
       where id = $1 and status = 'nominations'
       returning field_size`,
      [tournamentId, start.toISOString()],
    );
    if (claimed.length === 0) {
      throw new Error("Tournament not found or not in the nominations phase");
    }
    const configured = claimed[0].field_size;

    const approved = await t.query<{ id: string }>(
      `select id from entrants
       where tournament_id = $1 and status = 'approved'
       order by upvote_count desc, first_nominated_at asc, id asc`,
      [tournamentId],
    );
    const n = selectFieldSize(approved.length, configured);
    const field = approved.slice(0, n); // index = seed - 1
    const positions = seedPositions(n);

    for (let i = 0; i < n; i++) {
      const seed = i + 1;
      const pos = positions.indexOf(seed);
      const region = Math.floor((pos * 4) / n) + 1;
      await t.query(`update entrants set seed = $1, region = $2 where id = $3`, [seed, region, field[i].id]);
    }

    const schedule = buildSchedule(n, start);
    const totalRounds = Math.log2(n);
    for (let r = 1; r <= totalRounds; r++) {
      const count = n / 2 ** r;
      const windows = schedule.filter((s) => s.roundNumber === r);
      const opens = Math.min(...windows.map((w) => w.opensAt.getTime()));
      const closes = Math.max(...windows.map((w) => w.closesAt.getTime()));
      const [row] = await t.query<{ id: string }>(
        `insert into rounds (tournament_id, number, name, opens_at, closes_at, status)
         values ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'scheduled') returning id`,
        [tournamentId, r, roundName(count), new Date(opens).toISOString(), new Date(closes).toISOString()],
      );
      for (let s = 0; s < count; s++) {
        const a = r === 1 ? field[positions[2 * s] - 1].id : null;
        const b = r === 1 ? field[positions[2 * s + 1] - 1].id : null;
        const w = windows.find((x) => x.slot === s)!;
        await t.query(
          `insert into matchups (round_id, slot, region, entrant_a_id, entrant_b_id, opens_at, closes_at, status)
           values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, 'scheduled')`,
          [row.id, s, regionFor(s, count), a, b, w.opensAt.toISOString(), w.closesAt.toISOString()],
        );
      }
    }

    await t.query(`insert into audit_log (actor, action, details) values ('system', 'lock_seeding', $1::jsonb)`, [
      JSON.stringify({ tournamentId, fieldSize: n, rounds: totalRounds, startsAt: start.toISOString() }),
    ]);
    // Open anything that is already due.
    await advanceInTx(t, now);
    return { tournamentId, fieldSize: n, rounds: totalRounds, startsAt: start.toISOString() };
  });
}

type ClaimedMatchup = {
  id: string;
  slot: number;
  entrant_a_id: string | null;
  entrant_b_id: string | null;
  winner_id: string | null;
  decided_by: string | null;
  round_id: string;
  round_number: number;
  tournament_id: string;
};

const CLAIM_RETURNING = `returning m.id, m.slot, m.entrant_a_id, m.entrant_b_id, m.winner_id, m.decided_by,
  r.id as round_id, r.number as round_number, r.tournament_id`;

/**
 * Decides every claimed matchup (already set to closed by the caller's UPDATE) and places the
 * winners in the next round. Votes are counted from the votes table, not the cached counters.
 */
async function decideClaimed(t: Db, claimed: ClaimedMatchup[], byRound: Map<string, AdvanceResult>): Promise<void> {
  if (claimed.length === 0) return;
  const ids = claimed.map((m) => m.id);
  const counts = await t.query<{ matchup_id: string; choice: string; c: number | string }>(
    `select matchup_id, choice, count(*) as c from votes
     where matchup_id = any($1::uuid[]) and excluded = false
     group by matchup_id, choice`,
    [ids],
  );
  const tally = new Map<string, { a: number; b: number }>();
  for (const c of counts) {
    const cur = tally.get(c.matchup_id) ?? { a: 0, b: 0 };
    if (c.choice === "a") cur.a = Number(c.c);
    else cur.b = Number(c.c);
    tally.set(c.matchup_id, cur);
  }

  const entrantIds = claimed.flatMap((m) => [m.entrant_a_id, m.entrant_b_id]).filter((x): x is string => !!x);
  const info = new Map<string, { seed: number; status: string }>();
  if (entrantIds.length > 0) {
    const rows = await t.query<{ id: string; seed: number | null; status: string }>(
      `select id, seed, status from entrants where id = any($1::uuid[])`,
      [entrantIds],
    );
    for (const r of rows) info.set(r.id, { seed: r.seed ?? Number.MAX_SAFE_INTEGER, status: r.status });
  }
  const seedOf = (id: string) => info.get(id)?.seed ?? Number.MAX_SAFE_INTEGER;
  const withdrawn = (id: string) => info.get(id)?.status === "withdrawn";

  const ordered = [...claimed].sort((x, y) => x.round_number - y.round_number || x.slot - y.slot);
  for (const m of ordered) {
    const tl = tally.get(m.id) ?? { a: 0, b: 0 };
    let winner: string | null;
    let decidedBy: string | null;
    if (m.winner_id && m.decided_by === "admin_override") {
      winner = m.winner_id;
      decidedBy = "admin_override";
    } else if (!m.entrant_a_id || !m.entrant_b_id) {
      winner = m.entrant_a_id ?? m.entrant_b_id;
      decidedBy = winner ? "withdrawal" : null;
    } else if (withdrawn(m.entrant_a_id) !== withdrawn(m.entrant_b_id)) {
      winner = withdrawn(m.entrant_a_id) ? m.entrant_b_id : m.entrant_a_id;
      decidedBy = "withdrawal";
    } else if (withdrawn(m.entrant_a_id)) {
      winner = seedOf(m.entrant_a_id) <= seedOf(m.entrant_b_id) ? m.entrant_a_id : m.entrant_b_id;
      decidedBy = "withdrawal";
    } else if (tl.a !== tl.b) {
      winner = tl.a > tl.b ? m.entrant_a_id : m.entrant_b_id;
      decidedBy = "votes";
    } else {
      winner = seedOf(m.entrant_a_id) <= seedOf(m.entrant_b_id) ? m.entrant_a_id : m.entrant_b_id;
      decidedBy = "seed_tiebreak";
    }
    await t.query(
      `update matchups set votes_a = $1, votes_b = $2, winner_id = $3, decided_by = $4 where id = $5`,
      [tl.a, tl.b, winner, decidedBy, m.id],
    );
    const col = m.slot % 2 === 0 ? "entrant_a_id" : "entrant_b_id";
    const placed = await t.query<{ id: string }>(
      `update matchups set ${col} = $1
       where id = (
         select m2.id from matchups m2 join rounds r2 on r2.id = m2.round_id
         where r2.tournament_id = $2 and r2.number = $3 and m2.slot = $4
       )
       returning id`,
      [winner, m.tournament_id, m.round_number + 1, Math.floor(m.slot / 2)],
    );
    const entry = byRound.get(m.round_id) ?? {
      tournamentId: m.tournament_id,
      closedRoundId: m.round_id,
      closedRoundNumber: m.round_number,
      decided: 0,
      nextRoundNumber: null,
      completed: false,
      championId: null,
    };
    entry.decided += 1;
    if (placed.length > 0) entry.nextRoundNumber = m.round_number + 1;
    else entry.championId = winner;
    byRound.set(m.round_id, entry);
  }
}

/** Rounds mirror their matchups: earliest open, latest close, status from the matchup states. */
export async function refreshRounds(t: Db, tournamentIds: Iterable<string>): Promise<void> {
  for (const id of tournamentIds) {
    await t.query(
      `update rounds r set
         opens_at = coalesce(s.opens_at, r.opens_at),
         closes_at = coalesce(s.closes_at, r.closes_at),
         status = case
           when s.n > 0 and s.closed = s.n then 'closed'
           when s.opened > 0 or s.closed > 0 then 'open'
           else 'scheduled' end
       from (
         select round_id, count(*) as n,
           min(opens_at) as opens_at, max(closes_at) as closes_at,
           count(*) filter (where status = 'closed') as closed,
           count(*) filter (where status = 'open') as opened
         from matchups group by round_id
       ) s
       where s.round_id = r.id and r.tournament_id = $1`,
      [id],
    );
  }
}

async function completeFinished(t: Db, tournamentIds: Iterable<string>, byRound: Map<string, AdvanceResult>): Promise<void> {
  for (const id of tournamentIds) {
    const done = await t.query<{ id: string }>(
      `update tournaments tn set status = 'complete'
       where tn.id = $1 and tn.status = 'bracket'
         and exists (select 1 from rounds r where r.tournament_id = tn.id)
         and not exists (
           select 1 from matchups m join rounds r on r.id = m.round_id
           where r.tournament_id = tn.id and m.status <> 'closed')
       returning tn.id`,
      [id],
    );
    if (done.length === 0) continue;
    const [champ] = await t.query<{ winner_id: string | null }>(
      `select m.winner_id from matchups m join rounds r on r.id = m.round_id
       where r.tournament_id = $1 order by r.number desc, m.slot asc limit 1`,
      [id],
    );
    const championId = champ?.winner_id ?? null;
    for (const entry of byRound.values()) {
      if (entry.tournamentId === id && entry.nextRoundNumber === null) {
        entry.completed = true;
        entry.championId = championId;
      }
    }
    await t.query(`insert into audit_log (actor, action, details) values ('system', 'complete_tournament', $1::jsonb)`, [
      JSON.stringify({ tournamentId: id, championId }),
    ]);
  }
}

const MAX_PASSES = 20;

/** The advance step, run inside the caller's transaction. */
async function advanceInTx(t: Db, now: Date): Promise<AdvanceResult[]> {
  const byRound = new Map<string, AdvanceResult>();
  const touched = new Set<string>();
  const stamp = now.toISOString();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // 1. Claim and close every open matchup that is due. Only the caller that flips the row sees it.
    const claimed = await t.query<ClaimedMatchup>(
      `update matchups m set status = 'closed', closes_at = least(m.closes_at, $1::timestamptz)
       from rounds r, tournaments tn
       where r.id = m.round_id and tn.id = r.tournament_id and tn.status = 'bracket'
         and m.status = 'open' and m.closes_at <= $1::timestamptz
       ${CLAIM_RETURNING}`,
      [stamp],
    );
    await decideClaimed(t, claimed, byRound);
    for (const c of claimed) touched.add(c.tournament_id);

    // 2. Open scheduled matchups whose time has come and whose entrants are known.
    const opened = await t.query<{ tournament_id: string }>(
      `update matchups m set status = 'open'
       from rounds r, tournaments tn
       where r.id = m.round_id and tn.id = r.tournament_id and tn.status = 'bracket'
         and m.status = 'scheduled' and m.opens_at <= $1::timestamptz
         and m.entrant_a_id is not null and m.entrant_b_id is not null
       returning r.tournament_id`,
      [stamp],
    );
    for (const o of opened) touched.add(o.tournament_id);

    if (claimed.length === 0 && opened.length === 0) break;
  }

  // 3. Derived round fields, and completion.
  await refreshRounds(t, touched);
  await completeFinished(t, touched, byRound);
  for (const entry of byRound.values()) {
    await t.query(`insert into audit_log (actor, action, details) values ('system', 'close_matchups', $1::jsonb)`, [
      JSON.stringify({
        tournamentId: entry.tournamentId,
        roundNumber: entry.closedRoundNumber,
        decided: entry.decided,
      }),
    ]);
  }
  return [...byRound.values()].sort((x, y) => x.closedRoundNumber - y.closedRoundNumber);
}

/**
 * Closes due matchups and opens scheduled ones, repeating until nothing changes. Matchups are
 * claimed with a compare and set UPDATE, so concurrent callers never decide one twice.
 */
export async function advanceDueRounds(now: Date, dbArg?: Db): Promise<AdvanceResult[]> {
  const db = dbArg ?? getDb();
  return db.tx((t) => advanceInTx(t, now));
}

/**
 * Closes one open matchup immediately (admin override on a live game). Uses the caller's
 * transaction. Returns false when the matchup was not open.
 */
export async function closeMatchupNow(t: Db, matchupId: string, now: Date): Promise<boolean> {
  const claimed = await t.query<ClaimedMatchup>(
    `update matchups m set status = 'closed', closes_at = least(m.closes_at, $2::timestamptz)
     from rounds r
     where r.id = m.round_id and m.id = $1 and m.status = 'open'
     ${CLAIM_RETURNING}`,
    [matchupId, now.toISOString()],
  );
  if (claimed.length === 0) return false;
  const byRound = new Map<string, AdvanceResult>();
  await decideClaimed(t, claimed, byRound);
  const touched = new Set(claimed.map((c) => c.tournament_id));
  await refreshRounds(t, touched);
  await completeFinished(t, touched, byRound);
  // The winner may have been the last missing entrant of a game that is already due.
  await advanceInTx(t, now);
  return true;
}

type EntrantRow = { id: string; ig_handle: string; display_name: string; seed: number | null };
const toEntrant = (r: EntrantRow): PublicEntrant => ({
  id: r.id,
  igHandle: r.ig_handle,
  displayName: r.display_name,
  seed: r.seed,
});

export async function getTournamentState(
  slug: string,
  now: Date = new Date(),
  dbArg?: Db,
): Promise<TournamentState | null> {
  const db = dbArg ?? getDb();
  const [tn] = await db.query<{
    id: string;
    slug: string;
    name: string;
    category: string;
    status: string;
    field_size: number;
    nominations_close_at: unknown;
  }>(
    `select id, slug, name, category, status, field_size, nominations_close_at from tournaments where slug = $1`,
    [slug],
  );
  if (!tn) return null;

  const [round] = await db.query<{ id: string; number: number; name: string; closes_at: unknown }>(
    `select id, number, name, closes_at from rounds
     where tournament_id = $1 and status <> 'closed' order by number limit 1`,
    [tn.id],
  );

  let champion: PublicEntrant | null = null;
  if (tn.status === "complete") {
    const [row] = await db.query<EntrantRow>(
      `select e.id, e.ig_handle, e.display_name, e.seed
       from rounds r join matchups m on m.round_id = r.id join entrants e on e.id = m.winner_id
       where r.tournament_id = $1
       order by r.number desc, m.slot asc limit 1`,
      [tn.id],
    );
    champion = row ? toEntrant(row) : null;
  }

  const cards = await loadCards(db, tn.id);
  const nowMs = now.getTime();
  const byTime = (x: MatchupCard) => Date.parse(x.opensAt);
  const live = cards.filter((c) => c.status === "open");
  const future = cards.filter((c) => c.status === "scheduled" && byTime(c) > nowMs);
  const nextOpenMs = future.length ? Math.min(...future.map(byTime)) : null;
  const upNext = nextOpenMs === null ? [] : future.filter((c) => byTime(c) === nextOpenMs);
  const closed = cards.filter((c) => c.status === "closed");
  const lastCloseMs = closed.length ? Math.max(...closed.map((c) => Date.parse(c.closesAt))) : null;
  const latestResults = lastCloseMs === null ? [] : closed.filter((c) => Date.parse(c.closesAt) === lastCloseMs);

  return {
    tournament: {
      slug: tn.slug,
      name: tn.name,
      category: tn.category,
      status: tn.status,
      fieldSize: tn.field_size,
      nominationsCloseAt: tn.nominations_close_at ? iso(tn.nominations_close_at) : null,
    },
    currentRound: round
      ? { id: round.id, number: round.number, name: round.name, closesAt: iso(round.closes_at) }
      : null,
    champion,
    live,
    upNext,
    latestResults,
    nextOpensAt: nextOpenMs === null ? null : new Date(nextOpenMs).toISOString(),
  };
}

type CardRow = {
  id: string;
  slot: number;
  region: number | null;
  status: MatchupStatus;
  opens_at: unknown;
  closes_at: unknown;
  entrant_a_id: string | null;
  entrant_b_id: string | null;
  votes_a: number;
  votes_b: number;
  winner_id: string | null;
  round_name: string;
  round_number: number;
  round_opens_at: unknown;
  round_closes_at: unknown;
};

async function loadMatchupRows(db: Db, tournamentId: string): Promise<CardRow[]> {
  return db.query<CardRow>(
    `select m.id, m.slot, m.region, m.status, m.opens_at, m.closes_at, m.entrant_a_id, m.entrant_b_id,
            m.votes_a, m.votes_b, m.winner_id,
            r.name as round_name, r.number as round_number, r.opens_at as round_opens_at, r.closes_at as round_closes_at
     from matchups m join rounds r on r.id = m.round_id
     where r.tournament_id = $1 order by r.number, m.slot`,
    [tournamentId],
  );
}

async function loadEntrants(db: Db, tournamentId: string): Promise<Map<string, PublicEntrant>> {
  const rows = await db.query<EntrantRow>(
    `select id, ig_handle, display_name, seed from entrants where tournament_id = $1`,
    [tournamentId],
  );
  return new Map(rows.map((e) => [e.id, toEntrant(e)]));
}

function toCard(m: CardRow, entrants: Map<string, PublicEntrant>): MatchupCard {
  return {
    id: m.id,
    roundName: m.round_name,
    region: m.region,
    slot: m.slot,
    status: m.status,
    opensAt: iso(m.opens_at ?? m.round_opens_at),
    closesAt: iso(m.closes_at ?? m.round_closes_at),
    a: m.entrant_a_id ? (entrants.get(m.entrant_a_id) ?? null) : null,
    b: m.entrant_b_id ? (entrants.get(m.entrant_b_id) ?? null) : null,
    votesA: m.status === "scheduled" ? null : Number(m.votes_a),
    votesB: m.status === "scheduled" ? null : Number(m.votes_b),
    winnerId: m.winner_id,
  };
}

async function loadCards(db: Db, tournamentId: string): Promise<MatchupCard[]> {
  const [rows, entrants] = await Promise.all([loadMatchupRows(db, tournamentId), loadEntrants(db, tournamentId)]);
  return rows.map((m) => toCard(m, entrants));
}

export async function getBracket(slug: string, dbArg?: Db): Promise<BracketView | null> {
  const db = dbArg ?? getDb();
  const [tn] = await db.query<{ id: string }>(`select id from tournaments where slug = $1`, [slug]);
  if (!tn) return null;

  const rounds = await db.query<{
    id: string;
    number: number;
    name: string;
    status: string;
    opens_at: unknown;
    closes_at: unknown;
  }>(
    `select id, number, name, status, opens_at, closes_at from rounds where tournament_id = $1 order by number`,
    [tn.id],
  );
  const [rows, entrants] = await Promise.all([loadMatchupRows(db, tn.id), loadEntrants(db, tn.id)]);

  return {
    rounds: rounds.map((r) => ({
      number: r.number,
      name: r.name,
      status: r.status,
      opensAt: iso(r.opens_at),
      closesAt: iso(r.closes_at),
      matchups: rows
        .filter((m) => m.round_number === r.number)
        .map((m) => {
          const c = toCard(m, entrants);
          return {
            id: c.id,
            slot: c.slot,
            region: c.region,
            status: c.status,
            opensAt: c.opensAt,
            closesAt: c.closesAt,
            a: c.a,
            b: c.b,
            votesA: c.votesA,
            votesB: c.votesB,
            winnerId: c.winnerId,
          };
        }),
    })),
  };
}

/**
 * Earliest future moment at which any matchup of the tournament opens or closes, or null.
 * Used to size the CDN cache lifetime of the public read routes.
 */
export async function nextTransitionAt(slug: string, now: Date = new Date(), dbArg?: Db): Promise<Date | null> {
  const db = dbArg ?? getDb();
  const [row] = await db.query<{ at: unknown }>(
    `select min(t.at) as at from (
       select m.opens_at as at from matchups m join rounds r on r.id = m.round_id
         join tournaments tn on tn.id = r.tournament_id where tn.slug = $1 and m.status = 'scheduled'
       union all
       select m.closes_at as at from matchups m join rounds r on r.id = m.round_id
         join tournaments tn on tn.id = r.tournament_id where tn.slug = $1 and m.status in ('scheduled', 'open')
     ) t where t.at > $2::timestamptz`,
    [slug, now.toISOString()],
  );
  return row?.at ? new Date(row.at as string | Date) : null;
}

/** `public, s-maxage=N, stale-while-revalidate=30` with N = min(600, seconds to next transition), floor 5. */
export function scoresCacheControl(next: Date | null, now: Date = new Date()): string {
  const secs = next ? Math.ceil((next.getTime() - now.getTime()) / 1000) : 600;
  const n = Math.max(5, Math.min(600, secs));
  return `public, s-maxage=${n}, stale-while-revalidate=30`;
}

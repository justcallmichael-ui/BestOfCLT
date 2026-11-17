import { getDb, type Db } from "@/lib/db";
import { AdminError } from "@/lib/admin-auth";
import { normalizeHandle } from "@/lib/handles";
import { closeMatchupNow, lockSeedingAndStart, refreshRounds } from "@/lib/services/bracket";

export type EntrantStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: "draft" | "nominations" | "bracket" | "complete";
  field_size: number;
  round_days: number;
  nominations_open_at: Date | null;
  nominations_close_at: Date | null;
  created_at: Date;
}

export interface EntrantRow {
  id: string;
  tournament_id: string;
  ig_handle: string;
  display_name: string;
  status: EntrantStatus;
  upvote_count: number;
  first_nominated_at: Date;
  seed: number | null;
  region: number | null;
}

async function audit(db: Db, action: string, details: Record<string, unknown>): Promise<void> {
  await db.query("insert into audit_log (actor, action, details) values ('admin', $1, $2::jsonb)", [
    action,
    JSON.stringify(details),
  ]);
}

async function mustGetTournament(db: Db, id: string): Promise<TournamentRow> {
  const rows = await db.query<TournamentRow>("select * from tournaments where id = $1", [id]);
  if (!rows[0]) throw new AdminError("Tournament not found", 404);
  return rows[0];
}

async function mustGetEntrant(db: Db, id: string): Promise<EntrantRow> {
  const rows = await db.query<EntrantRow>("select * from entrants where id = $1", [id]);
  if (!rows[0]) throw new AdminError("Entrant not found", 404);
  return rows[0];
}

// ---------- Tournaments ----------

export interface TournamentSummary extends TournamentRow {
  approved_count: number;
  pending_count: number;
  total_upvotes: number;
  total_votes: number;
  current_round: string | null;
}

export async function listTournaments(): Promise<TournamentSummary[]> {
  return getDb().query<TournamentSummary>(`
    select t.*,
      (select count(*)::int from entrants e where e.tournament_id = t.id and e.status = 'approved') as approved_count,
      (select count(*)::int from entrants e where e.tournament_id = t.id and e.status = 'pending') as pending_count,
      (select count(*)::int from upvotes u join entrants e on e.id = u.entrant_id where e.tournament_id = t.id) as total_upvotes,
      (select count(*)::int from votes v join matchups m on m.id = v.matchup_id join rounds r on r.id = m.round_id
        where r.tournament_id = t.id and not v.excluded) as total_votes,
      (select r.name from rounds r where r.tournament_id = t.id and r.status = 'open' order by r.number limit 1) as current_round
    from tournaments t order by t.created_at desc`);
}

export async function getTournament(id: string): Promise<TournamentRow> {
  return mustGetTournament(getDb(), id);
}

export interface CreateTournamentInput {
  name: string;
  slug: string;
  category: string;
  fieldSize: number;
  roundDays: number;
  nominationsCloseAt?: Date | null;
}

export async function createTournament(input: CreateTournamentInput): Promise<{ id: string }> {
  const name = input.name.trim();
  const category = input.category.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name || !category) throw new AdminError("Name and category are required");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new AdminError("Slug can use lowercase letters, numbers and dashes only");
  if (![16, 32, 64].includes(input.fieldSize)) throw new AdminError("Field size must be 16, 32 or 64");
  if (!Number.isInteger(input.roundDays) || input.roundDays < 1 || input.roundDays > 30) {
    throw new AdminError("Round length must be 1 to 30 days");
  }
  return getDb().tx(async (db) => {
    const dup = await db.query("select 1 from tournaments where slug = $1", [slug]);
    if (dup.length) throw new AdminError("That slug is already used", 409);
    const rows = await db.query<{ id: string }>(
      `insert into tournaments (slug, name, category, field_size, round_days, nominations_close_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [slug, name, category, input.fieldSize, input.roundDays, input.nominationsCloseAt ?? null],
    );
    await audit(db, "tournament.create", { id: rows[0].id, slug, name });
    return rows[0];
  });
}

export interface UpdateTournamentInput {
  id: string;
  name?: string;
  category?: string;
  fieldSize?: number;
  roundDays?: number;
  nominationsCloseAt?: Date | null;
}

export async function updateTournament(input: UpdateTournamentInput): Promise<void> {
  await getDb().tx(async (db) => {
    const t = await mustGetTournament(db, input.id);
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new AdminError("Name is required");
      add("name", input.name.trim());
    }
    if (input.category !== undefined) {
      if (!input.category.trim()) throw new AdminError("Category is required");
      add("category", input.category.trim());
    }
    if (input.fieldSize !== undefined) {
      if (![16, 32, 64].includes(input.fieldSize)) throw new AdminError("Field size must be 16, 32 or 64");
      if (t.status === "bracket" || t.status === "complete") throw new AdminError("Field size is locked once the bracket starts", 409);
      add("field_size", input.fieldSize);
    }
    if (input.roundDays !== undefined) {
      if (!Number.isInteger(input.roundDays) || input.roundDays < 1 || input.roundDays > 30) {
        throw new AdminError("Round length must be 1 to 30 days");
      }
      add("round_days", input.roundDays);
    }
    if (input.nominationsCloseAt !== undefined) add("nominations_close_at", input.nominationsCloseAt);
    if (!sets.length) return;
    params.push(input.id);
    await db.query(`update tournaments set ${sets.join(", ")} where id = $${params.length}`, params);
    await audit(db, "tournament.update", {
      id: input.id,
      changes: {
        name: input.name,
        category: input.category,
        fieldSize: input.fieldSize,
        roundDays: input.roundDays,
        nominationsCloseAt: input.nominationsCloseAt === undefined ? undefined : input.nominationsCloseAt?.toISOString() ?? null,
      },
    });
  });
}

export async function openNominations(id: string, now: Date = new Date()): Promise<void> {
  await getDb().tx(async (db) => {
    const t = await mustGetTournament(db, id);
    if (t.status !== "draft") throw new AdminError("Only a draft tournament can open nominations", 409);
    await db.query("update tournaments set status = 'nominations', nominations_open_at = $2 where id = $1", [id, now]);
    await audit(db, "tournament.open_nominations", { id, slug: t.slug });
  });
}

/** `startAt` is the moment game day 0 opens; leave it out for the next noon Eastern. */
export async function startBracket(id: string, now: Date = new Date(), startAt?: Date): Promise<void> {
  if (startAt && Number.isNaN(startAt.getTime())) throw new AdminError("Invalid start time");
  const db = getDb();
  const t = await mustGetTournament(db, id);
  if (t.status !== "nominations") throw new AdminError("Nominations must be open before the bracket can start", 409);
  try {
    await lockSeedingAndStart(id, now, startAt);
  } catch (e) {
    throw new AdminError(e instanceof Error ? e.message : "Could not start the bracket", 409);
  }
  await audit(db, "tournament.start_bracket", { id, slug: t.slug, startAt: startAt?.toISOString() ?? null });
}

// ---------- Entrants ----------

export async function listPending(tournamentId: string): Promise<EntrantRow[]> {
  return getDb().query<EntrantRow>(
    "select * from entrants where tournament_id = $1 and status = 'pending' order by first_nominated_at asc, id",
    [tournamentId],
  );
}

export async function listEntrants(tournamentId: string, status?: EntrantStatus): Promise<EntrantRow[]> {
  if (status) {
    return getDb().query<EntrantRow>(
      "select * from entrants where tournament_id = $1 and status = $2 order by upvote_count desc, first_nominated_at asc, id",
      [tournamentId, status],
    );
  }
  return getDb().query<EntrantRow>(
    "select * from entrants where tournament_id = $1 order by upvote_count desc, first_nominated_at asc, id",
    [tournamentId],
  );
}

async function setStatus(id: string, to: EntrantStatus, action: string, allowedFrom: EntrantStatus[]): Promise<void> {
  await getDb().tx(async (db) => {
    const e = await mustGetEntrant(db, id);
    if (!allowedFrom.includes(e.status)) throw new AdminError(`Cannot do that to an entrant that is ${e.status}`, 409);
    await db.query("update entrants set status = $2 where id = $1", [id, to]);
    await audit(db, action, { entrantId: id, handle: e.ig_handle, from: e.status, to });
  });
}

export const approveEntrant = (id: string) =>
  setStatus(id, "approved", "entrant.approve", ["pending", "rejected", "withdrawn"]);
export const rejectEntrant = (id: string) => setStatus(id, "rejected", "entrant.reject", ["pending", "approved"]);
export const withdrawEntrant = (id: string) => setStatus(id, "withdrawn", "entrant.withdraw", ["approved", "pending"]);
export const restoreEntrant = (id: string) => setStatus(id, "approved", "entrant.restore", ["withdrawn", "rejected"]);

export async function renameEntrant(id: string, displayName: string): Promise<void> {
  const name = displayName.trim();
  if (!name || name.length > 80) throw new AdminError("Name must be 1 to 80 characters");
  await getDb().tx(async (db) => {
    const e = await mustGetEntrant(db, id);
    await db.query("update entrants set display_name = $2 where id = $1", [id, name]);
    await audit(db, "entrant.rename", { entrantId: id, handle: e.ig_handle, from: e.display_name, to: name });
  });
}

export async function addEntrant(tournamentId: string, handleInput: string, displayName: string): Promise<{ id: string }> {
  const handle = normalizeHandle(handleInput);
  if (!handle) throw new AdminError("That is not a valid Instagram handle");
  const name = displayName.trim();
  if (!name || name.length > 80) throw new AdminError("Name must be 1 to 80 characters");
  return getDb().tx(async (db) => {
    await mustGetTournament(db, tournamentId);
    const dup = await db.query<{ status: string }>(
      "select status from entrants where tournament_id = $1 and ig_handle = $2",
      [tournamentId, handle],
    );
    if (dup.length) throw new AdminError(`@${handle} is already in this tournament (${dup[0].status})`, 409);
    const rows = await db.query<{ id: string }>(
      "insert into entrants (tournament_id, ig_handle, display_name, status) values ($1, $2, $3, 'approved') returning id",
      [tournamentId, handle, name],
    );
    await audit(db, "entrant.add", { entrantId: rows[0].id, tournamentId, handle, name });
    return rows[0];
  });
}

export interface BulkAddResult {
  added: { handle: string; name: string }[];
  skipped: { line: string; reason: string }[];
}

/** One `handle, Display Name` per line. */
export async function bulkAddEntrants(tournamentId: string, text: string): Promise<BulkAddResult> {
  return getDb().tx(async (db) => {
    await mustGetTournament(db, tournamentId);
    const existing = await db.query<{ ig_handle: string }>("select ig_handle from entrants where tournament_id = $1", [tournamentId]);
    const seen = new Set(existing.map((r) => r.ig_handle));
    const result: BulkAddResult = { added: [], skipped: [] };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^([^,\t]+)[,\t](.*)$/);
      if (!m) {
        result.skipped.push({ line, reason: "Needs a handle, a comma, then a name" });
        continue;
      }
      const handle = normalizeHandle(m[1]);
      const name = m[2].trim();
      if (!handle) {
        result.skipped.push({ line, reason: "Not a valid handle" });
        continue;
      }
      if (!name || name.length > 80) {
        result.skipped.push({ line, reason: "Name is missing or too long" });
        continue;
      }
      if (seen.has(handle)) {
        result.skipped.push({ line, reason: "Duplicate handle" });
        continue;
      }
      seen.add(handle);
      await db.query(
        "insert into entrants (tournament_id, ig_handle, display_name, status) values ($1, $2, $3, 'approved')",
        [tournamentId, handle, name],
      );
      result.added.push({ handle, name });
    }
    await audit(db, "entrant.bulk_add", {
      tournamentId,
      added: result.added.length,
      skipped: result.skipped.length,
      handles: result.added.map((a) => a.handle),
    });
    return result;
  });
}

/** Move upvotes from `fromId` into `intoId`, skipping voters who already upvoted `intoId`. */
export async function mergeEntrants(intoId: string, fromId: string): Promise<{ moved: number; upvoteCount: number }> {
  if (intoId === fromId) throw new AdminError("Pick two different entrants");
  return getDb().tx(async (db) => {
    const a = await mustGetEntrant(db, intoId);
    const b = await mustGetEntrant(db, fromId);
    if (a.tournament_id !== b.tournament_id) throw new AdminError("Entrants are in different tournaments");
    const t = await mustGetTournament(db, a.tournament_id);
    if (t.status === "bracket" || t.status === "complete") throw new AdminError("Cannot merge once the bracket has started", 409);
    const moved = await db.query<{ id: string }>(
      `insert into upvotes (entrant_id, voter_id, ip_hash, created_at)
       select $1, u.voter_id, u.ip_hash, u.created_at from upvotes u
       where u.entrant_id = $2
         and not exists (select 1 from upvotes x where x.entrant_id = $1 and x.voter_id = u.voter_id)
       returning id`,
      [intoId, fromId],
    );
    await db.query("delete from upvotes where entrant_id = $1", [fromId]);
    const counted = await db.query<{ n: number }>("select count(*)::int as n from upvotes where entrant_id = $1", [intoId]);
    const n = counted[0].n;
    await db.query("update entrants set upvote_count = $2 where id = $1", [intoId, n]);
    await db.query("update entrants set upvote_count = 0, status = 'rejected' where id = $1", [fromId]);
    await audit(db, "entrant.merge", {
      into: intoId,
      intoHandle: a.ig_handle,
      from: fromId,
      fromHandle: b.ig_handle,
      moved: moved.length,
      upvoteCount: n,
    });
    return { moved: moved.length, upvoteCount: n };
  });
}

// ---------- Schedule and matchups ----------

export interface GameDayMatchup {
  id: string;
  slot: number;
  round_number: number;
  round_name: string;
  region: number | null;
  status: "scheduled" | "open" | "closed";
  entrant_a_id: string | null;
  entrant_b_id: string | null;
  winner_id: string | null;
  decided_by: string | null;
  a_handle: string | null;
  a_name: string | null;
  b_handle: string | null;
  b_name: string | null;
  live_a: number;
  live_b: number;
}

/** Matchups that open at the same moment. `key` is that moment as an ISO string. */
export interface GameDay {
  key: string;
  opens_at: Date;
  closes_at: Date;
  /** closed when every matchup is closed, scheduled when none has started, otherwise open. */
  status: "scheduled" | "open" | "closed";
  matchups: GameDayMatchup[];
}

export async function listSchedule(tournamentId: string): Promise<GameDay[]> {
  const rows = await getDb().query<GameDayMatchup & { opens_at: Date; closes_at: Date }>(
    `select m.id, m.slot, r.number as round_number, r.name as round_name, m.region, m.status,
       coalesce(m.opens_at, r.opens_at) as opens_at, coalesce(m.closes_at, r.closes_at) as closes_at,
       m.entrant_a_id, m.entrant_b_id, m.winner_id, m.decided_by,
       ea.ig_handle as a_handle, ea.display_name as a_name, eb.ig_handle as b_handle, eb.display_name as b_name,
       (select count(*)::int from votes v where v.matchup_id = m.id and not v.excluded and v.choice = 'a') as live_a,
       (select count(*)::int from votes v where v.matchup_id = m.id and not v.excluded and v.choice = 'b') as live_b
     from matchups m
     join rounds r on r.id = m.round_id
     left join entrants ea on ea.id = m.entrant_a_id
     left join entrants eb on eb.id = m.entrant_b_id
     where r.tournament_id = $1
     order by coalesce(m.opens_at, r.opens_at), r.number, m.slot`,
    [tournamentId],
  );
  const days = new Map<string, GameDay>();
  for (const { opens_at, closes_at, ...m } of rows) {
    const key = new Date(opens_at).toISOString();
    let day = days.get(key);
    if (!day) {
      day = { key, opens_at: new Date(opens_at), closes_at: new Date(closes_at), status: "scheduled", matchups: [] };
      days.set(key, day);
    }
    if (new Date(closes_at).getTime() > day.closes_at.getTime()) day.closes_at = new Date(closes_at);
    day.matchups.push(m);
  }
  for (const day of days.values()) {
    if (day.matchups.every((m) => m.status === "closed")) day.status = "closed";
    else if (day.matchups.every((m) => m.status === "scheduled")) day.status = "scheduled";
    else day.status = "open";
  }
  return [...days.values()];
}

async function dayMatchups(db: Db, tournamentId: string, groupOpensAt: Date) {
  return db.query<{ id: string; status: string; opens_at: Date; closes_at: Date }>(
    `select m.id, m.status, m.opens_at, m.closes_at
     from matchups m join rounds r on r.id = m.round_id
     where r.tournament_id = $1 and m.opens_at = $2::timestamptz
     order by r.number, m.slot`,
    [tournamentId, groupOpensAt.toISOString()],
  );
}

/** Move a whole game day. Only while every matchup in it is still scheduled. */
export async function moveGameDay(input: {
  tournamentId: string;
  groupOpensAt: Date;
  opensAt: Date;
  closesAt: Date;
}): Promise<void> {
  if (Number.isNaN(input.opensAt.getTime()) || Number.isNaN(input.closesAt.getTime())) throw new AdminError("Invalid date");
  if (input.closesAt.getTime() <= input.opensAt.getTime()) throw new AdminError("The game day must close after it opens");
  await getDb().tx(async (db) => {
    const rows = await dayMatchups(db, input.tournamentId, input.groupOpensAt);
    if (rows.length === 0) throw new AdminError("Game day not found", 404);
    if (rows.some((m) => m.status !== "scheduled")) {
      throw new AdminError("This game day has already started, so it cannot be moved", 409);
    }
    await db.query("update matchups set opens_at = $2::timestamptz, closes_at = $3::timestamptz where id = any($1::uuid[])", [
      rows.map((m) => m.id),
      input.opensAt.toISOString(),
      input.closesAt.toISOString(),
    ]);
    await refreshRounds(db, [input.tournamentId]);
    await audit(db, "schedule.move_day", {
      tournamentId: input.tournamentId,
      matchups: rows.length,
      fromOpensAt: input.groupOpensAt.toISOString(),
      fromClosesAt: new Date(rows[0].closes_at).toISOString(),
      toOpensAt: input.opensAt.toISOString(),
      toClosesAt: input.closesAt.toISOString(),
    });
  });
}

/** Change the close time of a game day that is open. Closed matchups in it keep their result. */
export async function changeGameDayClose(input: {
  tournamentId: string;
  groupOpensAt: Date;
  closesAt: Date;
}): Promise<void> {
  if (Number.isNaN(input.closesAt.getTime())) throw new AdminError("Invalid date");
  await getDb().tx(async (db) => {
    const rows = await dayMatchups(db, input.tournamentId, input.groupOpensAt);
    if (rows.length === 0) throw new AdminError("Game day not found", 404);
    if (!rows.some((m) => m.status === "open")) throw new AdminError("Only a game day that is open can change its close time", 409);
    if (input.closesAt.getTime() <= input.groupOpensAt.getTime()) throw new AdminError("Close time must be after the game day opens");
    const live = rows.filter((m) => m.status !== "closed");
    await db.query("update matchups set closes_at = $2::timestamptz where id = any($1::uuid[])", [
      live.map((m) => m.id),
      input.closesAt.toISOString(),
    ]);
    await refreshRounds(db, [input.tournamentId]);
    await audit(db, "schedule.change_close", {
      tournamentId: input.tournamentId,
      matchups: live.length,
      opensAt: input.groupOpensAt.toISOString(),
      from: new Date(live[0].closes_at).toISOString(),
      to: input.closesAt.toISOString(),
    });
  });
}

/**
 * Override a result. A closed matchup gets its winner swapped (and the next matchup updated if it
 * has no votes). An open matchup is closed immediately with this winner. Scheduled ones are refused.
 */
export async function overrideWinner(matchupId: string, winnerId: string, now: Date = new Date()): Promise<void> {
  await getDb().tx(async (db) => {
    const rows = await db.query<{
      id: string;
      slot: number;
      entrant_a_id: string | null;
      entrant_b_id: string | null;
      winner_id: string | null;
      status: string;
      round_number: number;
      tournament_id: string;
    }>(
      `select m.id, m.slot, m.entrant_a_id, m.entrant_b_id, m.winner_id, m.status,
              r.number as round_number, r.tournament_id
       from matchups m join rounds r on r.id = m.round_id where m.id = $1`,
      [matchupId],
    );
    const m = rows[0];
    if (!m) throw new AdminError("Matchup not found", 404);
    if (winnerId !== m.entrant_a_id && winnerId !== m.entrant_b_id) throw new AdminError("Winner must be one of the two entrants");
    if (m.status === "scheduled") throw new AdminError("This game has not opened yet", 409);

    if (m.status === "closed") {
      const nextRows = await db.query<{ id: string; votes_a: number; votes_b: number; winner_id: string | null }>(
        `select m2.id, m2.votes_a, m2.votes_b, m2.winner_id
         from matchups m2 join rounds r2 on r2.id = m2.round_id
         where r2.tournament_id = $1 and r2.number = $2 and m2.slot = $3`,
        [m.tournament_id, m.round_number + 1, Math.floor(m.slot / 2)],
      );
      const next = nextRows[0];
      if (next) {
        const cast = await db.query<{ n: number }>("select count(*)::int as n from votes where matchup_id = $1", [next.id]);
        if (cast[0].n > 0 || next.votes_a + next.votes_b > 0 || next.winner_id) {
          throw new AdminError("The next matchup already has votes, so this result cannot be changed", 409);
        }
        const col = m.slot % 2 === 0 ? "entrant_a_id" : "entrant_b_id";
        await db.query(`update matchups set ${col} = $2 where id = $1`, [next.id, winnerId]);
      }
    }
    await db.query("update matchups set winner_id = $2, decided_by = 'admin_override' where id = $1", [matchupId, winnerId]);
    if (m.status === "open") await closeMatchupNow(db, matchupId, now);
    await audit(db, "matchup.override", {
      matchupId,
      tournamentId: m.tournament_id,
      round: m.round_number,
      from: m.winner_id,
      to: winnerId,
      matchupStatus: m.status,
    });
  });
}

// ---------- Flagged activity ----------

export const FLAG_THRESHOLD = 10;

export interface FlaggedVoteGroup {
  matchup_id: string;
  round_name: string;
  a_name: string | null;
  b_name: string | null;
  ip_hash: string;
  hour: Date;
  total: number;
  for_a: number;
  for_b: number;
  excluded_count: number;
  first_at: Date;
  last_at: Date;
}

export interface FlaggedUpvoteGroup {
  entrant_id: string;
  display_name: string;
  ig_handle: string;
  ip_hash: string;
  hour: Date;
  total: number;
  first_at: Date;
  last_at: Date;
}

export async function listFlagged(tournamentId: string): Promise<{ votes: FlaggedVoteGroup[]; upvotes: FlaggedUpvoteGroup[] }> {
  const db = getDb();
  const votes = await db.query<FlaggedVoteGroup>(
    `select v.matchup_id, r.name as round_name, ea.display_name as a_name, eb.display_name as b_name,
       v.ip_hash, date_trunc('hour', v.created_at) as hour,
       count(*)::int as total,
       (count(*) filter (where v.choice = 'a'))::int as for_a,
       (count(*) filter (where v.choice = 'b'))::int as for_b,
       (count(*) filter (where v.excluded))::int as excluded_count,
       min(v.created_at) as first_at, max(v.created_at) as last_at
     from votes v
     join matchups m on m.id = v.matchup_id
     join rounds r on r.id = m.round_id
     left join entrants ea on ea.id = m.entrant_a_id
     left join entrants eb on eb.id = m.entrant_b_id
     where r.tournament_id = $1 and m.status = 'open'
     group by v.matchup_id, r.name, ea.display_name, eb.display_name, v.ip_hash, date_trunc('hour', v.created_at)
     having count(*) >= $2
     order by count(*) desc, min(v.created_at)`,
    [tournamentId, FLAG_THRESHOLD],
  );
  const upvotes = await db.query<FlaggedUpvoteGroup>(
    `select u.entrant_id, e.display_name, e.ig_handle, u.ip_hash, date_trunc('hour', u.created_at) as hour,
       count(*)::int as total, min(u.created_at) as first_at, max(u.created_at) as last_at
     from upvotes u
     join entrants e on e.id = u.entrant_id
     join tournaments t on t.id = e.tournament_id
     where e.tournament_id = $1 and t.status = 'nominations'
     group by u.entrant_id, e.display_name, e.ig_handle, u.ip_hash, date_trunc('hour', u.created_at)
     having count(*) >= $2
     order by count(*) desc, min(u.created_at)`,
    [tournamentId, FLAG_THRESHOLD],
  );
  return { votes, upvotes };
}

/** Exclude or restore one group of votes (same matchup, ip hash and clock hour). Votes stay stored. */
export async function setVoteGroupExcluded(input: {
  matchupId: string;
  ipHash: string;
  hour: Date;
  excluded: boolean;
}): Promise<{ changed: number }> {
  return getDb().tx(async (db) => {
    const rows = await db.query<{ status: string; tournament_id: string }>(
      "select m.status, r.tournament_id from matchups m join rounds r on r.id = m.round_id where m.id = $1",
      [input.matchupId],
    );
    if (!rows[0]) throw new AdminError("Matchup not found", 404);
    if (rows[0].status !== "open") throw new AdminError("Only votes in an open game can be changed", 409);
    const changed = await db.query<{ id: string }>(
      `update votes set excluded = $4
       where matchup_id = $1 and ip_hash = $2 and date_trunc('hour', created_at) = $3::timestamptz
       returning id`,
      [input.matchupId, input.ipHash, input.hour.toISOString(), input.excluded],
    );
    await db.query(
      `update matchups set
         votes_a = (select count(*)::int from votes where matchup_id = $1 and choice = 'a' and not excluded),
         votes_b = (select count(*)::int from votes where matchup_id = $1 and choice = 'b' and not excluded)
       where id = $1`,
      [input.matchupId],
    );
    await audit(db, input.excluded ? "votes.exclude" : "votes.restore", {
      matchupId: input.matchupId,
      tournamentId: rows[0].tournament_id,
      ipHash: input.ipHash,
      hour: input.hour.toISOString(),
      count: changed.length,
    });
    return { changed: changed.length };
  });
}

// ---------- Audit ----------

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  created_at: Date;
}

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  return getDb().query<AuditRow>("select * from audit_log order by created_at desc, id desc limit $1", [limit]);
}

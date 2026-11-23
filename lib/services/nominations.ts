import { getDb, type Db } from "@/lib/db";
import { normalizeHandle } from "@/lib/handles";
import { VOTES_PER_VOTER } from "@/lib/config";
import { nominationsIpLimited, nominationsLimited, upvoteDeviceLimited, upvoteIpLimited } from "@/lib/ratelimit";

export type PublicEntrant = {
  id: string;
  igHandle: string;
  displayName: string;
  upvoteCount: number;
  upvotedByMe: boolean;
};

export type ListResult = { kind: "ok"; entrants: PublicEntrant[] } | { kind: "not_found" };

export async function listEntrants(slug: string, voterId: string): Promise<ListResult> {
  const db = getDb();
  const [t] = await db.query<{ id: string }>(`select id from tournaments where slug = $1`, [slug]);
  if (!t) return { kind: "not_found" };
  const rows = await db.query<{
    id: string;
    ig_handle: string;
    display_name: string;
    upvote_count: number;
    mine: boolean;
  }>(
    `select e.id, e.ig_handle, e.display_name, e.upvote_count,
            exists (select 1 from upvotes u where u.entrant_id = e.id and u.voter_id = $2) as mine
     from entrants e
     where e.tournament_id = $1 and e.status = 'approved'
     order by e.upvote_count desc, e.first_nominated_at asc, e.id asc`,
    [t.id, voterId],
  );
  return {
    kind: "ok",
    entrants: rows.map((r) => ({
      id: r.id,
      igHandle: r.ig_handle,
      displayName: r.display_name,
      upvoteCount: Number(r.upvote_count),
      upvotedByMe: !!r.mine,
    })),
  };
}

export type NominateResult =
  | { kind: "created_pending"; entrantId: string }
  | { kind: "upvoted"; entrantId: string }
  | { kind: "already_upvoted"; entrantId: string }
  | { kind: "rejected" }
  | { kind: "no_votes_left" }
  | { kind: "closed" }
  | { kind: "invalid_handle" }
  | { kind: "rate_limited" }
  | { kind: "not_found" };

type Phase = { id: string; open: boolean };

function phase(t: { id: string; status: string; nominations_close_at: Date | string | null }, now: Date): Phase {
  const closed = t.nominations_close_at != null && new Date(t.nominations_close_at).getTime() <= now.getTime();
  return { id: t.id, open: t.status === "nominations" && !closed };
}

/** Upvotes this voter has on approved places in a tournament. */
async function votesUsed(db: Db, tournamentId: string, voterId: string): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    `select count(*)::int as n from upvotes u join entrants e on e.id = u.entrant_id
     where e.tournament_id = $1 and e.status = 'approved' and u.voter_id = $2`,
    [tournamentId, voterId],
  );
  return Number(r?.n ?? 0);
}

/** Insert the upvote (unique constraint decides) and bump the counter only if a row went in. */
async function addUpvote(
  db: Db,
  entrantId: string,
  voterId: string,
  ipHash: string,
): Promise<{ inserted: boolean; upvoteCount: number }> {
  const ins = await db.query<{ id: string }>(
    `insert into upvotes (entrant_id, voter_id, ip_hash) values ($1, $2, $3)
     on conflict (entrant_id, voter_id) do nothing returning id`,
    [entrantId, voterId, ipHash],
  );
  if (ins.length === 0) {
    const [e] = await db.query<{ upvote_count: number }>(`select upvote_count from entrants where id = $1`, [entrantId]);
    return { inserted: false, upvoteCount: Number(e?.upvote_count ?? 0) };
  }
  const [e] = await db.query<{ upvote_count: number }>(
    `update entrants set upvote_count = upvote_count + 1 where id = $1 returning upvote_count`,
    [entrantId],
  );
  return { inserted: true, upvoteCount: Number(e.upvote_count) };
}

export async function nominate(input: {
  slug: string;
  handle: string;
  displayName?: string;
  voterId: string;
  ipHash: string;
  now?: Date;
}): Promise<NominateResult> {
  const now = input.now ?? new Date();
  const handle = normalizeHandle(input.handle);
  const db = getDb();
  return db.tx(async (tx): Promise<NominateResult> => {
    const [t] = await tx.query<{ id: string; status: string; nominations_close_at: Date | string | null }>(
      `select id, status, nominations_close_at from tournaments where slug = $1`,
      [input.slug],
    );
    if (!t) return { kind: "not_found" };
    if (!phase(t, now).open) return { kind: "closed" };
    if (!handle) return { kind: "invalid_handle" };

    const displayName = (input.displayName ?? "").trim().slice(0, 80) || handle;

    let existing = await findEntrant(tx, t.id, handle);
    if (!existing) {
      if (await nominationsLimited(tx, input.voterId, now)) return { kind: "rate_limited" };
      if (await nominationsIpLimited(tx, input.ipHash, now)) return { kind: "rate_limited" };
      const created = await tx.query<{ id: string }>(
        `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count, first_nominated_at)
         values ($1, $2, $3, 'approved', 0, $4)
         on conflict (tournament_id, ig_handle) do nothing returning id`,
        [t.id, handle, displayName, now.toISOString()],
      );
      if (created.length > 0) {
        // A new place counts as one of the voter's votes. Out of votes: still add it, without the vote.
        if ((await votesUsed(tx, t.id, input.voterId)) < VOTES_PER_VOTER) {
          await addUpvote(tx, created[0].id, input.voterId, input.ipHash);
        }
        return { kind: "created_pending", entrantId: created[0].id };
      }
      // Lost a race with a concurrent nomination of the same handle: treat as an upvote.
      existing = await findEntrant(tx, t.id, handle);
      if (!existing) return { kind: "not_found" };
    }

    if (existing.status === "rejected" || existing.status === "withdrawn") return { kind: "rejected" };
    if (await upvoteIpLimited(tx, existing.id, input.ipHash, now)) return { kind: "rate_limited" };
    if (await upvoteDeviceLimited(tx, existing.id, input.voterId, input.ipHash, now)) return { kind: "rate_limited" };
    if (!(await hasUpvoted(tx, existing.id, input.voterId)) && (await votesUsed(tx, t.id, input.voterId)) >= VOTES_PER_VOTER) {
      return { kind: "no_votes_left" };
    }
    const r = await addUpvote(tx, existing.id, input.voterId, input.ipHash);
    return { kind: r.inserted ? "upvoted" : "already_upvoted", entrantId: existing.id };
  });
}

async function findEntrant(db: Db, tournamentId: string, handle: string) {
  const [e] = await db.query<{ id: string; status: string }>(
    `select id, status from entrants where tournament_id = $1 and ig_handle = $2`,
    [tournamentId, handle],
  );
  return e ?? null;
}

async function hasUpvoted(db: Db, entrantId: string, voterId: string): Promise<boolean> {
  const r = await db.query<{ id: string }>(`select id from upvotes where entrant_id = $1 and voter_id = $2`, [entrantId, voterId]);
  return r.length > 0;
}

export type RemoveUpvoteResult = { kind: "ok"; upvoteCount: number } | { kind: "closed" } | { kind: "not_found" };

/** Takes back a vote while nominations are open. The voter gets that vote back. */
export async function removeUpvote(input: { entrantId: string; voterId: string; now?: Date }): Promise<RemoveUpvoteResult> {
  const now = input.now ?? new Date();
  return getDb().tx(async (tx): Promise<RemoveUpvoteResult> => {
    const [e] = await tx.query<{
      id: string;
      status: string;
      t_status: string;
      nominations_close_at: Date | string | null;
      tid: string;
    }>(
      `select e.id, e.status, t.status as t_status, t.nominations_close_at, t.id as tid
       from entrants e join tournaments t on t.id = e.tournament_id where e.id = $1`,
      [input.entrantId],
    );
    if (!e || e.status !== "approved") return { kind: "not_found" };
    if (!phase({ id: e.tid, status: e.t_status, nominations_close_at: e.nominations_close_at }, now).open) {
      return { kind: "closed" };
    }
    const del = await tx.query<{ id: string }>(
      `delete from upvotes where entrant_id = $1 and voter_id = $2 returning id`,
      [e.id, input.voterId],
    );
    if (del.length === 0) {
      const [c] = await tx.query<{ upvote_count: number }>(`select upvote_count from entrants where id = $1`, [e.id]);
      return { kind: "ok", upvoteCount: Number(c?.upvote_count ?? 0) };
    }
    const [c] = await tx.query<{ upvote_count: number }>(
      `update entrants set upvote_count = greatest(upvote_count - 1, 0) where id = $1 returning upvote_count`,
      [e.id],
    );
    return { kind: "ok", upvoteCount: Number(c.upvote_count) };
  });
}

export type UpvoteResult =
  | { kind: "no_votes_left" }
  | { kind: "ok"; upvoteCount: number }
  | { kind: "already"; upvoteCount: number }
  | { kind: "rate_limited" }
  | { kind: "closed" }
  | { kind: "not_found" };

export async function upvote(input: {
  entrantId: string;
  voterId: string;
  ipHash: string;
  now?: Date;
}): Promise<UpvoteResult> {
  const now = input.now ?? new Date();
  return getDb().tx(async (tx): Promise<UpvoteResult> => {
    const [e] = await tx.query<{
      id: string;
      status: string;
      t_status: string;
      nominations_close_at: Date | string | null;
      tid: string;
    }>(
      `select e.id, e.status, t.status as t_status, t.nominations_close_at, t.id as tid
       from entrants e join tournaments t on t.id = e.tournament_id where e.id = $1`,
      [input.entrantId],
    );
    if (!e || e.status !== "approved") return { kind: "not_found" };
    if (!phase({ id: e.tid, status: e.t_status, nominations_close_at: e.nominations_close_at }, now).open) {
      return { kind: "closed" };
    }
    if (await upvoteIpLimited(tx, e.id, input.ipHash, now)) return { kind: "rate_limited" };
    if (await upvoteDeviceLimited(tx, e.id, input.voterId, input.ipHash, now)) return { kind: "rate_limited" };
    if (!(await hasUpvoted(tx, e.id, input.voterId)) && (await votesUsed(tx, e.tid, input.voterId)) >= VOTES_PER_VOTER) {
      return { kind: "no_votes_left" };
    }
    const r = await addUpvote(tx, e.id, input.voterId, input.ipHash);
    return { kind: r.inserted ? "ok" : "already", upvoteCount: r.upvoteCount };
  });
}

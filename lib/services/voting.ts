import { getDb } from "@/lib/db";
import { voteDeviceLimited, voteIpLimited } from "@/lib/ratelimit";

export type VoteEntrant = { id: string; igHandle: string; displayName: string; seed: number | null };

export type NextMatchup = {
  id: string;
  roundName: string;
  closesAt: string;
  a: VoteEntrant;
  b: VoteEntrant;
};

export type NextResult =
  | { kind: "ok"; matchup: NextMatchup | null; remaining: number; nextOpensAt: string | null }
  | { kind: "not_found" };

/**
 * `remaining` counts open matchups the voter has not voted on, including the one returned.
 * `nextOpensAt` is the earliest future opens_at among scheduled matchups of the tournament.
 */
export async function nextMatchup(slug: string, voterId: string, now: Date = new Date()): Promise<NextResult> {
  const db = getDb();
  const [t] = await db.query<{ id: string }>(`select id from tournaments where slug = $1`, [slug]);
  if (!t) return { kind: "not_found" };

  const base = `
    from matchups m
    join rounds r on r.id = m.round_id
    where r.tournament_id = $1 and m.status = 'open' and m.closes_at > $3::timestamptz
      and m.entrant_a_id is not null and m.entrant_b_id is not null and m.winner_id is null
      and not exists (select 1 from votes v where v.matchup_id = m.id and v.voter_id = $2)`;
  const params = [t.id, voterId, now.toISOString()];

  const [nx] = await db.query<{ at: Date | string | null }>(
    `select min(m.opens_at) as at from matchups m join rounds r on r.id = m.round_id
     where r.tournament_id = $1 and m.status = 'scheduled' and m.opens_at > $2::timestamptz`,
    [t.id, now.toISOString()],
  );
  const nextOpensAt = nx?.at ? new Date(nx.at).toISOString() : null;

  const [c] = await db.query<{ n: number | string }>(`select count(*) as n ${base}`, params);
  const remaining = Number(c?.n ?? 0);
  if (remaining === 0) return { kind: "ok", matchup: null, remaining: 0, nextOpensAt };

  const [m] = await db.query<{ id: string; round_name: string; closes_at: Date | string; a: string; b: string }>(
    `select m.id, r.name as round_name, m.closes_at, m.entrant_a_id as a, m.entrant_b_id as b ${base}
     order by random() limit 1`,
    params,
  );
  if (!m) return { kind: "ok", matchup: null, remaining: 0, nextOpensAt };

  const ents = await db.query<{ id: string; ig_handle: string; display_name: string; seed: number | null }>(
    `select id, ig_handle, display_name, seed from entrants where id = any($1::uuid[])`,
    [[m.a, m.b]],
  );
  const toE = (id: string): VoteEntrant => {
    const e = ents.find((x) => x.id === id)!;
    return { id: e.id, igHandle: e.ig_handle, displayName: e.display_name, seed: e.seed == null ? null : Number(e.seed) };
  };
  return {
    kind: "ok",
    remaining,
    nextOpensAt,
    matchup: {
      id: m.id,
      roundName: m.round_name,
      closesAt: new Date(m.closes_at).toISOString(),
      a: toE(m.a),
      b: toE(m.b),
    },
  };
}

export type VoteResult =
  | { kind: "ok"; votesA: number; votesB: number }
  | { kind: "already"; votesA: number; votesB: number }
  | { kind: "rate_limited" }
  | { kind: "closed" }
  | { kind: "not_found" };

export async function castVote(input: {
  matchupId: string;
  choice: "a" | "b";
  voterId: string;
  ipHash: string;
  now?: Date;
}): Promise<VoteResult> {
  const now = input.now ?? new Date();
  return getDb().tx(async (tx): Promise<VoteResult> => {
    const [m] = await tx.query<{
      id: string;
      status: string;
      closes_at: Date | string;
      a: string | null;
      b: string | null;
      winner_id: string | null;
      votes_a: number;
      votes_b: number;
    }>(
      `select m.id, m.status, m.closes_at, m.entrant_a_id as a, m.entrant_b_id as b,
              m.winner_id, m.votes_a, m.votes_b
       from matchups m where m.id = $1`,
      [input.matchupId],
    );
    if (!m) return { kind: "not_found" };
    if (
      m.status !== "open" ||
      !m.closes_at ||
      new Date(m.closes_at).getTime() <= now.getTime() ||
      !m.a ||
      !m.b ||
      m.winner_id
    ) {
      return { kind: "closed" };
    }
    if (await voteIpLimited(tx, m.id, input.ipHash, now)) return { kind: "rate_limited" };
    if (await voteDeviceLimited(tx, m.id, input.voterId, input.ipHash, now)) return { kind: "rate_limited" };

    // The unique (matchup_id, voter_id) constraint decides; counter moves only if a row went in.
    const ins = await tx.query<{ id: string }>(
      `insert into votes (matchup_id, voter_id, choice, ip_hash, created_at) values ($1, $2, $3, $4, $5)
       on conflict (matchup_id, voter_id) do nothing returning id`,
      [m.id, input.voterId, input.choice, input.ipHash, now.toISOString()],
    );
    if (ins.length === 0) {
      const [cur] = await tx.query<{ votes_a: number; votes_b: number }>(
        `select votes_a, votes_b from matchups where id = $1`,
        [m.id],
      );
      return { kind: "already", votesA: Number(cur.votes_a), votesB: Number(cur.votes_b) };
    }
    const col = input.choice === "a" ? "votes_a" : "votes_b";
    const [cur] = await tx.query<{ votes_a: number; votes_b: number }>(
      `update matchups set ${col} = ${col} + 1 where id = $1 returning votes_a, votes_b`,
      [m.id],
    );
    return { kind: "ok", votesA: Number(cur.votes_a), votesB: Number(cur.votes_b) };
  });
}

export type NextPayload = { matchup: NextMatchup | null; remaining: number; nextOpensAt: string | null };

export type VoteWithNextResult =
  | { kind: "ok" | "already"; votesA: number; votesB: number; next: NextPayload }
  | { kind: "rate_limited" | "closed" | "not_found" };

/**
 * Records the vote, then computes the voter's next matchup in the same request
 * (also when the vote was a repeat) so the client needs one request per vote.
 */
export async function castVoteWithNext(input: Parameters<typeof castVote>[0]): Promise<VoteWithNextResult> {
  const r = await castVote(input);
  if (r.kind !== "ok" && r.kind !== "already") return r;
  const empty: NextPayload = { matchup: null, remaining: 0, nextOpensAt: null };
  const [row] = await getDb().query<{ slug: string }>(
    `select t.slug from matchups m join rounds r on r.id = m.round_id join tournaments t on t.id = r.tournament_id
     where m.id = $1`,
    [input.matchupId],
  );
  if (!row) return { ...r, next: empty };
  const n = await nextMatchup(row.slug, input.voterId, input.now ?? new Date());
  const next: NextPayload =
    n.kind === "ok" ? { matchup: n.matchup, remaining: n.remaining, nextOpensAt: n.nextOpensAt } : empty;
  return { ...r, next };
}

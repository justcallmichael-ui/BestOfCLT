import type { Db } from "@/lib/db";

export const LIMITS = {
  nominationsPerVoterPerDay: 5,
  upvotesPerEntrantPerIpPerHour: 40,
  votesPerMatchupPerIpPerHour: 30,
  // Same network and same device fingerprint: a handful of identical phones on one wifi is
  // normal, a long run is one person clearing cookies.
  perTargetPerDevicePerDay: 5,
  nominationsPerIpPerDay: 15,
} as const;

async function count(db: Db, sql: string, params: unknown[]): Promise<number> {
  const [row] = await db.query<{ n: number | string }>(sql, params);
  return Number(row?.n ?? 0);
}

export async function upvoteIpLimited(db: Db, entrantId: string, ipHash: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from upvotes
     where entrant_id = $1 and ip_hash = $2 and created_at > $3::timestamptz - interval '1 hour'`,
    [entrantId, ipHash, now.toISOString()],
  );
  return n >= LIMITS.upvotesPerEntrantPerIpPerHour;
}

export async function voteIpLimited(db: Db, matchupId: string, ipHash: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from votes
     where matchup_id = $1 and ip_hash = $2 and created_at > $3::timestamptz - interval '1 hour'`,
    [matchupId, ipHash, now.toISOString()],
  );
  return n >= LIMITS.votesPerMatchupPerIpPerHour;
}

/**
 * New nominations by a voter in the last 24h. The nominator's upvote is the first upvote
 * on an entrant, so count upvotes by this voter that are the earliest on their entrant.
 */
export async function nominationsLimited(db: Db, voterId: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from upvotes u
     where u.voter_id = $1 and u.created_at > $2::timestamptz - interval '1 day'
       and not exists (
         select 1 from upvotes o
         where o.entrant_id = u.entrant_id
           and (o.created_at < u.created_at or (o.created_at = u.created_at and o.id < u.id))
       )`,
    [voterId, now.toISOString()],
  );
  return n >= LIMITS.nominationsPerVoterPerDay;
}

/** Votes on this matchup in the last day from the same ip and the same device fingerprint as this voter. */
export async function voteDeviceLimited(db: Db, matchupId: string, voterId: string, ipHash: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from votes v join voters vo on vo.id = v.voter_id
     where v.matchup_id = $1 and v.ip_hash = $2 and v.voter_id <> $3
       and coalesce(vo.fingerprint_hash, '') = coalesce((select fingerprint_hash from voters where id = $3), '')
       and v.created_at > $4::timestamptz - interval '1 day'`,
    [matchupId, ipHash, voterId, now.toISOString()],
  );
  return n >= LIMITS.perTargetPerDevicePerDay;
}

export async function upvoteDeviceLimited(db: Db, entrantId: string, voterId: string, ipHash: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from upvotes u join voters vo on vo.id = u.voter_id
     where u.entrant_id = $1 and u.ip_hash = $2 and u.voter_id <> $3
       and coalesce(vo.fingerprint_hash, '') = coalesce((select fingerprint_hash from voters where id = $3), '')
       and u.created_at > $4::timestamptz - interval '1 day'`,
    [entrantId, ipHash, voterId, now.toISOString()],
  );
  return n >= LIMITS.perTargetPerDevicePerDay;
}

/** New nominations from one network in the last day, so a script cannot flood the review list. */
export async function nominationsIpLimited(db: Db, ipHash: string, now: Date): Promise<boolean> {
  const n = await count(
    db,
    `select count(*) as n from upvotes u
     where u.ip_hash = $1 and u.created_at > $2::timestamptz - interval '1 day'
       and not exists (
         select 1 from upvotes o
         where o.entrant_id = u.entrant_id
           and (o.created_at < u.created_at or (o.created_at = u.created_at and o.id < u.id))
       )`,
    [ipHash, now.toISOString()],
  );
  return n >= LIMITS.nominationsPerIpPerDay;
}

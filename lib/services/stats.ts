import { getDb } from "@/lib/db";

/** Every vote counted so far in a tournament: nomination upvotes plus bracket votes. Shown at the bottom of the home page. */
export async function totalVotesCast(slug: string): Promise<number> {
  const [r] = await getDb().query<{ n: number }>(
    `select
       (select count(*)::int from upvotes u
          join entrants e on e.id = u.entrant_id
          join tournaments t on t.id = e.tournament_id
          where t.slug = $1)
       +
       (select count(*)::int from votes v
          join matchups m on m.id = v.matchup_id
          join rounds r on r.id = m.round_id
          join tournaments t on t.id = r.tournament_id
          where t.slug = $1 and not v.excluded) as n`,
    [slug],
  );
  return Number(r?.n ?? 0);
}

import { fileURLToPath } from "node:url";
import { getDb, type Db } from "../lib/db";

export async function seedDemo(db: Db): Promise<{ tournamentId: string }> {
  return db.tx(async (t) => {
    const [row] = await t.query<{ id: string }>(
      `insert into tournaments (slug, name, category, status, field_size, round_days)
       values ('pizza', 'Charlotte Pizza Tournament', 'pizza', 'nominations', 64, 3)
       on conflict (slug) do update set name = excluded.name
       returning id`,
    );
    const tournamentId = row.id;
    for (let i = 1; i <= 70; i++) {
      const n = String(i).padStart(2, "0");
      const upvotes = 5 + ((i * 37) % 90) + (i % 7);
      await t.query(
        `insert into entrants (tournament_id, ig_handle, display_name, status, upvote_count, first_nominated_at)
         values ($1, $2, $3, 'approved', $4, now() - ($5 || ' minutes')::interval)
         on conflict (tournament_id, ig_handle) do nothing`,
        [tournamentId, `demo_pizza_${n}`, `Demo Pizza ${n}`, upvotes, String(1000 - i * 3)],
      );
    }
    return { tournamentId };
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seedDemo(getDb())
    .then(() => {
      console.log("seeded demo tournament 'pizza' with 70 entrants");
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

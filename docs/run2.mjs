import { execSync } from "node:child_process";
const B = "http://127.0.0.1:3111";
const psql = (q) => execSync(`psql -h 127.0.0.1 -p 5433 -U postgres -d ft -Atc "${q}"`).toString().trim();
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log("FAIL:", msg); } else console.log("ok:", msg); };
class Client {
  constructor(ip, fp) { this.ip = ip; this.fp = fp; this.cookie = ""; }
  async req(path, body) {
    const h = { "x-forwarded-for": this.ip };
    if (this.fp) h["x-fp"] = this.fp;
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["content-type"] = "application/json";
    const r = await fetch(B + path, { method: body !== undefined ? "POST" : "GET", headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() ?? []) this.cookie = c.split(";")[0];
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }
}
const mk = (i) => new Client(`10.1.${Math.floor(i / 250)}.${i % 250 + 1}`, `fp-${i}`);
const c1 = mk(1);
const adm = new Client("9.9.9.9", "");
await adm.req("/api/admin/login", { password: "testpass" });
const tid = psql("select id from tournaments where slug='pizza'");
let a = await adm.req("/api/admin/tournaments/start", { id: tid });
ok(a.status === 200, "start bracket " + JSON.stringify(a.j).slice(0, 120));
ok(psql("select count(*) from matchups where status='open'") === "0", "nothing open before the first noon");
let st = await c1.req("/api/t/pizza");
ok(st.j.live.length === 0 && st.j.upNext.length === 8 && st.j.nextOpensAt, "before start: 8 up next, none live");
const sched = psql("select m.id from matchups m where status='scheduled' limit 1");
let v = await c1.req("/api/vote", { matchupId: sched, choice: "a" });
ok(v.status === 409, "vote on a scheduled matchup refused");
// move the whole schedule so day 0 opened a minute ago
psql("update matchups set opens_at = opens_at - d.delta, closes_at = closes_at - d.delta from (select min(opens_at) - (now() - interval '1 minute') as delta from matchups) d");
const expectLive = [8, 8, 8, 8, 8, 8, 4, 4, 4, 2, 2, 0, 1, 1];
const voters = Array.from({ length: 30 }, (_, i) => mk(2000 + i));
for (let day = 0; day < 14; day++) {
  await Promise.all(Array.from({ length: 10 }, () => c1.req("/api/t/pizza")));
  st = await c1.req("/api/t/pizza");
  ok(st.j.live.length === expectLive[day], `day ${day + 1}: ${st.j.live.length} live (expected ${expectLive[day]}), up next ${st.j.upNext.length}, latest results ${st.j.latestResults.length}`);
  ok(st.j.live.every(m => m.a && m.b), `day ${day + 1}: every live matchup has both entrants`);
  await Promise.all(voters.map(async (c, vi) => {
    for (let g = 0; g < 12; g++) {
      const nx = await c.req("/api/t/pizza/next");
      if (!nx.j?.matchup) break;
      const r = await c.req("/api/vote", { matchupId: nx.j.matchup.id, choice: (vi + g) % 3 === 0 ? "b" : "a" });
      if (r.status !== 200) { ok(false, `vote failed ${r.status} ${JSON.stringify(r.j)}`); break; }
    }
  }));
  const mism = psql("select count(*) from matchups m where m.votes_a <> (select count(*) from votes v where v.matchup_id=m.id and v.choice='a' and not v.excluded) or m.votes_b <> (select count(*) from votes v where v.matchup_id=m.id and v.choice='b' and not v.excluded)");
  if (mism !== "0") ok(false, `day ${day + 1}: scores do not match vote rows (${mism})`);
  psql("update matchups set opens_at = opens_at - interval '1 day', closes_at = closes_at - interval '1 day'");
}
await Promise.all(Array.from({ length: 10 }, () => c1.req("/api/t/pizza")));
st = await c1.req("/api/t/pizza");
ok(st.j.tournament.status === "complete" && st.j.champion, "complete with champion " + st.j.champion?.displayName);
ok(psql("select count(*) from matchups where status='closed' and winner_id is not null") === "63", "63 closed, decided matchups");
ok(psql("select count(*) from matchups where votes_a + votes_b <> 30") === "0", "every matchup got exactly 30 votes");
ok(psql("select count(distinct winner_id) from matchups m join rounds r on r.id=m.round_id where r.number=6") === "1", "one champion");
const br = await c1.req("/api/t/pizza/bracket");
ok(br.j.rounds.every(r => r.status === "closed"), "all rounds closed");
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASSED");

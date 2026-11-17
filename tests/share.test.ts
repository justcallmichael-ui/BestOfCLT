import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { createTestDb } from "./helpers/db";
import {
  announcementCaptions,
  countMentions,
  getEntrantShareByHandle,
  getPostsData,
  groupGameDays,
  pickPostDays,
  resultsCaptions,
  siteHost,
  splitByMentionLimit,
  voteUrl,
  type ShareMatchup,
} from "@/lib/share/posts";

let seq = 0;
function ent(handle: string, seed: number | null = 1) {
  seq++;
  return { id: `e-${seq}-${handle}`, igHandle: handle, displayName: handle.toUpperCase(), seed };
}

function mk(
  opensAt: string,
  a: string | null,
  b: string | null,
  over: Partial<ShareMatchup> = {},
): ShareMatchup {
  seq++;
  const ea = a ? ent(a) : null;
  const eb = b ? ent(b, 16) : null;
  return {
    id: `m-${seq}`,
    roundName: "Round of 64",
    roundNumber: 1,
    region: 1,
    slot: seq,
    status: "scheduled",
    opensAt,
    closesAt: new Date(Date.parse(opensAt) + 24 * 3600_000).toISOString(),
    a: ea,
    b: eb,
    votesA: null,
    votesB: null,
    winnerId: null,
    ...over,
  };
}

const D1 = "2030-03-14T16:00:00.000Z";
const D2 = "2030-03-15T16:00:00.000Z";

describe("groupGameDays", () => {
  it("groups by opens_at, orders by time and orders matchups by round then slot", () => {
    const ms = [
      mk(D2, "c", "d", { slot: 0 }),
      mk(D1, "e", "f", { slot: 5 }),
      mk(D1, "a", "b", { slot: 1 }),
      mk(D1, "g", "h", { slot: 3, roundNumber: 2, roundName: "Round of 32" }),
    ];
    const days = groupGameDays(ms);
    expect(days.map((d) => d.key)).toEqual([D1, D2]);
    expect(days[0].matchups.map((m) => m.slot)).toEqual([1, 5, 3]);
    expect(days[0].roundNames).toEqual(["Round of 64", "Round of 32"]);
    expect(days[0].handles).toEqual(["a", "b", "e", "f", "g", "h"]);
    expect(days[0].closesAt).toBe("2030-03-15T16:00:00.000Z");
  });

  it("derives the day status", () => {
    const open = groupGameDays([mk(D1, "a", "b", { status: "closed" }), mk(D1, "c", "d", { status: "open" })]);
    expect(open[0].status).toBe("open");
    const closed = groupGameDays([mk(D1, "a", "b", { status: "closed" }), mk(D1, "c", "d", { status: "closed" })]);
    expect(closed[0].status).toBe("closed");
    expect(groupGameDays([mk(D1, "a", "b")])[0].status).toBe("scheduled");
  });

  it("picks current, next and last finished days", () => {
    const D0 = "2030-03-13T16:00:00.000Z";
    const D3 = "2030-03-16T16:00:00.000Z";
    const days = groupGameDays([
      mk(D0, "a", "b", { status: "closed" }),
      mk(D1, "c", "d", { status: "closed" }),
      mk(D2, "e", "f", { status: "open" }),
      mk(D3, "g", "h"),
    ]);
    const p = pickPostDays(days);
    expect(p.last?.key).toBe(D1);
    expect(p.current?.key).toBe(D2);
    expect(p.next?.key).toBe(D3);
    expect(pickPostDays([]).current).toBeNull();
  });
});

describe("captions", () => {
  it("writes the announcement caption for an open day", () => {
    const [day] = groupGameDays([mk(D1, "joes", "marios", { status: "open" }), mk(D1, "a", "b", { status: "open" })]);
    const [c] = announcementCaptions(day, "bestofclt.com");
    expect(c).toBe(
      ["Round of 64: today's matchups are live.", "", "@joes vs @marios", "@a vs @b", "", "Vote at bestofclt.com. Link in bio."].join("\n"),
    );
  });

  it("uses the weekday for an upcoming day and skips undecided matchups", () => {
    const [day] = groupGameDays([mk(D1, "joes", "marios"), mk(D1, "x", null)]);
    const [c] = announcementCaptions(day, "bestofclt.com");
    expect(c.split("\n")[0]).toBe("Round of 64: Thursday's matchups.");
    expect(c).toContain("@joes vs @marios");
    expect(c).not.toContain("@x");
  });

  it("writes results lines with the winner first and the winner's score first", () => {
    const a = mk(D1, "joes", "marios", { status: "closed", votesA: 98, votesB: 123 });
    a.winnerId = a.b!.id;
    const b = mk(D1, "pete", "sal", { status: "closed", votesA: 40, votesB: 12 });
    b.winnerId = b.a!.id;
    const [day] = groupGameDays([a, b]);
    const [c] = resultsCaptions(day, "bestofclt.com");
    expect(c).toContain("@marios def. @joes, 123 to 98");
    expect(c).toContain("@pete def. @sal, 40 to 12");
    expect(c.split("\n")[0]).toBe("Round of 64 results.");
    expect(c.endsWith("Full bracket at bestofclt.com. Link in bio.")).toBe(true);
  });

  it("splits into numbered captions of at most 20 mentions", () => {
    const ms = Array.from({ length: 12 }, (_, i) => mk(D1, `a${i}`, `b${i}`, { status: "open" }));
    const [day] = groupGameDays(ms);
    const caps = announcementCaptions(day, "x.com");
    expect(caps).toHaveLength(2);
    expect(caps[0].split("\n")[0]).toBe("Round of 64: today's matchups are live. (1/2)");
    expect(caps[1].split("\n")[0]).toBe("Round of 64: today's matchups are live. (2/2)");
    expect(caps.map(countMentions)).toEqual([20, 4]);
    for (const c of caps) expect(c.endsWith("Vote at x.com. Link in bio.")).toBe(true);
  });

  it("allows exactly 20 mentions in one caption and never splits a matchup", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ text: `@a${i} vs @b${i}`, mentions: 2 }));
    expect(splitByMentionLimit("Intro", ten, "Out")).toHaveLength(1);
    const odd = Array.from({ length: 7 }, (_, i) => ({ text: `@a${i} @b${i} @c${i}`, mentions: 3 }));
    const caps = splitByMentionLimit("Intro", odd, "Out");
    expect(caps.map(countMentions)).toEqual([18, 3]);
  });

  it("builds the host and vote link from the site url", () => {
    expect(siteHost("https://www.bestofclt.com/")).toBe("www.bestofclt.com");
    expect(voteUrl("pizza", "https://bestofclt.com/")).toBe("https://bestofclt.com/t/pizza/vote");
  });
});

describe("with a database", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  async function seed() {
    const [t] = await db.query<{ id: string }>(
      "insert into tournaments (slug, name, category, status) values ('pizza', 'Pizza', 'pizza', 'bracket') returning id",
    );
    const ids: string[] = [];
    for (const [h, st] of [["joes", "approved"], ["marios", "approved"], ["hidden", "pending"]] as const) {
      const [e] = await db.query<{ id: string }>(
        "insert into entrants (tournament_id, ig_handle, display_name, status, seed) values ($1, $2, $3, $4, $5) returning id",
        [t.id, h, h.toUpperCase(), st, ids.length + 1],
      );
      ids.push(e.id);
    }
    const [r] = await db.query<{ id: string }>(
      `insert into rounds (tournament_id, number, name, opens_at, closes_at, status)
       values ($1, 1, 'Round of 64', now(), now() + interval '1 day', 'open') returning id`,
      [t.id],
    );
    await db.query(
      `insert into matchups (round_id, slot, entrant_a_id, entrant_b_id, status, opens_at, closes_at)
       values ($1, 0, $2, $3, 'open', '2030-01-01T17:00:00Z', '2030-01-02T17:00:00Z')`,
      [r.id, ids[0], ids[1]],
    );
    return { tid: t.id, ids };
  }

  it("assembles the posts data for the current day", async () => {
    const { tid } = await seed();
    const data = await getPostsData(tid);
    expect(data?.sections.map((s) => s.kind)).toEqual(["current"]);
    expect(data?.sections[0].tags).toEqual(["@joes", "@marios"]);
    expect(data?.sections[0].captions[0]).toContain("@joes vs @marios");
    expect(data?.voteUrl.endsWith("/t/pizza/vote")).toBe(true);
    expect(await getPostsData("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("finds approved entrants by handle only and reports the open matchup", async () => {
    await seed();
    const v = await getEntrantShareByHandle("pizza", "@JOES");
    expect(v?.current?.matchup.status).toBe("open");
    expect(v?.current?.opponent?.igHandle).toBe("marios");
    expect(await getEntrantShareByHandle("pizza", "hidden")).toBeNull();
    expect(await getEntrantShareByHandle("pizza", "nobody")).toBeNull();
    expect(await getEntrantShareByHandle("other", "joes")).toBeNull();
    expect(await getEntrantShareByHandle("pizza", "bad handle!")).toBeNull();
  });
});

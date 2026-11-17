import { describe, expect, it } from "vitest";
import { buildSchedule, nextNoonEastern, parseEasternInput } from "@/lib/services/schedule";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Noon Eastern in January (EST, UTC-5).
const START = new Date("2030-01-01T17:00:00Z");
const day = (d: number) => new Date(START.getTime() + d * DAY);

function countsByDay(fieldSize: number) {
  const out: Record<number, number> = {};
  for (const s of buildSchedule(fieldSize, START)) {
    const d = (s.opensAt.getTime() - START.getTime()) / DAY;
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

describe("buildSchedule", () => {
  it("field of 64", () => {
    const s = buildSchedule(64, START);
    expect(s).toHaveLength(63);
    expect(countsByDay(64)).toEqual({ 0: 8, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4, 7: 4, 8: 4, 9: 2, 12: 1 });

    const win = (r: number, slot: number) => s.find((x) => x.roundNumber === r && x.slot === slot)!;
    // Round of 64: one region a day, top to bottom.
    expect(win(1, 0).opensAt).toEqual(day(0));
    expect(win(1, 8).opensAt).toEqual(day(1));
    expect(win(1, 16).opensAt).toEqual(day(2));
    expect(win(1, 31).opensAt).toEqual(day(3));
    // Round of 32: regions 1 and 2, then 3 and 4.
    expect(win(2, 7).opensAt).toEqual(day(4));
    expect(win(2, 8).opensAt).toEqual(day(5));
    // Sweet 16
    expect(win(3, 3).opensAt).toEqual(day(6));
    expect(win(3, 4).opensAt).toEqual(day(7));
    // Elite 8: all four together
    expect([0, 1, 2, 3].map((i) => win(4, i).opensAt.getTime())).toEqual(Array(4).fill(day(8).getTime()));
    // Normal windows are 24 hours.
    for (const x of s.filter((x) => x.roundNumber <= 4)) {
      expect(x.closesAt.getTime() - x.opensAt.getTime()).toBe(DAY);
    }
    // Final Four and Championship are 48 hours.
    for (const slot of [0, 1]) {
      expect(win(5, slot).opensAt).toEqual(day(9));
      expect(win(5, slot).closesAt).toEqual(day(11));
    }
    expect(win(6, 0).opensAt).toEqual(day(12));
    expect(win(6, 0).closesAt).toEqual(day(14));
    expect(Math.max(...s.map((x) => x.closesAt.getTime()))).toBe(day(14).getTime());
  });

  it("field of 32", () => {
    const s = buildSchedule(32, START);
    expect(s).toHaveLength(31);
    expect(countsByDay(32)).toEqual({ 0: 8, 1: 8, 2: 4, 3: 4, 4: 4, 5: 2, 8: 1 });
    const win = (r: number, slot: number) => s.find((x) => x.roundNumber === r && x.slot === slot)!;
    expect(win(1, 3).opensAt).toEqual(day(0)); // regions 1 and 2 on day 0
    expect(win(1, 4).opensAt).toEqual(day(0));
    expect(win(1, 8).opensAt).toEqual(day(1));
    expect(win(2, 0).opensAt).toEqual(day(2));
    expect(win(2, 4).opensAt).toEqual(day(3));
    expect(win(3, 2).opensAt).toEqual(day(4));
    expect(win(4, 1).opensAt).toEqual(day(5));
    expect(win(4, 1).closesAt).toEqual(day(7));
    expect(win(5, 0).opensAt).toEqual(day(8));
    expect(win(5, 0).closesAt).toEqual(day(10));
    for (const x of s.filter((x) => x.roundNumber <= 3)) {
      expect(x.closesAt.getTime() - x.opensAt.getTime()).toBe(DAY);
    }
  });

  it("field of 16", () => {
    const s = buildSchedule(16, START);
    expect(s).toHaveLength(15);
    expect(countsByDay(16)).toEqual({ 0: 4, 1: 4, 2: 4, 3: 2, 6: 1 });
    const win = (r: number, slot: number) => s.find((x) => x.roundNumber === r && x.slot === slot)!;
    expect(win(1, 0).opensAt).toEqual(day(0));
    expect(win(1, 4).opensAt).toEqual(day(1));
    expect(win(2, 3).opensAt).toEqual(day(2));
    expect(win(3, 0).opensAt).toEqual(day(3));
    expect(win(3, 0).closesAt).toEqual(day(5));
    expect(win(4, 0).opensAt).toEqual(day(6));
    expect(win(4, 0).closesAt).toEqual(day(8));
  });

  it("rejects unsupported field sizes", () => {
    expect(() => buildSchedule(20, START)).toThrow();
  });

  it("keeps noon Eastern across the spring daylight saving change", () => {
    // Noon EST on Mar 5 2030; DST starts Sunday Mar 10.
    const start = new Date("2030-03-05T17:00:00Z");
    const s = buildSchedule(64, start);
    const opens = (r: number, slot: number) => s.find((x) => x.roundNumber === r && x.slot === slot)!.opensAt.toISOString();
    expect(opens(1, 0)).toBe("2030-03-05T17:00:00.000Z"); // day 0, EST
    expect(opens(1, 16)).toBe("2030-03-07T17:00:00.000Z"); // day 2, EST
    expect(opens(3, 4)).toBe("2030-03-12T16:00:00.000Z"); // day 7, EDT, still noon
    expect(opens(6, 0)).toBe("2030-03-17T16:00:00.000Z"); // day 12
  });
});

describe("nextNoonEastern", () => {
  const at = (iso: string) => nextNoonEastern(new Date(iso)).toISOString();

  it("January (EST, UTC-5)", () => {
    expect(at("2030-01-15T10:00:00Z")).toBe("2030-01-15T17:00:00.000Z");
    expect(at("2030-01-15T17:00:00Z")).toBe("2030-01-15T17:00:00.000Z"); // exactly noon counts
    expect(at("2030-01-15T17:00:01Z")).toBe("2030-01-16T17:00:00.000Z");
    expect(at("2030-01-16T03:00:00Z")).toBe("2030-01-16T17:00:00.000Z"); // still the 15th in Eastern
  });

  it("July (EDT, UTC-4)", () => {
    expect(at("2030-07-15T10:00:00Z")).toBe("2030-07-15T16:00:00.000Z");
    expect(at("2030-07-15T16:00:00Z")).toBe("2030-07-15T16:00:00.000Z");
    expect(at("2030-07-15T16:00:01Z")).toBe("2030-07-16T16:00:00.000Z");
  });

  it("spring forward day (Sunday March 10 2030)", () => {
    expect(at("2030-03-09T18:00:00Z")).toBe("2030-03-10T16:00:00.000Z"); // after noon EST Saturday -> noon EDT Sunday
    expect(at("2030-03-10T05:00:00Z")).toBe("2030-03-10T16:00:00.000Z"); // midnight EST
    expect(at("2030-03-10T06:59:00Z")).toBe("2030-03-10T16:00:00.000Z"); // 1:59 EST, just before the jump
    expect(at("2030-03-10T07:00:00Z")).toBe("2030-03-10T16:00:00.000Z"); // 3:00 EDT
    expect(at("2030-03-10T16:00:01Z")).toBe("2030-03-11T16:00:00.000Z");
  });

  it("fall back day (Sunday November 3 2030)", () => {
    expect(at("2030-11-02T17:00:00Z")).toBe("2030-11-03T17:00:00.000Z"); // 1 PM EDT Saturday -> noon EST Sunday
    expect(at("2030-11-03T05:30:00Z")).toBe("2030-11-03T17:00:00.000Z"); // 1:30 AM EDT, first pass
    expect(at("2030-11-03T06:30:00Z")).toBe("2030-11-03T17:00:00.000Z"); // 1:30 AM EST, second pass
    expect(at("2030-11-03T17:00:00Z")).toBe("2030-11-03T17:00:00.000Z");
    expect(at("2030-11-03T17:30:00Z")).toBe("2030-11-04T17:00:00.000Z");
  });
});

describe("parseEasternInput", () => {
  it("reads datetime-local values as Eastern wall clock", () => {
    expect(parseEasternInput("2030-01-05T12:00")!.toISOString()).toBe("2030-01-05T17:00:00.000Z");
    expect(parseEasternInput("2030-07-05T12:00")!.toISOString()).toBe("2030-07-05T16:00:00.000Z");
    expect(parseEasternInput("nonsense")).toBeNull();
  });
});

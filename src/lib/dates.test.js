import { describe, expect, it } from "vitest";
import { bookingDateState, daysUntil, fmtGB, localISODate, monthKey, rangesOverlap, today } from "./dates";

// The facility is in the UK; pin the zone so BST edge cases are exercised
// whatever machine runs the tests.
process.env.TZ = "Europe/London";

describe("today / localISODate", () => {
  it("uses the local calendar date, not the UTC one", () => {
    // 00:30 on 2 July in BST is still 1 July in UTC.
    const justAfterMidnightBST = new Date("2026-07-01T23:30:00Z");
    expect(localISODate(justAfterMidnightBST)).toBe("2026-07-02");
    expect(today(justAfterMidnightBST).toISOString()).toBe("2026-07-02T00:00:00.000Z");
  });

  it("matches how booking dates parse, so day counts are exact", () => {
    const t = today(new Date("2026-03-10T09:00:00Z"));
    expect(daysUntil("2026-03-10", t)).toBe(0);
    expect(daysUntil("2026-03-11", t)).toBe(1);
    expect(daysUntil("2026-03-09", t)).toBe(-1);
    // Across the spring clock change (29 March 2026).
    expect(daysUntil("2026-04-10", t)).toBe(31);
  });

  it("accepts timestamps, using their date part", () => {
    const t = today(new Date("2026-03-10T09:00:00Z"));
    expect(daysUntil("2026-03-12T15:45:00+00:00", t)).toBe(2);
  });
});

describe("bookingDateState", () => {
  const t = today(new Date("2026-05-15T12:00:00Z"));
  it.each([
    ["2026-05-16", "2026-06-01", "upcoming"],
    ["2026-05-15", "2026-06-01", "current"],
    ["2026-05-01", "2026-05-18", "current"],
    ["2026-05-01", "2026-05-17", "warning"],
    ["2026-05-01", "2026-05-15", "warning"],
    ["2026-05-01", "2026-05-14", "overdue"],
  ])("%s → %s is %s", (start, end, expected) => {
    expect(bookingDateState(start, end, t)).toBe(expected);
  });
});

describe("rangesOverlap", () => {
  it("is inclusive at both ends", () => {
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-10", "2026-01-20")).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-01-09", "2026-01-10", "2026-01-20")).toBe(false);
    expect(rangesOverlap("2026-02-01", "2026-02-28", "2026-01-01", "2026-12-31")).toBe(true);
  });
});

describe("formatting", () => {
  it("fmtGB shows DD/MM/YYYY and tolerates blanks", () => {
    expect(fmtGB("2026-09-04")).toBe("04/09/2026");
    expect(fmtGB("2026-09-04T10:00:00Z")).toBe("04/09/2026");
    expect(fmtGB(null)).toBe("-");
    expect(fmtGB("")).toBe("-");
  });
  it("monthKey is the YYYY-MM prefix", () => {
    expect(monthKey("2026-09-30")).toBe("2026-09");
  });
});

import { describe, expect, it, vi } from "vitest";

// api.js creates the Supabase client on import; these tests only cover its
// pure helpers, so stand the client in with an empty object.
vi.mock("./supabaseClient", () => ({ supabase: {} }));
const { computeLabUsage, safeFileName } = await import("./api");

describe("computeLabUsage", () => {
  const labs = { a: "Lab A", b: "Lab B" };
  const keys = ["2026-08", "2026-09", "2026-10"];

  it("counts distinct units per lab per month", () => {
    const series = computeLabUsage([
      { unit_id: "GC-01", lab_group_id: "a", start_date: "2026-08-10", end_date: "2026-09-05" },
      { unit_id: "GC-02", lab_group_id: "a", start_date: "2026-09-01", end_date: "2026-09-02" },
      { unit_id: "GC-01", lab_group_id: "a", start_date: "2026-09-20", end_date: "2026-10-01" }, // same unit again in Sep
      { unit_id: "R-01", lab_group_id: "b", start_date: "2026-10-31", end_date: "2027-01-31" },
    ], labs, keys);
    expect(series["Lab A"]).toEqual([1, 2, 1]);
    expect(series["Lab B"]).toEqual([0, 0, 1]);
  });

  it("counts a booking that starts on the last day of a summer-time month", () => {
    // Regression: comparing UTC-parsed dates with local month bounds used
    // to drop this from September during BST.
    const series = computeLabUsage([
      { unit_id: "GC-01", lab_group_id: "a", start_date: "2026-09-30", end_date: "2026-10-02" },
    ], labs, keys);
    expect(series["Lab A"]).toEqual([0, 1, 1]);
  });

  it("ignores bookings for unknown or deleted lab groups", () => {
    const series = computeLabUsage([
      { unit_id: "GC-01", lab_group_id: null, start_date: "2026-09-01", end_date: "2026-09-30" },
    ], labs, keys);
    expect(series).toEqual({ "Lab A": [0, 0, 0], "Lab B": [0, 0, 0] });
  });
});

describe("safeFileName", () => {
  it("keeps names readable but storage-safe", () => {
    expect(safeFileName("Calibration Certificate (2027).pdf")).toBe("Calibration-Certificate-2027.pdf");
    expect(safeFileName("Résumé été.pdf")).toBe("Resume-ete.pdf");
    expect(safeFileName("#?%")).toBe("file");
  });
});

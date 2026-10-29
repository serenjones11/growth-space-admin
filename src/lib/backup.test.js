import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./supabaseClient", () => ({ supabase: {} }));
const { buildSheets, computeUsage } = await import("./backup");

process.env.TZ = "Europe/London";

// Synthetic data only - shaped like the PostgREST rows fetchBackupData()
// returns. "Today" is pinned to 22/10/2026.
const unit = (over) => ({
  id: "GC-01", type: "cabinet", floor: "L1", room: "Room 1.04", manufacturer: "Maker", model: "M1",
  serial_number: null, asset_number: null, tscan_id: null, shelves: 3, lighting_type: "LED", ballasts: "",
  co2_control: false, dimming_control: false, temp_min: 4, temp_max: 30, humidity_min: 30, humidity_max: 85,
  is_out_of_service: false, install_date: "2026-09-04", notes: null, set_day_temp: null, set_night_temp: null,
  set_humidity: null, set_light_cycle: null, set_light_intensity: null, ...over,
});
const req = (over) => ({
  id: "r1", code: "R26-0001", researcher_name: "Test Researcher", email: "test@example.com", role: "PhD Student",
  emergency_number: "000", lab_group_id: "lab1", pi_name: "Test PI", unit_type: "cabinet", discipline: "plant",
  species: ["Species A"], containment_level: "GMO", space_description: null, project_title: "Project",
  project_desc: null, set_temp: 22, night_temp: 18, set_humidity: 60, light_cycle: "16/8h (L/D)",
  pest_consent: true, invertebrate_welfare_ack: false, dimming_required: false, safety_compliance: true,
  preferred_floor: "any", start_date: "2026-10-01", end_date: "2026-12-01", hazard_notes: null, notes: null,
  status: "approved", assigned_unit_id: "GC-01", submitted_date: "2026-09-20T10:00:00+00:00",
  decided_date: "2026-09-21T10:00:00+00:00", decided_by: "admin1", completed_date: null, completed_by: null,
  admin_notes: null, dawn_time: null, dusk_time: null, amended_at: null, amended_fields: [], amended_previous: null,
  ...over,
});
const booking = (over) => ({
  unit_id: "GC-01", requisition_id: "r1", researcher_name: "Test Researcher",
  start_date: "2026-10-01", end_date: "2026-12-01", requisitions: { status: "approved", code: "R26-0001" }, ...over,
});

const data = {
  units: [
    unit({ id: "GC-01" }),
    unit({ id: "GC-02", is_out_of_service: true }),
    unit({ id: "R-01", type: "reftech", floor: "LG", shelves: null, disciplines: ["plant", "insect"] }),
    unit({ id: "GC-03" }),
  ],
  requisitions: [
    req({}),
    // An approved requisition whose amendment (longer end date) is under review.
    req({
      id: "r2", code: "R26-0002", status: "pending", unit_type: "reftech", discipline: "insect", assigned_unit_id: "R-01",
      start_date: "2026-10-20", end_date: "2027-02-28", invertebrate_welfare_ack: true,
      amended_at: "2026-10-15T09:00:00+00:00", amended_fields: ["end_date"],
      amended_previous: { status: "approved", end_date: "2027-01-31", submitted_date: "2026-08-01T09:00:00+00:00" },
      submitted_date: "2026-10-15T09:00:00+00:00",
    }),
    req({ id: "r3", code: "R26-0003", status: "declined", assigned_unit_id: null, decided_by: "gone" }),
    req({ id: "r4", code: "R26-0004", start_date: "2026-10-01", end_date: "2026-10-23", assigned_unit_id: "GC-01" }),
  ],
  bookings: [
    booking({}),
    booking({ unit_id: "R-01", requisition_id: "r2", start_date: "2026-10-20", end_date: "2027-01-31", requisitions: { status: "pending", code: "R26-0002" } }),
    booking({ requisition_id: "r4", start_date: "2026-10-01", end_date: "2026-10-23", requisitions: { status: "approved", code: "R26-0004" } }),
  ],
  serviceLog: [
    { unit_id: "R-01", date: "2026-10-01", status: "completed", contractor: "C1", notes: "n", cost: null, created_by: "admin1", maintenance_categories: { name: "Spraying" } },
    { unit_id: "GC-02", date: "2026-09-04", status: "completed", contractor: "C2", notes: "n", cost: 45.5, created_by: "admin1", maintenance_categories: { name: "Bulbs" } },
    { unit_id: "GC-02", date: "2026-11-20", status: "scheduled", contractor: null, notes: "n", cost: null, created_by: null, maintenance_categories: null },
  ],
  profiles: [{ id: "admin1", full_name: "Facility Admin" }],
  labGroups: [{ id: "lab1", name: "Test Lab", pi_name: "Test PI" }],
};

const utcDay = (iso) => new Date(`${iso}T00:00:00Z`);

describe("buildSheets", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T09:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });

  const sheet = (name) => buildSheets(data).find((s) => s.name === name);

  it("has the three data tabs in order", () => {
    expect(buildSheets(data).map((s) => s.name)).toEqual(["Units", "Requisitions", "Maintenance"]);
  });

  it("works out each unit's status from its active bookings", () => {
    const byId = Object.fromEntries(sheet("Units").rows.map((r) => [r.id, r]));
    // GC-01 holds r1 (current) and r4 (ends tomorrow) - the earliest end wins.
    expect(byId["GC-01"].status).toBe("Ending soon");
    expect(byId["GC-01"].current).toBe("R26-0004 Test Researcher; R26-0001 Test Researcher");
    expect(byId["GC-02"].status).toBe("Out of service");
    // R-01's booking is still in force while its amendment is reviewed.
    expect(byId["R-01"].status).toBe("Occupied");
    expect(byId["R-01"].current).toBe("R26-0002 Test Researcher");
    expect(byId["GC-03"].status).toBe("Free to book");
    expect(byId["R-01"].area).toBe("Plant Sciences & Insect Sciences");
    expect(byId["GC-03"].area).toBe("");
    expect(byId["GC-03"].current).toBe("");
    expect(byId["GC-01"].installed).toEqual(utcDay("2026-09-04"));
  });

  it("shows booked dates only where they differ from the requested ones", () => {
    const byCode = Object.fromEntries(sheet("Requisitions").rows.map((r) => [r.code, r]));
    expect(byCode["R26-0002"].bookedEnd).toEqual(utcDay("2027-01-31"));
    expect(byCode["R26-0002"].end).toEqual(utcDay("2027-02-28"));
    expect(byCode["R26-0001"].bookedStart).toBeNull();
    expect(byCode["R26-0001"].bookedEnd).toBeNull();
  });

  it("keeps the original submission date and lists amended fields", () => {
    const r2 = sheet("Requisitions").rows.find((r) => r.code === "R26-0002");
    expect(r2.submitted).toEqual(utcDay("2026-08-01"));
    expect(r2.amendedFields).toBe("End date");
    expect(r2.status).toBe("Pending review");
    expect(r2.state).toBe("");
  });

  it("fills discipline-specific consents only where they apply", () => {
    const byCode = Object.fromEntries(sheet("Requisitions").rows.map((r) => [r.code, r]));
    expect(byCode["R26-0001"].pest).toBe("Yes");
    expect(byCode["R26-0001"].welfare).toBe("");
    expect(byCode["R26-0002"].pest).toBe("");
    expect(byCode["R26-0002"].welfare).toBe("Yes");
  });

  it("names people from profiles, blank when the profile is gone", () => {
    const byCode = Object.fromEntries(sheet("Requisitions").rows.map((r) => [r.code, r]));
    expect(byCode["R26-0001"].decidedBy).toBe("Facility Admin");
    expect(byCode["R26-0003"].decidedBy).toBe("");
    expect(byCode["R26-0001"].state).toBe("Current");
    expect(byCode["R26-0004"].state).toBe("Ending soon");
  });

  it("sorts maintenance by unit, newest first", () => {
    expect(sheet("Maintenance").rows.map((r) => `${r.unit} ${r.status}`)).toEqual([
      "GC-02 Scheduled", "GC-02 Completed", "R-01 Completed",
    ]);
    expect(sheet("Maintenance").rows[0].category).toBe("");
    expect(sheet("Maintenance").rows[1].cost).toBe(45.5);
  });
});

describe("computeUsage", () => {
  const usageData = {
    units: [unit({ id: "GC-01" }), unit({ id: "GC-02" })],
    requisitions: [
      req({ id: "a", status: "completed", completed_date: "2026-10-10T17:00:00+00:00" }),
      req({ id: "b", status: "completed", completed_date: "2026-10-14T17:00:00+00:00", lab_group_id: "lab2" }),
      req({ id: "c", status: "completed", completed_date: "2026-09-10T12:00:00+00:00" }),
      req({ id: "d", status: "approved" }),
    ],
    bookings: [
      // GC-01: 1-10 Oct, shared with another lab 5-14 Oct -> 14 distinct days.
      booking({ requisition_id: "a", unit_id: "GC-01", lab_group_id: "lab1", discipline: "plant", start_date: "2026-10-01", end_date: "2026-10-10", requisitions: { status: "completed" } }),
      booking({ requisition_id: "b", unit_id: "GC-01", lab_group_id: "lab2", discipline: "insect", start_date: "2026-10-05", end_date: "2026-10-14", requisitions: { status: "completed" } }),
      // GC-02: booked to 30 Sep but completed early on 10 Sep -> 1-10 Sep only.
      booking({ requisition_id: "c", unit_id: "GC-02", lab_group_id: "lab1", discipline: "plant", start_date: "2026-09-01", end_date: "2026-09-30", requisitions: { status: "completed" } }),
      // GC-02: ended 15 Oct, never completed -> still occupying to today (22 Oct).
      booking({ requisition_id: "d", unit_id: "GC-02", lab_group_id: "lab1", discipline: "plant", start_date: "2026-10-12", end_date: "2026-10-15", requisitions: { status: "approved" } }),
    ],
    labGroups: [{ id: "lab1", name: "Test Lab" }, { id: "lab2", name: "Other Lab" }],
  };
  const usage = computeUsage(usageData, "2026-10-22");
  const oct = usage.months.length - 1, sep = oct - 1;

  it("covers the 12 months to the current one, which runs to today", () => {
    expect(usage.months).toHaveLength(12);
    expect(usage.months[0].label).toBe("Nov 2025");
    expect(usage.months[oct].label).toBe("Oct 2026 (to date)");
    expect(usage.months[oct].days).toBe(22);
    expect(usage.months[sep].days).toBe(30);
  });

  it("counts a shared cabinet's overlapping days once for the unit", () => {
    const gc01 = usage.unitRows.find((r) => r.name === "GC-01");
    expect(gc01.days).toBe(14);
    expect(gc01.perMonth[oct]).toBeCloseTo(14 / 22);
  });

  it("stops a completed booking at its completion date and runs an overdue one to today", () => {
    const gc02 = usage.unitRows.find((r) => r.name === "GC-02");
    expect(gc02.perMonth[sep]).toBeCloseTo(10 / 30);
    expect(gc02.perMonth[oct]).toBeCloseTo(11 / 22); // 12-22 Oct
  });

  it("totals unit-days per lab group and research area", () => {
    expect(usage.labRows.map((r) => [r.name, r.days])).toEqual([["Other Lab", 10], ["Test Lab", 31]]);
    expect(usage.areaRows.map((r) => [r.name, r.days])).toEqual([["Insect Sciences", 10], ["Plant Sciences", 31]]);
  });
});

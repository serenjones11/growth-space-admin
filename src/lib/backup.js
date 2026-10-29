/* Full backup workbook (Dashboard -> "Full backup"): one .xlsx with a
   Summary tab plus Units, Requisitions and Maintenance - everything,
   unfiltered, in readable form (names not IDs, DD/MM/YYYY dates, Yes/No).
   A human-readable record for a loss of service, not something the app
   re-imports. ExcelJS is loaded only when the button is clicked, so it
   doesn't weigh down the app's normal load. */
import * as api from "./api";
import { bookingDateState, daysUntil, ENDING_SOON_DAYS, localISODate } from "./dates";

const UNIT_TYPE = { cabinet: "Growth cabinet", reftech: "Reftech room" };
const FLOOR = { LG: "LG", L1: "Level 1", L2A: "Level 2a", L2B: "Level 2b", L3: "Level 3" };
const DISCIPLINE = { plant: "Plant Sciences", insect: "Insect Sciences" };
const REQ_STATUS = { pending: "Pending review", approved: "Approved", declined: "Declined", completed: "Completed" };
// Column names a researcher's amendment can change (requisitions.amended_fields).
const FIELD_LABEL = {
  researcher_name: "Name", email: "Email", role: "Role", emergency_number: "Emergency number",
  lab_group_id: "PI", pi_name: "PI", unit_type: "Space type", discipline: "Research area",
  species: "Species", containment_level: "Containment level", space_description: "Space required",
  project_title: "Project title", project_desc: "Purpose of project", set_temp: "Day temp",
  night_temp: "Night temp", set_humidity: "RH", light_cycle: "Light cycle", dawn_time: "Dawn",
  dusk_time: "Dusk", pest_consent: "Pest outbreak consent", invertebrate_welfare_ack: "Invertebrate Welfare Policy",
  dimming_required: "Dimming required", safety_compliance: "Safety compliance", preferred_floor: "Preferred floor",
  start_date: "Start date", end_date: "End date", hazard_notes: "Hazard notes", notes: "Researcher notes",
};

// A "YYYY-MM-DD..." value as a real Excel date (shown DD/MM/YYYY), so it sorts as a date.
const asDate = (v) => {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const yesNo = (v) => (v ? "Yes" : "No");
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const hhmm = (v) => (v ? String(v).slice(0, 5) : "");
const fmtDateTime = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* Booking state from dates - the same rules as the app's status colours. */
const DATE_STATE_LABEL = { upcoming: "Upcoming", overdue: "Overdue", warning: "Ending soon", current: "Current" };
const dateState = (start, end) => DATE_STATE_LABEL[bookingDateState(start, end)];

/* ---- Usage report ----
   How much each unit was occupied, month by month, over the last 12 months
   (the current month counted to today), plus booked unit-days per lab group
   and per research area. A booking occupies a unit from its start date to
   its end date - or to when it was marked completed, if that was earlier;
   one past its end date but not yet completed still occupies it to today.
   Overlapping bookings on one unit (a shared cabinet, a reftech room's
   several occupants) count that day once for the unit's occupancy, but
   each lab's day separately in the lab and research-area tables. */
const MONTH_NAME = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNum = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

function computeUsage(data, todayISO = localISODate()) {
  const today = dayNum(todayISO);
  const [ty, tm] = todayISO.split("-").map(Number);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const first = new Date(Date.UTC(ty, tm - 1 - i, 1));
    const start = first.getTime() / 86400000;
    const nextStart = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1) / 86400000;
    const end = Math.min(nextStart - 1, today);
    months.push({ label: `${MONTH_NAME[first.getUTCMonth()]} ${first.getUTCFullYear()}${i === 0 ? " (to date)" : ""}`, start, end, days: end - start + 1 });
  }
  const windowStart = months[0].start;

  const reqById = Object.fromEntries(data.requisitions.map((r) => [r.id, r]));
  const labName = Object.fromEntries(data.labGroups.map((g) => [g.id, g.name]));
  const spans = data.bookings
    .filter((b) => ["approved", "pending", "completed"].includes(b.requisitions?.status))
    .map((b) => {
      const req = reqById[b.requisition_id];
      let end = dayNum(b.end_date);
      if (b.requisitions.status === "completed" && req?.completed_date) end = Math.min(end, dayNum(req.completed_date));
      else if (end < today) end = today; // past its end date, not yet completed
      return {
        unit: b.unit_id, lab: labName[b.lab_group_id] || "No lab group",
        area: DISCIPLINE[b.discipline] || "Not set",
        start: Math.max(dayNum(b.start_date), windowStart), end: Math.min(end, today),
      };
    })
    .filter((x) => x.end >= x.start);

  const daysIn = (x, m) => Math.max(0, Math.min(x.end, m.end) - Math.max(x.start, m.start) + 1);

  const unitRows = data.units.map((u) => {
    const own = spans.filter((x) => x.unit === u.id);
    let total = 0;
    const perMonth = months.map((m) => {
      const covered = new Set();
      own.forEach((x) => { for (let d = Math.max(x.start, m.start); d <= Math.min(x.end, m.end); d++) covered.add(d); });
      total += covered.size;
      return covered.size / m.days;
    });
    const allDays = months.reduce((n, m) => n + m.days, 0);
    return { name: u.id, type: UNIT_TYPE[u.type] || u.type, perMonth, days: total, overall: total / allDays };
  });

  const groupBy = (key) => {
    const names = [...new Set(spans.map((x) => x[key]))].sort((a, b) => a.localeCompare(b));
    return names.map((name) => {
      const perMonth = months.map((m) => spans.filter((x) => x[key] === name).reduce((n, x) => n + daysIn(x, m), 0));
      return { name, perMonth, days: perMonth.reduce((a, b) => a + b, 0) };
    });
  };
  return { months, unitRows, labRows: groupBy("lab"), areaRows: groupBy("area") };
}

function addUsageSheet(wb, usage) {
  const ws = wb.addWorksheet("Usage", { views: [{ state: "frozen", xSplit: 1 }] });
  ws.getColumn(1).width = 24;
  usage.months.forEach((_, i) => { ws.getColumn(i + 2).width = 12; });
  ws.getColumn(usage.months.length + 2).width = 14;
  ws.getColumn(usage.months.length + 3).width = 14;

  const title = ws.addRow(["Usage report - last 12 months"]);
  title.font = { bold: true, size: 14 };
  const intro = ws.addRow(["Occupancy is the share of each month's days a unit had a booking in it. A booking counts until its end date, or until it was marked completed if sooner."]);
  intro.font = { italic: true, color: { argb: "FF5C6D65" } };

  const table = (heading, firstCol, rows, { percent, extra }) => {
    ws.addRow([]);
    ws.addRow([heading]).font = { bold: true, size: 12 };
    const head = ws.addRow([firstCol, ...usage.months.map((m) => m.label), ...extra.map((e) => e.header)]);
    head.font = { bold: true };
    head.eachCell((c) => { c.fill = HEADER_FILL; c.border = HEADER_BORDER; c.alignment = { wrapText: true, vertical: "top" }; });
    if (!rows.length) { ws.addRow(["No bookings in this period"]).font = { italic: true }; return; }
    rows.forEach((r) => {
      const row = ws.addRow([r.name, ...r.perMonth, ...extra.map((e) => e.value(r))]);
      if (percent) usage.months.forEach((_, i) => { row.getCell(i + 2).numFmt = "0%"; });
      extra.forEach((e, i) => { if (e.numFmt) row.getCell(usage.months.length + 2 + i).numFmt = e.numFmt; });
    });
  };
  table("Occupancy by unit", "Unit", usage.unitRows, {
    percent: true,
    extra: [{ header: "Days occupied", value: (r) => r.days }, { header: "12-month occupancy", value: (r) => r.overall, numFmt: "0%" }],
  });
  table("Booked unit-days by lab group", "Lab group", usage.labRows, { percent: false, extra: [{ header: "Total", value: (r) => r.days }] });
  table("Booked unit-days by research area", "Research area", usage.areaRows, { percent: false, extra: [{ header: "Total", value: (r) => r.days }] });
}

/* Each sheet: [{ header, key, date?, width? }] columns + plain row objects. */
function buildSheets(data) {
  const nameById = Object.fromEntries(data.profiles.map((p) => [p.id, p.full_name || ""]));
  const labById = Object.fromEntries(data.labGroups.map((g) => [g.id, g]));
  const unitById = Object.fromEntries(data.units.map((u) => [u.id, u]));
  const reqCodeById = Object.fromEntries(data.requisitions.map((r) => [r.id, r.code || ""]));

  // Bookings still in force: approved, or approved and now under amendment review.
  const activeBookings = data.bookings.filter((b) => ["approved", "pending"].includes(b.requisitions?.status));
  const bookingByReq = Object.fromEntries(data.bookings.map((b) => [b.requisition_id, b]));

  /* ---- Units ---- */
  const units = data.units.map((u) => {
    const current = activeBookings
      .filter((b) => b.unit_id === u.id && daysUntil(b.start_date) <= 0)
      .sort((a, b) => a.end_date.localeCompare(b.end_date));
    let status = "Free to book";
    if (u.is_out_of_service) status = "Out of service";
    else if (current.length) {
      const left = daysUntil(current[0].end_date);
      status = left < 0 ? "Overdue" : left <= ENDING_SOON_DAYS ? "Ending soon" : "Occupied";
    }
    return {
      id: u.id, type: UNIT_TYPE[u.type] || u.type,
      area: (u.disciplines || []).map((d) => DISCIPLINE[d] || d).join(" & "),
      floor: FLOOR[u.floor] || u.floor, room: u.room,
      manufacturer: u.manufacturer, model: u.model, serial: u.serial_number, asset: u.asset_number, tscan: u.tscan_id,
      shelves: num(u.shelves), lighting: u.lighting_type, ballasts: u.ballasts,
      co2: yesNo(u.co2_control), dimming: yesNo(u.dimming_control),
      tMin: num(u.temp_min), tMax: num(u.temp_max), hMin: num(u.humidity_min), hMax: num(u.humidity_max),
      setDay: num(u.set_day_temp), setNight: num(u.set_night_temp), setRh: num(u.set_humidity),
      setCycle: u.set_light_cycle || "", setLight: num(u.set_light_intensity),
      setDawn: hhmm(u.set_dawn_time), setDusk: hhmm(u.set_dusk_time),
      status,
      current: current.map((b) => `${reqCodeById[b.requisition_id] || ""} ${b.researcher_name}`.trim()).join("; "),
      installed: asDate(u.install_date), notes: u.notes || "",
    };
  });

  /* ---- Requisitions ---- */
  const requisitions = data.requisitions.map((r) => {
    const unit = unitById[r.assigned_unit_id];
    const booking = bookingByReq[r.id];
    // Booked dates only where they differ from the requested ones - an
    // approved requisition whose amendment is still under review.
    const bookedDiffers = booking && (booking.start_date !== r.start_date || booking.end_date !== r.end_date);
    const isPlant = r.discipline === "plant";
    const prev = r.amended_previous || {};
    return {
      code: r.code, status: REQ_STATUS[r.status] || r.status,
      state: r.status === "approved" ? dateState(r.start_date, r.end_date) : "",
      researcher: r.researcher_name, email: r.email, role: r.role || "", emergency: r.emergency_number || "",
      pi: r.pi_name || labById[r.lab_group_id]?.pi_name || "",
      spaceType: UNIT_TYPE[r.unit_type] || r.unit_type, area: DISCIPLINE[r.discipline] || r.discipline,
      species: (r.species || []).join("; "), containment: r.containment_level || "",
      title: r.project_title, purpose: r.project_desc || "", space: r.space_description || "",
      dayTemp: num(r.set_temp), nightTemp: num(r.night_temp), rh: num(r.set_humidity),
      cycle: r.light_cycle || "", dawn: hhmm(r.dawn_time), dusk: hhmm(r.dusk_time),
      pest: isPlant ? yesNo(r.pest_consent) : "", welfare: isPlant ? "" : yesNo(r.invertebrate_welfare_ack),
      dimmingReq: isPlant ? "" : yesNo(r.dimming_required), safety: yesNo(r.safety_compliance),
      floorPref: r.preferred_floor && r.preferred_floor !== "any" ? FLOOR[r.preferred_floor] || r.preferred_floor : "No preference",
      start: asDate(r.start_date), end: asDate(r.end_date),
      unit: r.assigned_unit_id || "", unitFloor: unit ? FLOOR[unit.floor] || unit.floor : "", unitRoom: unit ? unit.room : "",
      bookedStart: bookedDiffers ? asDate(booking.start_date) : null, bookedEnd: bookedDiffers ? asDate(booking.end_date) : null,
      hazard: r.hazard_notes || "", notes: r.notes || "", adminNotes: r.admin_notes || "",
      // An amendment resets submitted_date - the original is kept with the amendment record.
      submitted: asDate(r.amended_at && prev.submitted_date ? prev.submitted_date : r.submitted_date),
      decided: asDate(r.decided_date), decidedBy: nameById[r.decided_by] || "",
      completed: asDate(r.completed_date), completedBy: nameById[r.completed_by] || "",
      amended: asDate(r.amended_at),
      amendedFields: [...new Set((r.amended_fields || []).map((f) => FIELD_LABEL[f] || f))].join("; "),
    };
  });

  /* ---- Maintenance ---- */
  const maintenance = data.serviceLog
    .slice()
    .sort((a, b) => a.unit_id.localeCompare(b.unit_id, undefined, { numeric: true }) || b.date.localeCompare(a.date))
    .map((s) => ({
      unit: s.unit_id, date: asDate(s.date), status: s.status === "scheduled" ? "Scheduled" : "Completed",
      category: s.maintenance_categories?.name || "", contractor: s.contractor || "", notes: s.notes || "",
      cost: num(s.cost), by: nameById[s.created_by] || "",
    }));

  const sheets = [
    {
      name: "Units",
      rows: units,
      columns: [
        ["Unit ID", "id"], ["Type", "type"], ["Research area", "area"], ["Floor", "floor"], ["Room", "room"], ["Manufacturer", "manufacturer"], ["Model", "model"],
        ["Serial no.", "serial"], ["Asset no.", "asset"], ["TSCAN ID", "tscan"], ["Shelves", "shelves"], ["Lighting type", "lighting"],
        ["Ballasts", "ballasts"], ["CO₂ control", "co2"], ["Dimming control", "dimming"],
        ["Temp range min (°C)", "tMin"], ["Temp range max (°C)", "tMax"], ["Humidity range min (%)", "hMin"], ["Humidity range max (%)", "hMax"],
        ["Set day temp (°C)", "setDay"], ["Set night temp (°C)", "setNight"], ["Set RH (%)", "setRh"], ["Set light cycle", "setCycle"],
        ["Set light intensity (µmol/m²/s)", "setLight"], ["Set dawn", "setDawn"], ["Set dusk", "setDusk"],
        ["Status", "status"], ["Current requisition(s)", "current"],
        ["Install date", "installed", true], ["Notes", "notes"],
      ],
    },
    {
      name: "Requisitions",
      rows: requisitions,
      columns: [
        ["Code", "code"], ["Status", "status"], ["Booking state", "state"], ["Researcher", "researcher"], ["Email", "email"],
        ["Role", "role"], ["Emergency number", "emergency"], ["PI", "pi"], ["Space type", "spaceType"], ["Research area", "area"],
        ["Species", "species"], ["Containment level", "containment"], ["Project title", "title"], ["Purpose of project", "purpose"],
        ["Space required", "space"], ["Day temp (°C)", "dayTemp"], ["Night temp (°C)", "nightTemp"], ["RH (%)", "rh"],
        ["Light cycle", "cycle"], ["Dawn", "dawn"], ["Dusk", "dusk"], ["Pest outbreak consent", "pest"],
        ["Invertebrate Welfare Policy", "welfare"], ["Dimming required", "dimmingReq"], ["Safety compliance", "safety"],
        ["Preferred floor", "floorPref"], ["Start date", "start", true], ["End date", "end", true], ["Assigned unit", "unit"],
        ["Unit floor", "unitFloor"], ["Unit room", "unitRoom"], ["Booked start", "bookedStart", true], ["Booked end", "bookedEnd", true],
        ["Hazard notes", "hazard"], ["Researcher notes", "notes"], ["Admin notes", "adminNotes"],
        ["Submitted", "submitted", true], ["Decided", "decided", true], ["Decided by", "decidedBy"],
        ["Completed", "completed", true], ["Completed by", "completedBy"], ["Last amended", "amended", true], ["Fields amended", "amendedFields"],
      ],
    },
    {
      name: "Maintenance",
      rows: maintenance,
      columns: [
        ["Unit ID", "unit"], ["Date", "date", true], ["Status", "status"], ["Category", "category"],
        ["Contractor", "contractor"], ["Notes", "notes"], ["Cost (£)", "cost"], ["Logged by", "by"],
      ],
    },
  ];
  return sheets;
}

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F2EC" } };
const HEADER_BORDER = { bottom: { style: "medium", color: { argb: "FF9DB8A8" } } };

function addDataSheet(wb, sheet) {
  const ws = wb.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = sheet.columns.map(([header, key, isDate]) => {
    // Width from the longest value, within sensible bounds.
    const longest = Math.max(header.length, ...sheet.rows.map((r) => (isDate ? 10 : String(r[key] ?? "").length)));
    return { header, key, width: Math.min(60, Math.max(8, longest + 2)), style: isDate ? { numFmt: "dd/mm/yyyy" } : {} };
  });
  sheet.rows.forEach((r) => ws.addRow(r));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.eachCell((c) => { c.fill = HEADER_FILL; c.border = HEADER_BORDER; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
}

/* Builds and downloads the workbook. Returns the filename. */
export async function downloadFullBackup({ exportedBy }) {
  const [{ default: ExcelJS }, data] = await Promise.all([import("exceljs"), api.fetchBackupData()]);
  const sheets = buildSheets(data);
  const now = new Date();

  const wb = new ExcelJS.Workbook();
  wb.creator = "Growth Space Admin";
  wb.created = now;

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 18 }, { width: 14 }];
  summary.getCell("A1").value = "GrowSpace - full backup";
  summary.getCell("A1").font = { bold: true, size: 14 };
  summary.addRow(["Exported", fmtDateTime(now)]);
  summary.addRow(["Exported by", exportedBy || ""]);
  summary.addRow([]);
  const head = summary.addRow(["Tab", "Rows"]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = HEADER_FILL; c.border = HEADER_BORDER; });
  sheets.forEach((s) => summary.addRow([s.name, s.rows.length]));
  summary.addRow(["Usage", "12-month report"]);
  summary.addRow([]);
  const note = summary.addRow(["Note", "Contains personal data (names, emails, emergency numbers) - store somewhere access-restricted."]);
  note.font = { italic: true, color: { argb: "FF5C6D65" } };

  sheets.forEach((s) => addDataSheet(wb, s));
  addUsageSheet(wb, computeUsage(data));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `GrowSpace-Backup-${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

// Exported for testing the column mapping without a browser download.
export { buildSheets, computeUsage };

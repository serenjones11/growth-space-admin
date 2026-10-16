/* Full backup workbook (Dashboard -> "Full backup"): one .xlsx with a
   Summary tab plus Units, Requisitions and Maintenance - everything,
   unfiltered, in readable form (names not IDs, DD/MM/YYYY dates, Yes/No).
   A human-readable record for a loss of service, not something the app
   re-imports. ExcelJS is loaded only when the button is clicked, so it
   doesn't weigh down the app's normal load. */
import * as api from "./api";

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

const todayUTC = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };
// A "YYYY-MM-DD..." value as a real Excel date (shown DD/MM/YYYY), so it sorts as a date.
const asDate = (v) => {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const daysFromToday = (v) => Math.round((asDate(v).getTime() - todayUTC()) / 86400000);
const yesNo = (v) => (v ? "Yes" : "No");
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const hhmm = (v) => (v ? String(v).slice(0, 5) : "");
const fmtDateTime = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* Booking state from dates - the same rules as the app's status colours. */
function dateState(start, end) {
  if (daysFromToday(start) > 0) return "Upcoming";
  const left = daysFromToday(end);
  if (left < 0) return "Overdue";
  if (left <= 2) return "Ending soon";
  return "Current";
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
      .filter((b) => b.unit_id === u.id && daysFromToday(b.start_date) <= 0)
      .sort((a, b) => (a.end_date < b.end_date ? -1 : 1));
    let status = "Free to book";
    if (u.is_out_of_service) status = "Out of service";
    else if (current.length) {
      const left = daysFromToday(current[0].end_date);
      status = left < 0 ? "Overdue" : left <= 2 ? "Ending soon" : "Occupied";
    }
    return {
      id: u.id, type: UNIT_TYPE[u.type] || u.type, floor: FLOOR[u.floor] || u.floor, room: u.room,
      manufacturer: u.manufacturer, model: u.model, serial: u.serial_number, asset: u.asset_number, tscan: u.tscan_id,
      shelves: num(u.shelves), lighting: u.lighting_type, ballasts: u.ballasts,
      co2: yesNo(u.co2_control), dimming: yesNo(u.dimming_control),
      tMin: num(u.temp_min), tMax: num(u.temp_max), hMin: num(u.humidity_min), hMax: num(u.humidity_max),
      setDay: num(u.set_day_temp), setNight: num(u.set_night_temp), setRh: num(u.set_humidity),
      setCycle: u.set_light_cycle || "", setLight: num(u.set_light_intensity),
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
    .sort((a, b) => (a.unit_id === b.unit_id ? (a.date < b.date ? 1 : -1) : a.unit_id.localeCompare(b.unit_id, undefined, { numeric: true })))
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
        ["Unit ID", "id"], ["Type", "type"], ["Floor", "floor"], ["Room", "room"], ["Manufacturer", "manufacturer"], ["Model", "model"],
        ["Serial no.", "serial"], ["Asset no.", "asset"], ["TSCAN ID", "tscan"], ["Shelves", "shelves"], ["Lighting type", "lighting"],
        ["Ballasts", "ballasts"], ["CO₂ control", "co2"], ["Dimming control", "dimming"],
        ["Temp range min (°C)", "tMin"], ["Temp range max (°C)", "tMax"], ["Humidity range min (%)", "hMin"], ["Humidity range max (%)", "hMax"],
        ["Set day temp (°C)", "setDay"], ["Set night temp (°C)", "setNight"], ["Set RH (%)", "setRh"], ["Set light cycle", "setCycle"],
        ["Set light intensity (µmol/m²/s)", "setLight"], ["Status", "status"], ["Current requisition(s)", "current"],
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
  summary.addRow([]);
  const note = summary.addRow(["Note", "Contains personal data (names, emails, emergency numbers) - store somewhere access-restricted."]);
  note.font = { italic: true, color: { argb: "FF5C6D65" } };

  sheets.forEach((s) => addDataSheet(wb, s));

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
export { buildSheets };

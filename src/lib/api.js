import { supabase } from "./supabaseClient";

/* Lab groups aren't editable anywhere in the UI (no add/remove flow exists),
   and the anonymous Request Space form can't read the lab_groups table at
   all under RLS (it requires `authenticated`, and an anonymous submitter is
   `anon`) — so rather than half-wire a dynamic fetch that only the admin
   side could use, this mirrors the exact seed data from
   supabase/migrations/20260904121300_seed_lab_groups.sql. If a lab group is
   ever added/renamed in the database, update this map (and LAB_GROUPS in
   App.jsx) to match. */
export const LAB_GROUP_ID_BY_NAME = {
  "Al-Farsi Lab": "b61c0b3b-aff4-42d5-a0ac-b1c1a0aee60e",
  "Chen Lab": "eea483f8-122a-4561-8a61-e2fc073264af",
  "Martins Lab": "75668509-8602-4c66-bcc9-c102f75390b7",
  "Novak Lab": "c50534d6-0515-41cc-9d01-f070b4070542",
  "Okafor Lab": "ed5594b8-66d6-414b-9c14-be1362efb74f",
  "Petrova Lab": "805c5b4b-0907-45ca-8e7d-48648fb22d33",
  "Singh Lab": "d508f13d-e70b-4ea0-b29a-cd857e7f6483",
  "Whitfield Lab": "91158291-7d60-4e74-81ba-be9c9d5853d7",
};
export const LAB_GROUP_NAME_BY_ID = Object.fromEntries(
  Object.entries(LAB_GROUP_ID_BY_NAME).map(([name, id]) => [id, name])
);

const UNIT_FILES_BUCKET = "unit-files";

/* Signed URLs (not public ones — the bucket is private, admin-only). Swallows
   errors so one stale/missing storage object can't break the whole fetch. */
async function trySignedUrl(path, expiresIn = 3600) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(UNIT_FILES_BUCKET).createSignedUrl(path, expiresIn);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

function nullIfEmpty(v) {
  return v === "" || v === undefined ? null : v;
}
function numOrNull(v) {
  return v === "" || v === undefined || v === null ? null : Number(v);
}

/* ---------------------------------------------------------------------- */
/* Historical lab usage (dashboard trend chart)                           */
/* ---------------------------------------------------------------------- */

const LAB_USAGE_WINDOW_START = new Date(2022, 8, 1); // Sep 2022
const LAB_USAGE_WINDOW_MONTHS = 48;

function labUsageWindow() {
  const labels = [], fullLabels = [], keys = [];
  for (let i = 0; i < LAB_USAGE_WINDOW_MONTHS; i++) {
    const d = new Date(LAB_USAGE_WINDOW_START.getFullYear(), LAB_USAGE_WINDOW_START.getMonth() + i, 1);
    labels.push(d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }));
    fullLabels.push(d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }));
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return { labels, fullLabels, keys };
}

/* Real per-lab-group, per-month occupied-unit counts, computed from actual
   booking history — replaces the old mock generator's random series. A lab
   group's count for a month is the number of distinct units it had a
   booking in that overlaps any day of that month (regardless of the
   linked requisition's status — history stays history even once a
   requisition is completed). On a freshly-live database most months will
   legitimately show near-zero until real usage accumulates; that's
   correct, not a bug. */
export async function fetchLabUsageHistory() {
  const { labels, fullLabels, keys } = labUsageWindow();
  const { data, error } = await supabase.from("bookings").select("unit_id, lab_group_id, start_date, end_date");
  if (error) throw error;

  const series = {};
  Object.keys(LAB_GROUP_ID_BY_NAME).forEach((lab) => { series[lab] = new Array(keys.length).fill(0); });

  keys.forEach((key, i) => {
    const [y, m] = key.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0); // last day of the month
    const unitsByLab = {};
    data.forEach((b) => {
      const lab = LAB_GROUP_NAME_BY_ID[b.lab_group_id];
      if (!lab) return;
      if (new Date(b.start_date) > monthEnd || new Date(b.end_date) < monthStart) return;
      (unitsByLab[lab] ||= new Set()).add(b.unit_id);
    });
    Object.entries(unitsByLab).forEach(([lab, unitSet]) => {
      if (series[lab]) series[lab][i] = unitSet.size;
    });
  });

  return { labels, fullLabels, keys, series };
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                   */
/* ---------------------------------------------------------------------- */

export async function fetchMaintenanceCategories() {
  const { data, error } = await supabase.from("maintenance_categories").select("*").order("name");
  if (error) throw error;
  return data.map((c) => ({ id: c.id, name: c.name, bg: c.bg_hex, ink: c.ink_hex, border: c.border_hex }));
}

function mapUnitRow(u) {
  return {
    id: u.id,
    type: u.type,
    discipline: u.discipline,
    floor: u.floor,
    room: u.room,
    manufacturer: u.manufacturer,
    model: u.model,
    serialNumber: u.serial_number,
    assetNumber: u.asset_number,
    tscanId: u.tscan_id,
    shelves: u.shelves,
    lightingType: u.lighting_type,
    ballasts: u.ballasts,
    co2Control: u.co2_control,
    dimmingControl: u.dimming_control,
    lastBulbFitting: u.last_bulb_fitting,
    availableLightCycles: u.available_light_cycles,
    installDate: u.install_date,
    tempRange: [Number(u.temp_min), Number(u.temp_max)],
    humidityRange: [Number(u.humidity_min), Number(u.humidity_max)],
    serviceFrequencyMonths: u.service_frequency_months,
    nextServiceDue: u.next_service_due,
    photoDataUrl: u.photo_url,
    isOutOfService: u.is_out_of_service,
    addedRecently: false,
  };
}

function mapBookingRow(b) {
  return {
    id: b.id,
    unitId: b.unit_id,
    requisitionId: b.requisition_id,
    researcher: b.researcher_name,
    role: b.role,
    labGroup: LAB_GROUP_NAME_BY_ID[b.lab_group_id] || "",
    project: b.project_title,
    discipline: b.discipline,
    setTemp: b.set_temp,
    setHumidity: b.set_humidity,
    lightCycle: b.light_cycle,
    startDate: b.start_date,
    endDate: b.end_date,
  };
}

function mapDocumentRow(d) {
  return {
    id: d.id,
    unitId: d.unit_id,
    name: d.name,
    type: d.type,
    addedBy: d.profiles ? d.profiles.full_name : "Admin",
    date: d.date,
    storagePath: d.storage_path,
    url: null, // filled in after a signed-url pass in fetchAdminData
  };
}

function mapServiceLogRow(s) {
  return {
    id: s.id,
    unitId: s.unit_id,
    categoryId: s.category_id,
    category: s.maintenance_categories ? s.maintenance_categories.name : "",
    status: s.status,
    date: s.date,
    engineer: s.contractor || "",
    notes: s.notes || "",
    cost: s.cost,
  };
}

function mapRequisitionRow(r) {
  return {
    id: r.id,
    researcherId: r.researcher_id,
    researcher: r.researcher_name,
    email: r.email,
    role: r.role || "",
    emergencyNumber: r.emergency_number || "",
    labGroup: LAB_GROUP_NAME_BY_ID[r.lab_group_id] || "",
    pi: r.pi_name || "",
    unitType: r.unit_type,
    discipline: r.discipline,
    species: r.species || [],
    numberOfPlants: r.number_of_plants,
    containmentLevel: r.containment_level || "",
    spaceDescription: r.space_description || "",
    projectTitle: r.project_title,
    projectDesc: r.project_desc || "",
    setTemp: r.set_temp,
    setHumidity: r.set_humidity,
    lightCycle: r.light_cycle || "",
    pestConsent: r.pest_consent,
    dimmingRequired: r.dimming_required,
    safetyCompliance: r.safety_compliance,
    preferredFloor: r.preferred_floor || "any",
    startDate: r.start_date,
    endDate: r.end_date,
    hazardNotes: r.hazard_notes || "",
    notes: r.notes || "",
    status: r.status,
    assignedUnitId: r.assigned_unit_id,
    submittedDate: r.submitted_date ? r.submitted_date.slice(0, 10) : null,
    decidedDate: r.decided_date ? r.decided_date.slice(0, 10) : null,
    completedDate: r.completed_date ? r.completed_date.slice(0, 10) : null,
  };
}

/* Fetches everything an admin session needs in one go. Bookings are scoped
   to requisitions.status = 'approved' — a booking stops counting as active
   occupancy the moment its requisition is completed (or if it was never
   approved), matching the unit_current_bookings view's semantics. */
export async function fetchAdminData() {
  const [unitsRes, bookingsRes, serviceRes, reqRes, catsRes, docsRes, labUsageHistory] = await Promise.all([
    supabase.from("units").select("*"),
    supabase.from("bookings").select("*, requisitions!inner(status)").eq("requisitions.status", "approved"),
    supabase.from("service_log").select("*, maintenance_categories(name)"),
    supabase.from("requisitions").select("*").order("submitted_date", { ascending: true }),
    fetchMaintenanceCategories(),
    supabase.from("documents").select("*, profiles(full_name)").order("date", { ascending: false }),
    fetchLabUsageHistory(),
  ]);
  for (const res of [unitsRes, bookingsRes, serviceRes, reqRes, docsRes]) {
    if (res.error) throw res.error;
  }

  const bookingsByUnit = {};
  bookingsRes.data.forEach((row) => {
    const b = mapBookingRow(row);
    (bookingsByUnit[b.unitId] ||= []).push(b);
  });
  const serviceByUnit = {};
  serviceRes.data.forEach((row) => {
    const s = mapServiceLogRow(row);
    (serviceByUnit[s.unitId] ||= []).push(s);
  });
  const documentsByUnit = {};
  docsRes.data.forEach((row) => {
    const d = mapDocumentRow(row);
    (documentsByUnit[d.unitId] ||= []).push(d);
  });

  // Truncated to midnight, matching App.jsx's TODAY constant — kept as a
  // local calculation (rather than importing TODAY from App.jsx) to avoid
  // a circular import between the two modules.
  const today = new Date(new Date().toISOString().slice(0, 10));

  const units = unitsRes.data.map((row) => {
    const base = mapUnitRow(row);
    const bookings = bookingsByUnit[base.id] || [];
    const serviceLog = (serviceByUnit[base.id] || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));

    const documents = documentsByUnit[base.id] || [];

    if (base.type === "reftech") {
      return { ...base, status: base.isOutOfService ? "service" : "auto", bookings, serviceLog, documents };
    }

    // Cabinet: at most one active (approved, started) booking is the
    // occupant — mirrors currentBooking()'s fixed predicate in App.jsx
    // (started, regardless of whether the end date has passed).
    const current = bookings.find((b) => new Date(b.startDate) <= today) || null;
    let status, urgency = null;
    if (base.isOutOfService) {
      status = "service";
    } else if (current) {
      status = "occupied";
      const daysLeft = Math.round((new Date(current.endDate) - today) / 86400000);
      urgency = daysLeft < 0 ? "overdue" : daysLeft <= 2 ? "warning" : null;
    } else {
      status = "free";
    }
    return { ...base, status, urgency, occupant: current, serviceLog, documents };
  });

  // photoDataUrl holds a raw storage path from mapUnitRow (units.photo_url)
  // until here — the bucket is private, so what the UI actually needs is a
  // signed URL. Same for each document's storage_path. Resolved in one
  // batch after the main fetch rather than during it, so a slow/failing
  // signed-url call can't hold up everything else.
  const unitsWithFiles = await Promise.all(
    units.map(async (u) => ({
      ...u,
      photoDataUrl: await trySignedUrl(u.photoDataUrl),
      documents: await Promise.all(u.documents.map(async (d) => ({ ...d, url: await trySignedUrl(d.storagePath) }))),
    }))
  );

  const requests = reqRes.data.map(mapRequisitionRow);

  const categories = catsRes.map((c) => c.name);
  const categoryColors = {};
  const categoryIdByName = {};
  catsRes.forEach((c) => {
    categoryColors[c.name] = { bg: c.bg, ink: c.ink, border: c.border };
    categoryIdByName[c.name] = c.id;
  });

  return { units: unitsWithFiles, requests, categories, categoryColors, categoryIdByName, labUsageHistory };
}

/* ---------------------------------------------------------------------- */
/* Storage (unit photos, requisition/unit documents)                      */
/* ---------------------------------------------------------------------- */

/* Replacing a photo uploads a new object under a fresh timestamped path
   (rather than overwriting the old one in place) then deletes the old
   object — this way a failed upload never leaves the unit's existing
   photo half-overwritten. */
export async function uploadUnitPhoto(unitId, file) {
  const { data: existing } = await supabase.from("units").select("photo_url").eq("id", unitId).single();
  const oldPath = existing?.photo_url || null;

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const path = `photos/${unitId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(UNIT_FILES_BUCKET).upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { error } = await supabase.from("units").update({ photo_url: path }).eq("id", unitId);
  if (error) throw error;

  if (oldPath && oldPath !== path) {
    await supabase.storage.from(UNIT_FILES_BUCKET).remove([oldPath]);
  }
}

export async function addUnitDocument(unitId, file, name, type, addedByUserId) {
  const path = `documents/${unitId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(UNIT_FILES_BUCKET).upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { error } = await supabase
    .from("documents")
    .insert({ unit_id: unitId, name, type, storage_path: path, added_by: addedByUserId });
  if (error) throw error;
}

/* Removes both the DB row and the underlying storage object — leaving an
   orphaned file in the bucket would be silently wasted storage with no way
   to find it again once its only reference (the row) is gone. */
export async function removeUnitDocument(docId) {
  const { data, error: selectError } = await supabase.from("documents").select("storage_path").eq("id", docId).single();
  if (selectError) throw selectError;
  const { error } = await supabase.from("documents").delete().eq("id", docId);
  if (error) throw error;
  if (data?.storage_path) {
    await supabase.storage.from(UNIT_FILES_BUCKET).remove([data.storage_path]);
  }
}

/* ---------------------------------------------------------------------- */
/* Writes                                                                  */
/* ---------------------------------------------------------------------- */

export async function saveUnit(data) {
  const row = {
    id: data.id,
    type: data.type,
    discipline: data.type === "cabinet" ? data.discipline : null,
    floor: data.floor,
    room: data.room,
    manufacturer: data.manufacturer,
    model: data.model,
    serial_number: nullIfEmpty(data.serialNumber),
    asset_number: nullIfEmpty(data.assetNumber),
    tscan_id: nullIfEmpty(data.tscanId),
    shelves: data.type === "cabinet" ? numOrNull(data.shelves) : null,
    lighting_type: data.lightingType,
    ballasts: data.ballasts,
    co2_control: !!data.co2Control,
    dimming_control: !!data.dimmingControl,
    last_bulb_fitting: nullIfEmpty(data.lastBulbFitting),
    available_light_cycles: data.availableLightCycles || null,
    install_date: nullIfEmpty(data.installDate),
    temp_min: data.tempRange[0],
    temp_max: data.tempRange[1],
    humidity_min: data.humidityRange[0],
    humidity_max: data.humidityRange[1],
  };
  if (data.status !== undefined) row.is_out_of_service = data.status === "service";
  const { error } = await supabase.from("units").upsert(row);
  if (error) throw error;
}

/* Diffs the whole-array callback the UI already uses (ServiceLogEditor
   always calls onUpdate with the complete new log for a unit) against the
   last-fetched log, translating add/edit/remove into real INSERT/UPDATE/
   DELETE. New entries carry a client-generated `svc-<timestamp>` id that
   never matches a real row, which is exactly the "is this new" signal. */
export async function saveServiceLog(unitId, newLog, oldLog, categoryIdByName, createdByUserId) {
  const oldIds = new Set(oldLog.map((e) => e.id));
  const newIds = new Set(newLog.map((e) => e.id));
  const toDelete = oldLog.filter((e) => !newIds.has(e.id)).map((e) => e.id);

  const toInsert = [];
  const toUpdate = [];
  for (const e of newLog) {
    const row = {
      unit_id: unitId,
      category_id: categoryIdByName[e.category] || null,
      status: e.status,
      date: e.date,
      contractor: nullIfEmpty(e.engineer),
      notes: e.notes,
      cost: numOrNull(e.cost),
    };
    if (oldIds.has(e.id)) toUpdate.push({ id: e.id, ...row });
    else toInsert.push({ ...row, created_by: createdByUserId });
  }

  if (toDelete.length) {
    const { error } = await supabase.from("service_log").delete().in("id", toDelete);
    if (error) throw error;
  }
  if (toInsert.length) {
    const { error } = await supabase.from("service_log").insert(toInsert);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    const { id, ...rest } = u;
    const { error } = await supabase.from("service_log").update(rest).eq("id", id);
    if (error) throw error;
  }
}

const NEXT_CATEGORY_COLOR_PALETTE = [
  { bg: "#F5F3FF", ink: "#6D28D9", border: "#DDD6FE" },
  { bg: "#EFF6FF", ink: "#1D4ED8", border: "#C7DDFB" },
  { bg: "#FEF9EC", ink: "#92400E", border: "#FBE7B8" },
  { bg: "#FDF2F2", ink: "#B23A34", border: "#F5D0CE" },
  { bg: "#ECFDF3", ink: "#15803D", border: "#BBF0CE" },
  { bg: "#FDF4FF", ink: "#A21CAF", border: "#F5D0FE" },
  { bg: "#F0FDFA", ink: "#0F766E", border: "#99F6E4" },
];

export async function addMaintenanceCategory(name, existingCount) {
  const color = NEXT_CATEGORY_COLOR_PALETTE[existingCount % NEXT_CATEGORY_COLOR_PALETTE.length];
  const { error } = await supabase
    .from("maintenance_categories")
    .insert({ name, bg_hex: color.bg, ink_hex: color.ink, border_hex: color.border });
  if (error) throw error;
}

export async function removeMaintenanceCategory(name) {
  const { error } = await supabase.from("maintenance_categories").delete().eq("name", name);
  if (error) throw error;
}

function requisitionFieldsToRow(payload) {
  return {
    researcher_name: payload.researcher,
    email: payload.email,
    role: nullIfEmpty(payload.role),
    emergency_number: nullIfEmpty(payload.emergencyNumber),
    lab_group_id: LAB_GROUP_ID_BY_NAME[payload.labGroup] ?? null,
    pi_name: nullIfEmpty(payload.pi),
    unit_type: payload.unitType,
    discipline: payload.discipline,
    species: payload.species || [],
    number_of_plants: numOrNull(payload.numberOfPlants),
    containment_level: nullIfEmpty(payload.containmentLevel),
    space_description: nullIfEmpty(payload.spaceDescription),
    project_title: payload.projectTitle,
    project_desc: nullIfEmpty(payload.projectDesc),
    set_temp: numOrNull(payload.setTemp),
    set_humidity: numOrNull(payload.setHumidity),
    light_cycle: nullIfEmpty(payload.lightCycle),
    pest_consent: !!payload.pestConsent,
    dimming_required: !!payload.dimmingRequired,
    safety_compliance: !!payload.safetyCompliance,
    preferred_floor: nullIfEmpty(payload.preferredFloor),
    start_date: payload.startDate,
    end_date: payload.endDate,
    hazard_notes: nullIfEmpty(payload.hazardNotes),
    notes: nullIfEmpty(payload.notes),
  };
}

export async function submitRequisition(payload, researcherId) {
  const row = { ...requisitionFieldsToRow(payload), researcher_id: researcherId || null, status: "pending" };
  const { error } = await supabase.from("requisitions").insert(row);
  if (error) throw error;
}

export async function editRequisition(reqId, updates) {
  const { error } = await supabase.from("requisitions").update(requisitionFieldsToRow(updates)).eq("id", reqId);
  if (error) throw error;
}

/* Matches the prototype's amend behaviour: editing an existing requisition
   through the Request Space wizard also kicks it back to pending review. */
export async function amendRequisition(reqId, payload) {
  const row = {
    ...requisitionFieldsToRow(payload),
    status: "pending",
    decided_date: null,
    decided_by: null,
    submitted_date: new Date().toISOString(),
  };
  const { error } = await supabase.from("requisitions").update(row).eq("id", reqId);
  if (error) throw error;
}

export async function decideRequisition(req, decision, unitId, decidedByUserId) {
  if (decision === "approved" && unitId) {
    const { error: bookingError } = await supabase.from("bookings").insert({
      unit_id: unitId,
      requisition_id: req.id,
      researcher_name: req.researcher,
      role: nullIfEmpty(req.role),
      lab_group_id: LAB_GROUP_ID_BY_NAME[req.labGroup] ?? null,
      project_title: req.projectTitle,
      discipline: req.discipline,
      set_temp: numOrNull(req.setTemp),
      set_humidity: numOrNull(req.setHumidity),
      light_cycle: nullIfEmpty(req.lightCycle),
      start_date: req.startDate,
      end_date: req.endDate,
    });
    if (bookingError) throw bookingError;

    const { error } = await supabase
      .from("requisitions")
      .update({ status: "approved", assigned_unit_id: unitId, decided_date: new Date().toISOString(), decided_by: decidedByUserId })
      .eq("id", req.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("requisitions")
      .update({ status: "declined", assigned_unit_id: null, decided_date: new Date().toISOString(), decided_by: decidedByUserId })
      .eq("id", req.id);
    if (error) throw error;
  }
}

/* Does NOT delete the booking row — completing a requisition is what makes
   its booking stop counting as active occupancy (fetchAdminData only pulls
   bookings from status='approved' requisitions). The row stays as history. */
export async function completeRequisition(reqId, completedByUserId) {
  const { error } = await supabase
    .from("requisitions")
    .update({ status: "completed", completed_date: new Date().toISOString(), completed_by: completedByUserId })
    .eq("id", reqId);
  if (error) throw error;
}

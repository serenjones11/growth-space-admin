import { supabase } from "./supabaseClient";

/* Live lab-group lookup, replacing the old hardcoded LAB_GROUP_ID_BY_NAME/
   LAB_GROUP_NAME_BY_ID maps now that admins can read lab_groups directly
   and self-registered (pending) PIs need to show up correctly too.
   Populated by fetchLabGroups() (called at the top of fetchAdminData()) —
   every admin-side read/write of a lab group name<->id goes through this
   cache rather than a hardcoded snapshot of the seed data. The anonymous
   Request Space form never touches this cache — it always resolves a real
   id itself (via listLabGroups()/findOrCreateLabGroup()) before calling
   into anything here, since RLS wouldn't let it populate this cache. */
let labGroupCache = { idByName: {}, nameById: {}, piById: {} };

function setLabGroupCache(rows) {
  const idByName = {}, nameById = {}, piById = {};
  rows.forEach((r) => {
    idByName[r.name] = r.id;
    nameById[r.id] = r.name;
    piById[r.id] = r.pi_name;
  });
  labGroupCache = { idByName, nameById, piById };
}

/* Admin-side: ALL lab groups, verified and pending — this is what the
   Dashboard/Inventory/Requisitions displays and the pending-PIs review
   panel need. Admins already have direct RLS read access to lab_groups,
   no RPC needed. */
export async function fetchLabGroups() {
  const { data, error } = await supabase.from("lab_groups").select("*").order("pi_name");
  if (error) throw error;
  setLabGroupCache(data);
  return data.map((r) => ({
    id: r.id, name: r.name, piName: r.pi_name, piEmail: r.pi_email,
    isVerified: r.is_verified, createdAt: r.created_at,
  }));
}

/* Public/anonymous-safe: verified lab groups only, via the SECURITY DEFINER
   list_lab_groups() RPC (anon can't read lab_groups directly under RLS).
   Used exclusively by the Request Space form's PI picker — never by the
   admin side, which must see pending entries too. */
export async function listLabGroups() {
  const { data, error } = await supabase.rpc("list_lab_groups");
  if (error) throw error;
  return data.map((r) => ({ id: r.id, name: r.name, piName: r.pi_name }));
}

/* Resolves (or creates, unverified) a lab group for a PI by name/email via
   the find_or_create_lab_group() RPC. Used by the Request Space form both
   when a PI fills the form in themselves and when a researcher picks "My
   PI isn't listed". */
export async function findOrCreateLabGroup(piName, piEmail) {
  const { data, error } = await supabase.rpc("find_or_create_lab_group", {
    p_pi_name: piName,
    p_pi_email: piEmail || null,
  });
  if (error) throw error;
  return data;
}

/* Admin review actions for pending (is_verified = false) lab groups. Both
   are plain authenticated writes — admins already have full RLS access to
   lab_groups/requisitions/bookings, no dedicated RPC needed. */
export async function approveLabGroup(id) {
  const { error } = await supabase.from("lab_groups").update({ is_verified: true }).eq("id", id);
  if (error) throw error;
}

/* Re-points every requisition/booking referencing the pending lab group to
   the chosen existing one, then deletes the now-unreferenced pending row.
   (lab_group_id is ON DELETE SET NULL on both tables, so a plain delete
   wouldn't actually fail — this is still the right call for a duplicate
   pending PI specifically, since merging keeps their history correctly
   attributed to the real, existing lab group instead of just orphaning it.) */
export async function mergeLabGroup(fromId, intoId) {
  let res = await supabase.from("requisitions").update({ lab_group_id: intoId }).eq("lab_group_id", fromId);
  if (res.error) throw res.error;
  res = await supabase.from("bookings").update({ lab_group_id: intoId }).eq("lab_group_id", fromId);
  if (res.error) throw res.error;
  res = await supabase.from("lab_groups").delete().eq("id", fromId);
  if (res.error) throw res.error;
}

/* Direct PI management (Dashboard's "Edit PIs" panel) — distinct from the
   self-registration flow (find_or_create_lab_group): these are trusted
   admin actions, so new entries are verified immediately, no pending
   review needed. */
export async function addLabGroup(name, piName, piEmail) {
  const { error } = await supabase.from("lab_groups").insert({ name, pi_name: piName, pi_email: nullIfEmpty(piEmail), is_verified: true });
  if (error) throw error;
}

export async function updateLabGroup(id, { name, piName, piEmail }) {
  const { error } = await supabase.from("lab_groups").update({ name, pi_name: piName, pi_email: nullIfEmpty(piEmail) }).eq("id", id);
  if (error) throw error;
}

/* lab_group_id is ON DELETE SET NULL on requisitions/bookings/profiles, so
   this doesn't need a merge target — a departed PI can just be removed
   directly, and their historical requisitions/bookings keep existing with
   the reference cleared (see the ON DELETE SET NULL comments in
   schema.sql). */
export async function deleteLabGroup(id) {
  const { error } = await supabase.from("lab_groups").delete().eq("id", id);
  if (error) throw error;
}

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

  // Relies on labGroupCache already being populated — fetchAdminData() calls
  // fetchLabGroups() before this, which is the only caller of this function.
  const series = {};
  Object.values(labGroupCache.nameById).forEach((lab) => { series[lab] = new Array(keys.length).fill(0); });

  keys.forEach((key, i) => {
    const [y, m] = key.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 0); // last day of the month
    const unitsByLab = {};
    data.forEach((b) => {
      const lab = labGroupCache.nameById[b.lab_group_id];
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
    availableLightCycles: u.available_light_cycles,
    installDate: u.install_date,
    tempRange: [Number(u.temp_min), Number(u.temp_max)],
    humidityRange: [Number(u.humidity_min), Number(u.humidity_max)],
    serviceFrequencyMonths: u.service_frequency_months,
    nextServiceDue: u.next_service_due,
    photoDataUrl: u.photo_url,
    isOutOfService: u.is_out_of_service,
    notes: u.notes || "",
    acknowledgedClashBookingIds: u.acknowledged_clash_booking_ids || [],
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
    labGroup: labGroupCache.nameById[b.lab_group_id] || "",
    project: b.project_title,
    discipline: b.discipline,
    setTemp: b.set_temp,
    setHumidity: b.set_humidity,
    lightCycle: b.light_cycle,
    // Denormalized read-only from the linked requisition (b.requisitions is
    // the join added purely to scope the fetch to status='approved' rows —
    // see the query above), so the occupant bar can show it without a
    // separate lookup. Never written back from here — admin_notes is only
    // ever set via updateAdminNotes() directly on requisitions.
    adminNotes: b.requisitions?.admin_notes || "",
    startDate: b.start_date,
    endDate: b.end_date,
    // When this booking row was actually created (i.e. when the
    // requisition was approved) — used for "recent activity" sorting
    // instead of startDate, which can be scheduled far in the future or
    // past and would otherwise sort as more/less "recent" than a real
    // action that just happened.
    createdAt: b.created_at,
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
    labGroupId: r.lab_group_id,
    labGroup: labGroupCache.nameById[r.lab_group_id] || "",
    pi: r.pi_name || "",
    unitType: r.unit_type,
    discipline: r.discipline,
    species: r.species || [],
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
    adminNotes: r.admin_notes || "",
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
  // Must resolve before the Promise.all below — fetchLabUsageHistory() and
  // the row mappers used inside it all read the module-level
  // labGroupCache that this call populates.
  const labGroups = await fetchLabGroups();

  const [unitsRes, bookingsRes, serviceRes, reqRes, catsRes, docsRes, labUsageHistory] = await Promise.all([
    supabase.from("units").select("*"),
    supabase.from("bookings").select("*, requisitions!inner(status, admin_notes)").eq("requisitions.status", "approved"),
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
    // `bookings` is kept here too (not just on reftech units) so a free
    // cabinet with a future-dated approved booking can still show it as
    // upcoming instead of looking identical to one with nothing booked.
    return { ...base, status, urgency, occupant: current, bookings, serviceLog, documents };
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

  return { units: unitsWithFiles, requests, categories, categoryColors, categoryIdByName, labUsageHistory, labGroups };
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

export async function updateUnitNotes(unitId, notes) {
  const { error } = await supabase.from("units").update({ notes: nullIfEmpty(notes) }).eq("id", unitId);
  if (error) throw error;
}

/* bookingIds: the exact set of currently-overlapping booking ids being
   dismissed — see the acknowledged_clash_booking_ids column comment for
   why it's a specific set rather than a bare boolean. */
export async function acknowledgeClash(unitId, bookingIds) {
  const { error } = await supabase.from("units").update({ acknowledged_clash_booking_ids: bookingIds }).eq("id", unitId);
  if (error) throw error;
}

/* bookings/service_log/documents cascade-delete with the unit. requisitions
   referencing it via assigned_unit_id keep existing (ON DELETE SET NULL) —
   see supabase/schema.sql's requisitions table comment. The caller is
   responsible for checking the unit has no active booking first (the app
   blocks the delete with a message in that case rather than relying on a
   DB-level guard). */
export async function deleteUnit(unitId) {
  const { error } = await supabase.from("units").delete().eq("id", unitId);
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
    // RequestSpacePage always resolves and supplies labGroupId directly
    // (it can't rely on the admin-only labGroupCache — an anonymous
    // submitter never populates it). RequisitionEditForm's admin edit path
    // still only knows the lab group's name, so falls back to the cache,
    // which IS populated for any session that can reach that form.
    lab_group_id: payload.labGroupId ?? labGroupCache.idByName[payload.labGroup] ?? null,
    pi_name: nullIfEmpty(payload.pi),
    unit_type: payload.unitType,
    discipline: payload.discipline,
    species: payload.species || [],
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

/* Bookings denormalize a snapshot of these fields off their requisition at
   approval time (see decideRequisition below) — occupancy, the dashboard
   timeline, and everything else that reads unit.occupant/unit.bookings
   reads that snapshot, not the requisition directly. Shared here so
   editing a requisition's dates (or researcher/temp/etc.) after approval
   actually propagates instead of silently going stale. */
function bookingFieldsFromRequisition(req) {
  return {
    researcher_name: req.researcher,
    role: nullIfEmpty(req.role),
    lab_group_id: req.labGroupId ?? null,
    project_title: req.projectTitle,
    discipline: req.discipline,
    set_temp: numOrNull(req.setTemp),
    set_humidity: numOrNull(req.setHumidity),
    light_cycle: nullIfEmpty(req.lightCycle),
    start_date: req.startDate,
    end_date: req.endDate,
  };
}

export async function editRequisition(reqId, updates) {
  const { error } = await supabase.from("requisitions").update(requisitionFieldsToRow(updates)).eq("id", reqId);
  if (error) throw error;
  // No-op (updates zero rows) if this requisition was never approved.
  const { error: bookingError } = await supabase
    .from("bookings")
    .update(bookingFieldsFromRequisition(updates))
    .eq("requisition_id", reqId);
  if (bookingError) throw bookingError;
}

/* Deliberately separate from requisitionFieldsToRow/editRequisition — this
   is the only code path that ever writes admin_notes, so the anonymous
   Request Space submission path can never include it (there's no shared
   column list for a crafted request to piggyback on). */
export async function updateAdminNotes(reqId, adminNotes) {
  const { error } = await supabase.from("requisitions").update({ admin_notes: nullIfEmpty(adminNotes) }).eq("id", reqId);
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
      ...bookingFieldsFromRequisition(req),
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

/* Moves an already-approved requisition's booking to a different unit —
   e.g. the originally assigned cabinet needs to go out of service, or was
   simply the wrong pick. Updates both the requisition's assigned_unit_id
   and its booking's unit_id together so occupancy correctly moves off the
   old unit and onto the new one. */
export async function reassignRequisitionUnit(reqId, newUnitId) {
  const { error: reqError } = await supabase.from("requisitions").update({ assigned_unit_id: newUnitId }).eq("id", reqId);
  if (reqError) throw reqError;
  const { error: bookingError } = await supabase.from("bookings").update({ unit_id: newUnitId }).eq("requisition_id", reqId);
  if (bookingError) throw bookingError;
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

/* Undoes completeRequisition — for an accidental "Complete" click. No
   booking needs recreating: completing never deleted it, only the
   requisition's status controlled whether it counted as active (see the
   bookings fetch above), so flipping status back is sufficient. */
export async function revertRequisitionToActive(reqId) {
  const { error } = await supabase
    .from("requisitions")
    .update({ status: "approved", completed_date: null, completed_by: null })
    .eq("id", reqId);
  if (error) throw error;
}

/* bookings.requisition_id is ON DELETE CASCADE, so this also removes the
   requisition's booking (if any) — unlike deleting a unit or PI, there's
   nothing left for that booking to be a record of once its requisition is
   gone. */
export async function deleteRequisition(reqId) {
  const { error } = await supabase.from("requisitions").delete().eq("id", reqId);
  if (error) throw error;
}

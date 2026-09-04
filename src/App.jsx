import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LayoutDashboard,
  Boxes,
  ClipboardList,
  Send,
  LogOut,
  Search,
  PlusCircle,
  Pencil,
  Thermometer,
  Droplets,
  Wrench,
  Sun,
  User,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Leaf,
  DoorOpen,
  Bug,
  X,
  Maximize2,
  Minimize2,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ShieldAlert,
  FlaskConical,
  AlertTriangle,
  Clock,
  History,
  MapPin,
  Save,
  PackagePlus,
  FileText,
  ImagePlus,
  Trash2,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "./lib/supabaseClient";
import { useSession } from "./lib/useSession";
import * as api from "./lib/api";

/* ---------------------------------------------------------------------- */
/* Design tokens — dark sidebar / light workspace, warm-green readouts     */
/* ---------------------------------------------------------------------- */
const TOKENS = `
  :root {
    --bg: #F3F5F4;
    --surface: #FFFFFF;
    --surface-soft: #F1F5F3;
    --border: #E3E8E5;
    --ink: #16211D;
    --ink-soft: #5C6D65;
    --ink-faint: #93A29B;

    --accent: #16A34A;
    --accent-dark: #0F7A38;
    --accent-soft: #DCFCE7;
    --accent-ink: #14532D;
    --gradient: linear-gradient(135deg, #34D399 0%, #16A34A 100%);

    --free: #2F8F5B;
    --free-soft: #E7F2EA;
    --occupied: #3B6EA5;
    --occupied-soft: #E4EDF6;
    --warning: #C97A2B;
    --warning-soft: #FBEDDD;
    --overdue: #B23A34;
    --overdue-soft: #FAE4E2;
    --service: #75786F;
    --service-soft: #ECEAE4;

    --sidebar-bg: #0E1A16;
    --sidebar-hover: rgba(255,255,255,0.06);
    --sidebar-active: #163826;
    --sidebar-text: #93A79E;
    --sidebar-text-dim: #5C6D65;

    --chip-bg: #0F1D18;
    --chip-label: #ABC0B5;
    --chip-temp: #4ADE80;
    --chip-rh: #60A5FA;
    --chip-cycle: #FBBF24;

    --tag-plant-bg: #ECFDF3; --tag-plant-ink: #15803D; --tag-plant-border: #BBF0CE;
    --tag-insect-bg: #FEF9EC; --tag-insect-ink: #92400E; --tag-insect-border: #FBE7B8;
    --tag-co2-bg: #EFF6FF; --tag-co2-ink: #1D4ED8; --tag-co2-border: #C7DDFB;
    --tag-dim-bg: #F5F3FF; --tag-dim-ink: #6D28D9; --tag-dim-border: #DDD6FE;
    --tag-neutral-bg: #F1F5F3; --tag-neutral-ink: #475569; --tag-neutral-border: #E2E8F0;

    --room-bg: #EFF6F2; --room-ink: #2B4A3A; --room-border: #D3E6DA;
  }
  .gc-app { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--ink); }
  .gc-display { font-family: 'Plus Jakarta Sans', sans-serif; }
  .gc-mono { font-family: 'IBM Plex Mono', monospace; }
  .gc-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
  .gc-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  .gc-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; }
  .gc-input {
    width: 100%; border: 1px solid var(--border); border-radius: 10px;
    padding: 9px 11px; font-size: 14px; background: var(--surface); outline: none;
  }
  .gc-input:focus { border-color: var(--accent); }
  .gc-clickable { cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
  .gc-clickable:hover { transform: translateY(-2px); box-shadow: 0 10px 24px -14px rgba(22,33,29,0.16); }
  .gc-readout { background: var(--chip-bg); border-radius: 10px; padding: 9px 4px; text-align: center; }
  .gc-readout .lbl { color: var(--chip-label); font-size: 9px; font-weight: 700; letter-spacing: 0.07em; }
  .gc-readout .val { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 16px; margin-top: 3px; }
  .gc-tag { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 1px solid transparent; display: inline-flex; align-items: center; gap: 4px; }
`;

const LAB_GROUPS = ["Okafor Lab", "Petrova Lab", "Chen Lab", "Singh Lab", "Martins Lab", "Whitfield Lab", "Al-Farsi Lab", "Novak Lab"];
const PI_BY_LAB = {
  "Okafor Lab": "James Okafor", "Petrova Lab": "Elena Petrova", "Chen Lab": "Wei Chen", "Singh Lab": "Amrit Singh",
  "Martins Lab": "Sofia Martins", "Whitfield Lab": "Rachel Whitfield", "Al-Farsi Lab": "Yousef Al-Farsi", "Novak Lab": "Tomas Novak",
};
function piDisplay(labGroup) { return `PI: ${PI_BY_LAB[labGroup] || labGroup}`; }
const DISCIPLINE_META = {
  plant: { label: "Plant Sciences", icon: Leaf, color: "#2F8F5B" },
  insect: { label: "Insect Sciences", icon: Bug, color: "#A6763F" },
};

const MANUFACTURERS = ["Conviron", "Percival", "Sanyo/Panasonic", "Snijders", "BioChambers"];
const MODELS = ["E-15", "AR-66", "MLR-352H", "GC-8", "TC-30"];
const LIGHT_CYCLES = ["8/16 h (L/D)", "12/12 h (L/D)", "16/8 h (L/D)", "24 h dark", "Continuous light"];
const LIGHTING_TYPES = ["LED", "Fluorescent", "LED + Fluorescent"];
const BALLAST_TYPES = ["Electronic", "Magnetic"];
const ROLES = ["PhD Student", "Postdoc", "Technician", "Masters Student", "PI / Academic Staff"];
const CONTAINMENT_LEVELS = ["Wild Type", "GM Contained (CL1)", "GM Contained (CL2)"];
const PLANT_SPECIES = ["Arabidopsis thaliana", "Triticum aestivum (Wheat)", "Hordeum vulgare (Barley)", "Physcomitrella patens (Moss)", "Nicotiana benthamiana"];
const INSECT_SPECIES = ["Drosophila melanogaster", "Tribolium castaneum", "Bombyx mori", "Apis mellifera", "Tenebrio molitor"];

/* Floors — LG, Level 1, Level 2a, Level 2b, Level 3 */
const FLOORS = ["LG", "L1", "L2A", "L2B", "L3"];
const FLOOR_LABEL = { LG: "LG", L1: "Level 1", L2A: "Level 2a", L2B: "Level 2b", L3: "Level 3" };

const ROOMS_BY_FLOOR = {
  LG: ["Room LG.03", "Room LG.07"],
  L1: ["Room 1.04", "Room 1.09", "Room 1.15"],
  L2A: ["Room 2A.02", "Room 2A.11"],
  L2B: ["Room 2B.05", "Room 2B.14"],
  L3: ["Room 3.06", "Room 3.12", "Room 3.20"],
};
const REFTECH_ROOMS_BY_FLOOR = {
  LG: ["Reftech Room LG-A"],
  L1: ["Reftech Room 1-A"],
  L2A: ["Reftech Room 2A-A", "Reftech Room 2A-B"],
  L2B: ["Reftech Room 2B-A"],
  L3: ["Reftech Room 3-A", "Reftech Room 3-B"],
};

function addDays(base, days) { const d = new Date(base); d.setDate(d.getDate() + days); return d; }
function fmt(date) { return date.toISOString().slice(0, 10); }
/* British date display — "YYYY-MM-DD" -> "DD/MM/YYYY" */
function fmtGB(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
/* Real "today", truncated to midnight so date-only comparisons (booking
   start/end dates) behave the same way they did against the old hardcoded
   mock date. */
const TODAY = new Date(new Date().toISOString().slice(0, 10));
/* Do two date ranges (inclusive) overlap? */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) <= new Date(bEnd) && new Date(bStart) <= new Date(aEnd);
}
/* Is a unit available for a given requested date window — even if it's not free "right now" */
function unitAvailableForWindow(unit, startDate, endDate) {
  if (unit.status === "service") return false;
  if (unit.type === "reftech") {
    return !unit.bookings.some((b) => rangesOverlap(b.startDate, b.endDate, startDate, endDate));
  }
  if (!unit.occupant) return true;
  return !rangesOverlap(unit.occupant.startDate, unit.occupant.endDate, startDate, endDate);
}
/* Find the requisition index matching a booking/occupant record, so timeline & drawer bookings can link back */
function findRequisitionIndex(requests, o) {
  if (!o) return null;
  const idx = requests.findIndex((r) => r.researcher === o.researcher && r.startDate === o.startDate && r.endDate === o.endDate);
  return idx === -1 ? null : idx;
}
/* Which Requisitions-page tab a given requisition belongs on. "Active" covers anything not yet
   closed out — still awaiting review, or approved and ongoing. "Completed" is anything closed:
   declined outright, or manually confirmed finished by an admin. */
function requisitionTab(status) {
  return status === "pending" || status === "approved" ? "pending" : "completed";
}

/* A single shared fallback swatch for a service-log category that's no
   longer in the categories list (e.g. deleted after entries were logged
   against it) — replaces the old hardcoded MAINTENANCE_CATEGORIES map now
   that categories are real, admin-managed rows from the database. */
const FALLBACK_CATEGORY_COLOR = { bg: "#EFF6FF", ink: "#1D4ED8", border: "#C7DDFB" };
const DOCUMENT_TYPES = ["Manual", "Certificate", "Risk Assessment"];

/* ---------------------------------------------------------------------- */
/* Status helpers — unify cabinet (single occupant) & reftech (bookings)  */
/* ---------------------------------------------------------------------- */
function daysUntil(dateStr) { return Math.round((new Date(dateStr) - TODAY) / 86400000); }

/* For reftech rooms: a booking counts as "current" once it's started,
   regardless of whether its end date has passed — it only stops being
   current when its requisition is completed (which is enforced upstream,
   in src/lib/api.js's fetchAdminData: unit.bookings only ever contains
   bookings from status='approved' requisitions). This is what lets a
   lapsed-but-uncompleted booking show up as overdue instead of the room
   silently reading as free — see supabase/schema.sql's design note 5. */
function currentBooking(unit) {
  if (unit.type !== "reftech") return null;
  return unit.bookings.find((b) => new Date(b.startDate) <= TODAY) || null;
}
function upcomingBookings(unit) {
  if (unit.type !== "reftech") return [];
  return unit.bookings.filter((b) => new Date(b.startDate) > TODAY).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}
function unitOccupant(unit) {
  return unit.type === "cabinet" ? unit.occupant : currentBooking(unit);
}
function unitDiscipline(unit) {
  if (unit.type === "cabinet") return unit.discipline;
  const b = currentBooking(unit) || unit.bookings[0];
  return b ? b.discipline : "plant";
}

const STATUS_META = {
  free: { label: "Free", color: "var(--free)", soft: "var(--free-soft)" },
  occupied: { label: "Occupied", color: "var(--occupied)", soft: "var(--occupied-soft)" },
  service: { label: "Out of Service", color: "var(--service)", soft: "var(--service-soft)" },
};

function displayStatus(unit) {
  if (unit.status === "service") return { key: "service", ...STATUS_META.service };

  if (unit.type === "reftech") {
    const cb = currentBooking(unit);
    if (!cb) return { key: "free", ...STATUS_META.free };
    const left = daysUntil(cb.endDate);
    if (left < 0) return { key: "overdue", label: "Overdue", color: "var(--overdue)", soft: "var(--overdue-soft)" };
    if (left <= 2) return { key: "warning", label: "Ending soon", color: "var(--warning)", soft: "var(--warning-soft)" };
    return { key: "occupied", ...STATUS_META.occupied };
  }

  if (unit.status === "occupied" && unit.urgency === "overdue")
    return { key: "overdue", label: "Overdue", color: "var(--overdue)", soft: "var(--overdue-soft)" };
  if (unit.status === "occupied" && unit.urgency === "warning")
    return { key: "warning", label: "Ending soon", color: "var(--warning)", soft: "var(--warning-soft)" };
  const m = STATUS_META[unit.status];
  return { key: unit.status, ...m };
}

/* ---------------------------------------------------------------------- */
/* Shared bits                                                            */
/* ---------------------------------------------------------------------- */
function StatusTag({ unit, big = false }) {
  const s = displayStatus(unit);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-semibold"
      style={{
        background: s.soft, color: s.color,
        padding: big ? "5px 11px" : "3px 9px",
        fontSize: big ? 13 : 11,
      }}
    >
      <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, background: s.color }} />
      {s.label}
    </span>
  );
}
function DisciplineBadge({ discipline, size = "sm" }) {
  const d = DISCIPLINE_META[discipline];
  const Icon = d.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-semibold"
      style={{
        color: d.color, background: `${d.color}1A`,
        padding: size === "sm" ? "2px 7px" : "3px 9px",
        fontSize: size === "sm" ? 10 : 12,
      }}
    >
      <Icon size={size === "sm" ? 10 : 12} />
      {d.label}
    </span>
  );
}
function MiniGauge({ icon: Icon, value, unit, min, max }) {
  const pct = Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} style={{ color: "var(--ink-faint)" }} />
      <div className="w-10 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      <span className="gc-mono text-[11px]" style={{ color: "var(--ink-soft)" }}>{value}{unit}</span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}
function RoomChip({ unit, size = "md" }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg font-bold"
      style={{
        background: "var(--room-bg)", color: "var(--room-ink)", border: "1px solid var(--room-border)",
        padding: size === "md" ? "5px 11px" : "4px 8px",
        fontSize: size === "md" ? 13.5 : 12,
      }}
    >
      <MapPin size={size === "md" ? 14 : 12} style={{ color: "var(--accent)" }} />
      {FLOOR_LABEL[unit.floor]} · {unit.room}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Sidebar                                                                */
/* ---------------------------------------------------------------------- */
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "inventory", label: "Inventory", icon: Boxes },
  { key: "requisitions", label: "Requisitions", icon: ClipboardList },
];

function Sidebar({ page, setPage, pendingCount }) {
  return (
    <aside className="w-64 flex-shrink-0 h-screen sticky top-0 flex flex-col py-7 px-4" style={{ background: "var(--sidebar-bg)" }}>
      <div className="flex items-center gap-3 px-2 pb-6 mb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--gradient)" }}
        >
          <Leaf size={19} color="#fff" />
        </div>
        <div className="min-w-0">
          <div className="gc-display font-extrabold text-[15.5px] text-white leading-tight">Facilities &amp; Estates</div>
          <div className="text-[10px] font-bold tracking-wider mt-0.5" style={{ color: "var(--sidebar-text-dim)" }}>GROWTH SPACE ADMIN</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV.map(({ key, label, icon: Icon }) => {
          const active = page === key;
          return (
            <button
              key={key}
              onClick={() => setPage(key)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm transition-colors relative"
              style={{
                background: active ? "var(--sidebar-active)" : "transparent",
                color: active ? "var(--chip-temp)" : "var(--sidebar-text)",
                fontWeight: 600,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--sidebar-hover)"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <Icon size={17} />
              {label}
              {key === "requisitions" && pendingCount > 0 && (
                <span
                  className="ml-auto text-[10px] rounded-full px-1.5 py-0.5 font-bold"
                  style={{ background: "#B23A34", color: "white" }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}

        {/* Request Space is an action, not a page — set apart with a divider and CTA styling so it
            doesn't read as just another item in the nav list. */}
        <div className="pt-3 mt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            onClick={() => setPage("request")}
            className="w-full flex items-center justify-center gap-2.5 px-3.5 py-3 rounded-xl text-sm font-bold text-white"
            style={{ background: page === "request" ? "var(--gradient)" : "var(--accent-dark)" }}
          >
            <Send size={16} />
            Request Space
          </button>
        </div>
      </nav>

      <button
        onClick={() => supabase.auth.signOut()}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm mt-4 pt-4"
        style={{ color: "var(--sidebar-text)", borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <LogOut size={17} />
        Log out
      </button>

      <div className="text-[10.5px] leading-relaxed px-2 pt-4 mt-2" style={{ color: "var(--sidebar-text-dim)" }}>
        Plant &amp; Insect Growth<br />Facility Management System
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------------- */
/* Activity feed (bookings, completed requisitions, new units, servicing) */
/* ---------------------------------------------------------------------- */
const ACTIVITY_META = {
  booking: { icon: User, color: "var(--occupied)", soft: "var(--occupied-soft)" },
  completed: { icon: CheckCircle2, color: "var(--free)", soft: "var(--free-soft)" },
  added: { icon: PackagePlus, color: "var(--accent)", soft: "var(--accent-soft)" },
  service: { icon: Wrench, color: "var(--service)", soft: "var(--service-soft)" },
};

function buildActivityFeed(units, requests) {
  const items = [];
  units.forEach((u) => {
    if (u.type === "cabinet" && u.occupant) {
      items.push({
        type: "booking", date: u.occupant.startDate, unitId: u.id,
        title: `${u.occupant.researcher} was assigned ${u.id}`,
        subtitle: `${piDisplay(u.occupant.labGroup)} · ${FLOOR_LABEL[u.floor]}, ${u.room}`,
      });
    }
    if (u.type === "reftech") {
      u.bookings.forEach((b) => {
        items.push({
          type: "booking", date: b.startDate, unitId: u.id,
          title: `${b.researcher} was assigned ${u.room}`,
          subtitle: `${piDisplay(b.labGroup)} · ${u.id}`,
        });
      });
    }
    if (u.serviceLog[0]) {
      items.push({
        type: "service", date: u.serviceLog[0].date, unitId: u.id,
        title: `${u.id} serviced by contractor ${u.serviceLog[0].engineer}`,
        subtitle: u.serviceLog[0].notes,
      });
    }
    if (u.addedRecently) {
      items.push({
        type: "added", date: u.installDate, unitId: u.id,
        title: `${u.id} added to inventory`,
        subtitle: `${u.type === "reftech" ? "Reftech room" : "Growth cabinet"} · ${FLOOR_LABEL[u.floor]}, ${u.room}`,
      });
    }
  });
  requests.forEach((r, i) => {
    if (r.status === "approved" || r.status === "declined") {
      items.push({
        type: "completed", date: r.decidedDate || r.submittedDate, reqIndex: i,
        title: `Requisition ${r.status === "approved" ? "approved" : "declined"} — ${r.projectTitle}`,
        subtitle: `${r.researcher} · ${piDisplay(r.labGroup)}${r.assignedUnitId ? ` · assigned ${r.assignedUnitId}` : ""}`,
      });
    }
    if (r.status === "completed") {
      items.push({
        type: "completed", date: r.completedDate || r.decidedDate, reqIndex: i,
        title: `Requisition marked finished — ${r.projectTitle}`,
        subtitle: `${r.researcher} · ${piDisplay(r.labGroup)}${r.assignedUnitId ? ` · freed ${r.assignedUnitId}` : ""}`,
      });
    }
  });
  return items.filter((it) => it.date).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function ActivityRow({ item, onClick }) {
  const meta = ACTIVITY_META[item.type];
  const Icon = meta.icon;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 text-left rounded-xl px-2 py-2 -mx-2 gc-clickable" style={{ background: "transparent" }}>
      <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: meta.soft, color: meta.color }}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-xs truncate" style={{ color: "var(--ink-faint)" }}>{fmtGB(item.date)} · {item.subtitle}</div>
      </div>
      <ChevronRight size={15} style={{ color: "var(--ink-faint)" }} className="flex-shrink-0" />
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */
/* Colour-blind-safe palette (Okabe–Ito) — distinguishable under deuteranopia/protanopia/tritanopia.
   Every lab uses this palette plus consistent solid lines/circular markers — kept deliberately simple
   rather than adding per-line dash/marker variation, which tested as visually noisy. */
const OKABE_ITO = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#4D4D4D"];
// Text colour for each swatch above when used as a solid badge fill — everything is white-on-colour
// except the yellow, which needs dark text to stay readable.
const OKABE_ITO_TEXT = ["#fff", "#fff", "#fff", "#16211D", "#fff", "#fff", "#fff", "#fff"];

function LineMarker({ cx, cy, color, r = 4 }) {
  return <circle cx={cx} cy={cy} r={r} fill={color} />;
}

/* Custom month picker — trigger pill + popover grid grouped by year, styled to match the app
   instead of the browser's native <input type="month">. */
function MonthPickerButton({ label, value, keys, fullLabels, onSelect, align = "left" }) {
  const [open, setOpen] = useState(false);
  const valueIdx = keys.indexOf(value);
  const byYear = {};
  keys.forEach((k, i) => { const y = k.slice(0, 4); (byYear[y] = byYear[y] || []).push({ key: k, i }); });
  const years = Object.keys(byYear).sort((a, b) => b - a); // most recent year first

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-xl text-xs font-bold"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)" }}
      >
        <CalendarClock size={13} style={{ color: "var(--ink-faint)" }} />
        {valueIdx !== -1 ? fullLabels[valueIdx] : label}
        <ChevronDown size={12} style={{ color: "var(--ink-faint)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="gc-scroll absolute z-30 mt-2 rounded-2xl p-3.5"
            style={{ [align]: 0, width: 280, maxHeight: 280, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 18px 44px -18px rgba(22,33,29,0.35)" }}
          >
            <div className="text-[10.5px] font-bold uppercase tracking-wide mb-2.5" style={{ color: "var(--ink-faint)" }}>{label}</div>
            {years.map((y) => (
              <div key={y} className="mb-3 last:mb-0">
                <div className="text-[11px] font-bold mb-1.5" style={{ color: "var(--ink-soft)" }}>{y}</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {byYear[y].map(({ key, i }) => (
                    <button
                      key={key}
                      onClick={() => { onSelect(key); setOpen(false); }}
                      className="text-[11.5px] font-semibold py-1.5 rounded-lg"
                      style={{ background: key === value ? "var(--sidebar-bg)" : "var(--surface-soft)", color: key === value ? "#fff" : "var(--ink-soft)" }}
                    >
                      {fullLabels[i].split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LabUsageTrend({ units, labUsageHistory }) {
  const allKeys = labUsageHistory.keys;
  const [fromKey, setFromKey] = useState(allKeys[allKeys.length - 13]); // default: last 12 months
  const [toKey, setToKey] = useState(allKeys[allKeys.length - 1]);
  const [hoveredLab, setHoveredLab] = useState(null);
  const [isolatedLab, setIsolatedLab] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const activeLab = isolatedLab || hoveredLab;

  const fromIdx = Math.max(0, allKeys.indexOf(fromKey));
  const toIdxRaw = allKeys.indexOf(toKey);
  const toIdx = Math.max(fromIdx, toIdxRaw === -1 ? allKeys.length - 1 : toIdxRaw);
  const labels = labUsageHistory.labels.slice(fromIdx, toIdx + 1);

  const handleFrom = (key) => { setFromKey(key); if (allKeys.indexOf(key) > allKeys.indexOf(toKey)) setToKey(key); };
  const handleTo = (key) => { setToKey(key); if (allKeys.indexOf(key) < allKeys.indexOf(fromKey)) setFromKey(key); };

  const currentCounts = LAB_GROUPS.reduce((acc, lab) => {
    acc[lab] = units.filter((u) => { const o = unitOccupant(u); return o && o.labGroup === lab; }).length;
    return acc;
  }, {});

  const series = LAB_GROUPS.map((lab, idx) => {
    const full = (labUsageHistory.series[lab] || []).slice();
    full[full.length - 1] = currentCounts[lab]; // latest real month = live count
    return { lab, color: OKABE_ITO[idx], values: full.slice(fromIdx, toIdx + 1) };
  });

  const maxV = Math.max(1, ...series.flatMap((s) => s.values)) * 1.2;
  const W = 760, H = 260, PAD_L = 30, PAD_R = 14, PAD_T = 14, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const xFor = (i) => PAD_L + (labels.length === 1 ? 0 : (i / (labels.length - 1)) * plotW);
  const yFor = (v) => PAD_T + plotH - (v / maxV) * plotH;
  const labelStep = labels.length > 18 ? 3 : labels.length > 12 ? 2 : 1;

  const ranked = LAB_GROUPS.map((lab) => ({ lab, current: currentCounts[lab] })).sort((a, b) => b.current - a.current);
  const top = ranked[0];
  const avg = ranked.reduce((s, r) => s + r.current, 0) / ranked.length;

  return (
    <div className="gc-card p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <div>
          <h3 className="gc-display font-bold text-sm">Space usage by lab group</h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-faint)" }}>Units occupied per month · hover a line for details, click a legend entry to isolate it</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <MonthPickerButton label="From" value={fromKey} keys={allKeys} fullLabels={labUsageHistory.fullLabels} onSelect={handleFrom} align="left" />
          <span className="text-xs font-semibold" style={{ color: "var(--ink-faint)" }}>to</span>
          <MonthPickerButton label="To" value={toKey} keys={allKeys} fullLabels={labUsageHistory.fullLabels} onSelect={handleTo} align="right" />
        </div>
      </div>

      <p className="text-xs mt-2 mb-1" style={{ color: "var(--ink-soft)" }}>
        Highest right now: <strong style={{ color: "var(--ink)" }}>{piDisplay(top.lab)}</strong> at {top.current} units — {avg > 0 ? `${Math.round(((top.current - avg) / avg) * 100)}% above` : ""} the group average ({avg.toFixed(1)}).
      </p>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
          {[0, 1, 2, 3].map((g) => {
            const v = (maxV / 3) * g;
            const y = yFor(v);
            return (
              <g key={g}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={PAD_L - 6} y={y + 3} fontSize={9.5} fill="var(--ink-faint)" textAnchor="end">{Math.round(v)}</text>
              </g>
            );
          })}
          {labels.map((m, i) => (i % labelStep === 0 || i === labels.length - 1) && (
            <text key={i} x={xFor(i)} y={H - 6} fontSize={9.5} fill="var(--ink-faint)" textAnchor="middle" fontWeight={600}>{m}</text>
          ))}

          {series.map((s) => {
            const dim = activeLab && activeLab !== s.lab;
            const pts = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
            return (
              <g key={s.lab} opacity={dim ? 0.15 : 1} style={{ transition: "opacity 0.15s" }}>
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth={activeLab === s.lab ? 3.5 : 2} strokeLinecap="round" strokeLinejoin="round" />
                {s.values.map((v, i) => (
                  <g
                    key={i}
                    onMouseEnter={() => { setHoveredLab(s.lab); setTooltip({ lab: s.lab, month: labels[i], value: v, x: xFor(i), y: yFor(v) }); }}
                    onMouseLeave={() => { setHoveredLab(null); setTooltip(null); }}
                    style={{ cursor: "pointer" }}
                  >
                    {/* generous invisible hit-area so points are easy to hover even when packed close together */}
                    <circle cx={xFor(i)} cy={yFor(v)} r={9} fill="transparent" />
                    <LineMarker cx={xFor(i)} cy={yFor(v)} color={s.color} r={activeLab === s.lab ? 4.5 : 3} />
                  </g>
                ))}
              </g>
            );
          })}

          {tooltip && (
            <g transform={`translate(${Math.min(tooltip.x + 10, W - 160)}, ${Math.max(tooltip.y - 46, 4)})`}>
              <rect width="150" height="42" rx="9" fill="var(--surface)" stroke="var(--border)" />
              <text x="10" y="16" fontSize="10.5" fontWeight="800" fill="var(--ink)">{piDisplay(tooltip.lab)}</text>
              <text x="10" y="30" fontSize="10" fill="var(--ink-soft)">{tooltip.month} · {tooltip.value} units</text>
            </g>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        {series.map((s) => (
          <button
            key={s.lab}
            onClick={() => setIsolatedLab((cur) => (cur === s.lab ? null : s.lab))}
            onMouseEnter={() => setHoveredLab(s.lab)}
            onMouseLeave={() => setHoveredLab(null)}
            className="flex items-center gap-1.5 text-[11.5px] font-semibold"
            style={{ color: isolatedLab === s.lab ? s.color : "var(--ink-soft)", opacity: isolatedLab && isolatedLab !== s.lab ? 0.4 : 1 }}
          >
            <svg width="10" height="10"><LineMarker cx={5} cy={5} color={s.color} r={3.4} /></svg>
            {piDisplay(s.lab)}
          </button>
        ))}
        {isolatedLab && (
          <button onClick={() => setIsolatedLab(null)} className="text-[11.5px] font-bold underline" style={{ color: "var(--accent-dark)" }}>Show all</button>
        )}
      </div>
    </div>
  );
}

function DashboardPage({ units, requests, goInventory, goRequisitions, onSelectUnit, onPreviewRequisition, labUsageHistory }) {
  const [timelineFull, setTimelineFull] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);

  const total = units.length;
  const occupied = units.filter((u) => displayStatus(u).key === "occupied" || displayStatus(u).key === "warning" || displayStatus(u).key === "overdue").length;
  const free = units.filter((u) => displayStatus(u).key === "free").length;
  const overdue = units.filter((u) => displayStatus(u).key === "overdue");
  const utilisation = total === 0 ? 0 : Math.round((occupied / total) * 100);
  const pending = requests.filter((r) => r.status === "pending");

  const activity = useMemo(() => buildActivityFeed(units, requests), [units, requests]);
  const shownActivity = activityExpanded ? activity.slice(0, 20) : activity.slice(0, 4);

  const [labsExpanded, setLabsExpanded] = useState(false);
  const byLabAll = LAB_GROUPS
    .map((lab) => ({ lab, count: units.filter((u) => { const o = unitOccupant(u); return o && o.labGroup === lab; }).length }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count);
  const byLab = labsExpanded ? byLabAll : byLabAll.slice(0, 4);

  const handleActivityClick = (item) => {
    if (item.type === "completed") { goRequisitions("completed", item.reqIndex); return; }
    const unit = units.find((u) => u.id === item.unitId);
    if (unit) onSelectUnit(unit);
  };

  return (
    <div className="space-y-5">
      <h1 className="gc-display text-2xl font-extrabold">Dashboard</h1>

      {/* KPI readout row — same dark-chip language as the inventory cards, for a consistent system */}
      <div className="grid grid-cols-3 gap-2.5">
        <button
          onClick={() => goInventory({})}
          className="text-left px-5 py-4 gc-clickable"
          style={{ background: "var(--chip-bg)", borderRadius: 14 }}
        >
          <div className="text-[10px] font-bold tracking-wider" style={{ color: "var(--chip-label)" }}>UTILISATION</div>
          <div className="gc-display font-extrabold text-3xl mt-1" style={{ color: "var(--chip-temp)" }}>{utilisation}%</div>
          <div className="text-[12px] font-semibold mt-1" style={{ color: "var(--chip-label)" }}>{occupied} occupied · {free} free</div>
        </button>
        <button
          onClick={() => goInventory({ status: "overdue" })}
          disabled={overdue.length === 0}
          className="text-left px-5 py-4 gc-clickable disabled:cursor-default"
          style={{ background: "var(--chip-bg)", borderRadius: 14 }}
        >
          <div className="text-[10px] font-bold tracking-wider" style={{ color: "var(--chip-label)" }}>OVERDUE</div>
          <div className="gc-display font-extrabold text-3xl mt-1" style={{ color: "#F87171" }}>{overdue.length}</div>
          <div className="text-[12px] font-semibold mt-1" style={{ color: "var(--chip-label)" }}>{overdue.length > 0 ? "Needs a follow-up" : "Nothing overdue"}</div>
        </button>
        <button
          onClick={() => goRequisitions("pending")}
          disabled={pending.length === 0}
          className="text-left px-5 py-4 gc-clickable disabled:cursor-default"
          style={{ background: "var(--chip-bg)", borderRadius: 14 }}
        >
          <div className="text-[10px] font-bold tracking-wider" style={{ color: "var(--chip-label)" }}>PENDING</div>
          <div className="gc-display font-extrabold text-3xl mt-1" style={{ color: "var(--chip-cycle)" }}>{pending.length}</div>
          <div className="text-[12px] font-semibold mt-1" style={{ color: "var(--chip-label)" }}>{pending.length > 0 ? "Awaiting review" : "All caught up"}</div>
        </button>
      </div>

      {/* timeline — moved up, close to the top of the dashboard */}
      <div className="gc-card p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="gc-display font-bold text-sm">Requisition timeline</h3>
          <button
            onClick={() => setTimelineFull(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ color: "var(--ink-soft)", background: "var(--surface-soft)" }}
          >
            <Maximize2 size={12} /> Full screen
          </button>
        </div>
        <TimelineView units={units} requests={requests} onNavigate={(tab, index) => onPreviewRequisition(index)} compact />
      </div>

      {timelineFull && (
        <div className="fixed inset-0 z-50 p-6 gc-scroll overflow-y-auto" style={{ background: "var(--bg)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="gc-display text-xl font-bold">Requisition timeline</h2>
            <button onClick={() => setTimelineFull(false)} className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-full" style={{ background: "var(--surface-soft)" }}>
              <Minimize2 size={14} /> Close
            </button>
          </div>
          <div className="gc-card p-5">
            <TimelineView units={units} requests={requests} onNavigate={(tab, index) => onPreviewRequisition(index)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1.4fr] gap-5">
        {/* left column */}
        <div className="space-y-5">
          <div className="gc-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="gc-display font-bold text-sm">Recent activity</h3>
              <button onClick={() => setActivityExpanded((v) => !v)} className="text-xs font-bold" style={{ color: "var(--accent-dark)" }}>
                {activityExpanded ? "Show less" : "View all"}
              </button>
            </div>
            <div className="space-y-1 gc-scroll" style={{ maxHeight: activityExpanded ? 560 : "none", overflowY: activityExpanded ? "auto" : "visible" }}>
              {shownActivity.map((item, i) => (
                <ActivityRow key={i} item={item} onClick={() => handleActivityClick(item)} />
              ))}
              {shownActivity.length === 0 && <p className="text-sm py-4" style={{ color: "var(--ink-faint)" }}>No activity yet.</p>}
            </div>
          </div>
        </div>

        {/* right column */}
        <div className="space-y-5">
          {/* lab groups row */}
          <div className="gc-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="gc-display font-bold text-sm">Lab groups</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--ink-faint)" }}>Units currently held, by group — click one to filter inventory</p>
              </div>
              <button
                onClick={() => goInventory({})}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full text-white flex-shrink-0"
                style={{ background: "var(--accent-dark)" }}
              >
                View all <ChevronRight size={13} />
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {byLab.map((l) => {
                const idx = LAB_GROUPS.indexOf(l.lab);
                return (
                  <button
                    key={l.lab}
                    onClick={() => goInventory({ labGroup: l.lab })}
                    className="gc-clickable flex-1 min-w-[140px] rounded-2xl p-4 text-left"
                    style={{ background: "var(--surface-soft)" }}
                  >
                    <span
                      className="inline-flex items-center justify-center rounded-lg text-[10px] font-bold px-2.5 py-1 mb-2"
                      style={{ background: OKABE_ITO[idx], color: OKABE_ITO_TEXT[idx] }}
                    >
                      {l.lab.split(" ")[0].slice(0, 4).toUpperCase()}
                    </span>
                    <div className="text-sm font-semibold">{piDisplay(l.lab)}</div>
                    <div className="gc-display text-lg font-bold">{l.count} units</div>
                  </button>
                );
              })}
            </div>
            {byLabAll.length > 4 && (
              <button
                onClick={() => setLabsExpanded((v) => !v)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold mt-3 pt-3"
                style={{ color: "var(--ink-soft)", borderTop: "1px solid var(--border)" }}
              >
                {labsExpanded ? "Show fewer lab groups" : `Show all ${byLabAll.length} lab groups`}
                <ChevronDown size={13} style={{ transform: labsExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
            )}
          </div>

          {/* occupancy trend */}
          <LabUsageTrend units={units} labUsageHistory={labUsageHistory} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Timeline (used on dashboard, compact or full)                          */
/* ---------------------------------------------------------------------- */
function TimelineView({ units, requests = [], onNavigate, compact = false }) {
  const [floorFilter, setFloorFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [hoveredRow, setHoveredRow] = useState(null);

  const rangeStart = addDays(TODAY, -14);
  const rangeEnd = addDays(TODAY, 106);
  const totalMs = rangeEnd - rangeStart;
  const pct = (date) => Math.max(0, Math.min(100, ((date - rangeStart) / totalMs) * 100));
  const shortDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const axisMarks = [rangeStart, addDays(TODAY, 30), addDays(TODAY, 60), addDays(TODAY, 90), rangeEnd].map((d) => ({ label: shortDate(d), pct: pct(d) }));

  const occupied = units
    .filter((u) => {
      const o = unitOccupant(u);
      if (!o) return false;
      const s = displayStatus(u);
      if (floorFilter !== "all" && u.floor !== floorFilter) return false;
      if (urgencyFilter !== "all" && s.key !== urgencyFilter) return false;
      if (disciplineFilter !== "all" && unitDiscipline(u) !== disciplineFilter) return false;
      return true;
    })
    .map((u) => {
      const o = unitOccupant(u);
      const start = new Date(o.startDate);
      const end = new Date(o.endDate);
      return { u, o, start: start < rangeStart ? rangeStart : start, end };
    });

  const groups = FLOORS.map((f) => ({ floor: f, items: occupied.filter((o) => o.u.floor === f).sort((a, b) => a.end - b.end) }))
    .filter((g) => g.items.length)
    .slice(0, compact ? 2 : undefined);

  return (
    <div>
      {!compact && (
        <p className="text-[13px] mb-4" style={{ color: "var(--ink-soft)" }}>
          Each bar spans one requisition, from its start date to its end date. The dashed line marks today — bars
          ending before it (red) are overdue returns.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} className="gc-input w-auto font-semibold" style={{ maxWidth: 150 }}>
          <option value="all">All Floors</option>
          {FLOORS.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f]}</option>)}
        </select>
        <select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)} className="gc-input w-auto font-semibold" style={{ maxWidth: 150 }}>
          <option value="all">All Areas</option>
          <option value="plant">Plant Sciences</option>
          <option value="insect">Insect Sciences</option>
        </select>
        <select value={urgencyFilter} onChange={(e) => setUrgencyFilter(e.target.value)} className="gc-input w-auto font-semibold" style={{ maxWidth: 150 }}>
          <option value="all">All Statuses</option>
          <option value="occupied">Occupied</option>
          <option value="warning">Ending soon</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {groups.length === 0 && <p className="text-sm py-6 text-center" style={{ color: "var(--ink-faint)" }}>No requisitions match these filters.</p>}

      <div className="relative h-5 mb-2 ml-24">
        {axisMarks.map((m, i) => (
          <span key={i} className="absolute text-[11px] font-semibold -translate-x-1/2" style={{ left: `${m.pct}%`, color: "var(--ink-faint)" }}>{m.label}</span>
        ))}
      </div>

      <div className="relative">
        <div className="absolute top-0 bottom-0 border-l border-dashed ml-24 pointer-events-none z-10" style={{ left: `${pct(TODAY)}%`, borderColor: "var(--ink-faint)" }} />
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.floor}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ width: 3, height: 13, borderRadius: 2, background: "var(--accent-dark)" }} />
                <span className="text-[13px] font-extrabold gc-display">{FLOOR_LABEL[g.floor]}</span>
              </div>
              <div className="space-y-1.5">
                {(compact ? g.items.slice(0, 3) : g.items).map(({ u, o, start, end }) => {
                  const s = displayStatus(u);
                  const left = pct(start);
                  const width = Math.max(1.2, pct(end) - left);
                  const dm = DISCIPLINE_META[unitDiscipline(u)];
                  const reqIndex = findRequisitionIndex(requests, o);
                  const req = reqIndex !== null ? requests[reqIndex] : null;
                  const rowKey = u.id + o.startDate;
                  const isHovered = hoveredRow === rowKey;
                  return (
                    <div key={rowKey} className="flex items-center gap-2 text-xs">
                      <span className="w-24 flex-shrink-0 flex items-center gap-1.5 text-[12.5px] font-bold" style={{ color: "var(--ink-soft)" }}>
                        <dm.icon size={11} style={{ color: dm.color }} />{u.id}
                      </span>
                      <div
                        className="relative flex-1 h-7 rounded-lg"
                        style={{ background: "var(--surface-soft)" }}
                        onMouseEnter={() => setHoveredRow(rowKey)}
                        onMouseLeave={() => setHoveredRow((cur) => (cur === rowKey ? null : cur))}
                      >
                        <button
                          type="button"
                          onFocus={() => setHoveredRow(rowKey)}
                          onBlur={() => setHoveredRow((cur) => (cur === rowKey ? null : cur))}
                          onClick={() => reqIndex !== null && onNavigate && onNavigate(requisitionTab(req.status), reqIndex)}
                          className="absolute h-7 rounded-lg flex items-center px-2.5"
                          style={{
                            left: `${left}%`, width: `${width}%`, background: s.soft, border: `1px solid ${s.color}`,
                            cursor: reqIndex !== null ? "pointer" : "default",
                          }}
                        >
                          <span className="text-[11.5px] font-bold truncate" style={{ color: s.color }}>{o.researcher}</span>
                        </button>
                        {/* hover detail card — visibility driven by React state (not a CSS-only hover selector) */}
                        {isHovered && (
                          <div
                            className="absolute z-20 top-full mt-1.5 rounded-xl p-3.5 text-left"
                            style={{ left: `${left}%`, minWidth: 240, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 10px 30px -12px rgba(22,33,29,0.25)" }}
                          >
                            <div className="text-[13px] font-extrabold mb-0.5">{o.researcher}</div>
                            <div className="text-[12px] font-semibold mb-1.5" style={{ color: "var(--ink-soft)" }}>{piDisplay(o.labGroup)}</div>
                            <div className="text-[12px] mb-1" style={{ color: "var(--ink-soft)" }}>{o.project}</div>
                            <div className="text-[12px] font-semibold mb-1.5 flex items-center gap-1" style={{ color: "var(--ink-soft)" }}>
                              <MapPin size={11} />{u.id} · {FLOOR_LABEL[u.floor]}, {u.room}
                            </div>
                            <div className="text-[12px] font-bold" style={{ color: s.color }}>{fmtGB(o.startDate)} → {fmtGB(o.endDate)}</div>
                            {reqIndex !== null && <div className="text-[11px] font-bold mt-1.5" style={{ color: "var(--accent-dark)" }}>Click bar to view requisition →</div>}
                          </div>
                        )}
                      </div>
                      <span className="w-24 text-right flex-shrink-0 text-[12.5px] font-bold" style={{ color: s.color }}>
                        {s.key === "overdue" ? `+${Math.abs(daysUntil(o.endDate))}d overdue` : fmtGB(o.endDate)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Inventory / map                                                        */
/* ---------------------------------------------------------------------- */
function UnitCard({ unit, onClick }) {
  const s = displayStatus(unit);
  const isReftech = unit.type === "reftech";
  const occupant = unitOccupant(unit);
  const upcoming = isReftech ? upcomingBookings(unit) : [];
  const dm = DISCIPLINE_META[unitDiscipline(unit)];

  // occupant / availability box colour follows the same status language used everywhere else
  const boxStyle =
    s.key === "overdue" ? { background: "var(--overdue-soft)", ink: "var(--overdue)" } :
    s.key === "warning" ? { background: "var(--warning-soft)", ink: "var(--warning)" } :
    s.key === "occupied" ? { background: "var(--occupied-soft)", ink: "var(--occupied)" } :
    s.key === "service" ? { background: "var(--service-soft)", ink: "var(--service)" } :
    { background: "var(--surface-soft)", ink: "var(--ink-soft)" };

  return (
    <button onClick={onClick} className="group text-left rounded-2xl overflow-hidden border transition-all hover:-translate-y-0.5 hover:shadow-lg flex flex-col p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="gc-display text-lg font-extrabold leading-none">{unit.id}</div>
        <StatusTag unit={unit} />
      </div>
      <div className="text-[12px] mb-2.5" style={{ color: "var(--ink-soft)" }}>
        {isReftech ? "Reftech Room · " : ""}{unit.manufacturer} {unit.model}
      </div>

      {/* room — the most-checked field, given its own prominent chip */}
      <div className="mb-3"><RoomChip unit={unit} /></div>

      {/* live readouts if occupied, otherwise the operating range */}
      {occupant ? (
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div className="gc-readout"><div className="lbl">TEMP</div><div className="val" style={{ color: "var(--chip-temp)" }}>{occupant.setTemp}°C</div></div>
          <div className="gc-readout"><div className="lbl">RH</div><div className="val" style={{ color: "var(--chip-rh)" }}>{occupant.setHumidity}%</div></div>
          <div className="gc-readout"><div className="lbl">CYCLE</div><div className="val" style={{ color: "var(--chip-cycle)", fontSize: 12.5 }}>{occupant.lightCycle}</div></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          <div className="gc-readout"><div className="lbl">TEMP RANGE</div><div className="val text-white" style={{ fontSize: 13.5 }}>{unit.tempRange[0]}–{unit.tempRange[1]}°C</div></div>
          <div className="gc-readout"><div className="lbl">RH RANGE</div><div className="val text-white" style={{ fontSize: 13.5 }}>{unit.humidityRange[0]}–{unit.humidityRange[1]}%</div></div>
        </div>
      )}

      {/* tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="gc-tag" style={{ background: dm.color === DISCIPLINE_META.plant.color ? "var(--tag-plant-bg)" : "var(--tag-insect-bg)", color: dm.color === DISCIPLINE_META.plant.color ? "var(--tag-plant-ink)" : "var(--tag-insect-ink)", borderColor: dm.color === DISCIPLINE_META.plant.color ? "var(--tag-plant-border)" : "var(--tag-insect-border)" }}>
          <dm.icon size={11} /> {dm.label}
        </span>
        {unit.co2Control && <span className="gc-tag" style={{ background: "var(--tag-co2-bg)", color: "var(--tag-co2-ink)", borderColor: "var(--tag-co2-border)" }}>CO₂</span>}
      </div>

      {/* occupant / availability */}
      <div className="mt-auto rounded-xl px-3.5 py-3" style={{ background: boxStyle.background }}>
        {occupant ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-extrabold flex-shrink-0" style={{ background: "rgba(255,255,255,0.65)", color: boxStyle.ink }}>
                {occupant.researcher.split(" ").map((p) => p[0]).join("").slice(0, 2)}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold truncate" style={{ color: boxStyle.ink }}>{occupant.researcher}</div>
                <div className="text-[11px] font-semibold truncate" style={{ color: boxStyle.ink, opacity: 0.85 }}>{occupant.role ? `${occupant.role} · ` : ""}{piDisplay(occupant.labGroup)}</div>
              </div>
            </div>
            <div className="text-[11px] font-bold mt-2" style={{ color: boxStyle.ink, opacity: 0.9 }}>
              {s.key === "overdue" ? `Was due back ${fmtGB(occupant.endDate)}` : `Until ${fmtGB(occupant.endDate)}`}
            </div>
            {isReftech && upcoming.length > 0 && (
              <div className="text-[11px] font-bold mt-1" style={{ color: "var(--accent-dark)" }}>+{upcoming.length} more requisition{upcoming.length !== 1 ? "s" : ""} ahead →</div>
            )}
          </>
        ) : unit.status === "service" ? (
          <div className="text-[12.5px] font-bold text-center" style={{ color: boxStyle.ink }}>
            Under maintenance{unit.serviceLog[0] ? ` · serviced ${fmtGB(unit.serviceLog[0].date)} by contractor ${unit.serviceLog[0].engineer}` : ""}
          </div>
        ) : isReftech && upcoming.length > 0 ? (
          <div className="text-[12.5px] font-bold text-center" style={{ color: boxStyle.ink }}>Free now — next requisition {fmtGB(upcoming[0].startDate)}</div>
        ) : (
          <div className="text-[12.5px] font-bold text-center" style={{ color: boxStyle.ink }}>Free and ready to book</div>
        )}
      </div>
    </button>
  );
}

const FILTER_CHIPS = [
  { key: "all", label: "All Statuses" }, { key: "free", label: "Free" }, { key: "occupied", label: "Occupied" },
  { key: "warning", label: "Ending soon" }, { key: "overdue", label: "Overdue" }, { key: "service", label: "Out of Service" },
];

function exportUnitsCSV(units) {
  const headers = ["ID", "Type", "Floor", "Room", "Manufacturer", "Model", "Discipline", "Status", "Researcher", "PI", "Until"];
  const rows = units.map((u) => {
    const s = displayStatus(u);
    const occ = unitOccupant(u);
    return [
      u.id, u.type === "reftech" ? "Reftech Room" : "Growth Cabinet", FLOOR_LABEL[u.floor], u.room,
      u.manufacturer, u.model, DISCIPLINE_META[unitDiscipline(u)].label, s.label,
      occ ? occ.researcher : "", occ ? (PI_BY_LAB[occ.labGroup] || "") : "", occ ? fmtGB(occ.endDate) : "",
    ];
  });
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `inventory-${fmt(TODAY)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function InventoryPage({ units, onSelect, onAddNew, initialFilter }) {
  const [query, setQuery] = useState(initialFilter?.query || "");
  const [statusFilter, setStatusFilter] = useState(initialFilter?.status || "all");
  const [typeFilter, setTypeFilter] = useState(initialFilter?.type || "all");
  const [disciplineFilter, setDisciplineFilter] = useState(initialFilter?.discipline || "all");
  const [labGroupFilter, setLabGroupFilter] = useState(initialFilter?.labGroup || "all");
  const [floorFilter, setFloorFilter] = useState(initialFilter?.floor || "all");

  const cabinetCount = units.filter((u) => u.type === "cabinet").length;
  const reftechCount = units.filter((u) => u.type === "reftech").length;

  const filtered = units.filter((u) => {
    const s = displayStatus(u);
    const occ = unitOccupant(u);
    const matchesQuery = query === "" || u.id.toLowerCase().includes(query.toLowerCase()) || u.room.toLowerCase().includes(query.toLowerCase()) ||
      (occ && occ.labGroup.toLowerCase().includes(query.toLowerCase())) || (occ && occ.researcher.toLowerCase().includes(query.toLowerCase())) ||
      (occ && (PI_BY_LAB[occ.labGroup] || "").toLowerCase().includes(query.toLowerCase()));
    return matchesQuery
      && (statusFilter === "all" || s.key === statusFilter)
      && (typeFilter === "all" || u.type === typeFilter)
      && (disciplineFilter === "all" || unitDiscipline(u) === disciplineFilter)
      && (labGroupFilter === "all" || (occ && occ.labGroup === labGroupFilter))
      && (floorFilter === "all" || u.floor === floorFilter);
  });
  const groups = FLOORS
    .map((f) => ({
      label: FLOOR_LABEL[f], floor: f,
      items: filtered.filter((u) => u.floor === f).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true })),
    }))
    .filter((g) => g.items.length);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="gc-display text-2xl font-extrabold">Inventory</h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--ink-soft)" }}>{units.length} growth cabinets &amp; Reftech rooms across {FLOORS.length} floors</p>
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button onClick={() => exportUnitsCSV(filtered)} className="flex items-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink)" }}>
            Export CSV
          </button>
          <button onClick={onAddNew} className="flex items-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl text-white" style={{ background: "var(--accent-dark)" }}>
            <PlusCircle size={15} /> Add Cabinet
          </button>
        </div>
      </div>

      {/* segmented type tabs with live counts */}
      <div className="inline-flex items-center p-1 rounded-2xl mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {[
          { key: "cabinet", label: "Growth Cabinets", count: cabinetCount },
          { key: "reftech", label: "Reftech Rooms", count: reftechCount },
          { key: "all", label: "All Units", count: units.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTypeFilter(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ background: typeFilter === t.key ? "var(--sidebar-bg)" : "transparent", color: typeFilter === t.key ? "#fff" : "var(--ink-soft)" }}
          >
            {t.label}
            <span
              className="text-[11px] font-extrabold px-2 py-0.5 rounded-full"
              style={{ background: typeFilter === t.key ? "rgba(255,255,255,0.15)" : "var(--surface-soft)", color: typeFilter === t.key ? "#fff" : "var(--ink-faint)" }}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {labGroupFilter !== "all" && (
        <div className="flex items-center gap-2 mb-4 text-sm px-4 py-2.5 rounded-xl" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
          Filtered to <strong>{piDisplay(labGroupFilter)}</strong>
          <button onClick={() => setLabGroupFilter("all")} className="ml-auto text-xs font-semibold underline">Clear</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl flex-1 min-w-[240px]" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <Search size={15} style={{ color: "var(--ink-faint)" }} />
          <input placeholder="Search by ID, room, researcher, or PI…" value={query} onChange={(e) => setQuery(e.target.value)} className="text-sm outline-none flex-1 bg-transparent" />
        </div>
        <select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)} className="gc-input w-auto font-semibold" style={{ maxWidth: 150 }}>
          <option value="all">All Areas</option>
          <option value="plant">Plant Sciences</option>
          <option value="insect">Insect Sciences</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="gc-input w-auto font-semibold" style={{ maxWidth: 150 }}>
          {FILTER_CHIPS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <span className="text-xs gc-mono font-semibold ml-auto" style={{ color: "var(--ink-faint)" }}>{filtered.length} of {units.length}</span>
      </div>

      {/* floor filter as individual buttons — quicker for admins than a dropdown */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        <button
          onClick={() => setFloorFilter("all")}
          className="px-3.5 py-1.5 rounded-full text-xs font-bold"
          style={{ background: floorFilter === "all" ? "var(--sidebar-bg)" : "var(--surface)", color: floorFilter === "all" ? "#fff" : "var(--ink-soft)", border: floorFilter === "all" ? "none" : "1px solid var(--border)" }}
        >
          All Floors
        </button>
        {FLOORS.map((f) => (
          <button
            key={f}
            onClick={() => setFloorFilter(f)}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold"
            style={{ background: floorFilter === f ? "var(--sidebar-bg)" : "var(--surface)", color: floorFilter === f ? "#fff" : "var(--ink-soft)", border: floorFilter === f ? "none" : "1px solid var(--border)" }}
          >
            {FLOOR_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="space-y-8">
        {groups.map((g, gi) => (
          <section key={gi}>
            <div className="flex items-center gap-2.5 mb-3.5">
              <span style={{ width: 4, height: 16, borderRadius: 2, background: "var(--accent-dark)" }} />
              <h3 className="gc-display text-[15px] font-extrabold">{g.label}</h3>
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink-faint)" }}>{g.items.length} unit{g.items.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="grid grid-cols-3 xl:grid-cols-4 gap-3.5">
              {g.items.map((u) => <UnitCard key={u.id} unit={u} onClick={() => onSelect(u)} />)}
            </div>
          </section>
        ))}
        {filtered.length === 0 && <p className="text-sm text-center py-10" style={{ color: "var(--ink-faint)" }}>No units match your filters.</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Unit detail drawer / full page + editable service log                  */
/* ---------------------------------------------------------------------- */
function SpecRow({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>{label}</div>
      <div className="text-[14px] font-bold mt-1" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}
/* Plain grey-caps label, no underline — used for every section header in the unit modal */
function SectionLabel({ children }) {
  return <h3 className="gc-display text-[13px] font-bold" style={{ color: "var(--ink)" }}>{children}</h3>;
}
/* Grey box heading used for the spec boxes (Asset Info / Environment & Controls / requisition sections) */
function BoxLabel({ children }) {
  return <h3 className="gc-display text-[13px] font-bold mb-1" style={{ color: "var(--ink)" }}>{children}</h3>;
}
/* Definition-list style field row — label left, value right, a hairline divider between rows.
   Arranged two-up by the caller (FieldGrid) so it stays compact without feeling like a spreadsheet. */
function FieldPair({ label, value }) {
  return (
    <div className="grid items-baseline gap-3 py-2.5 min-w-0" style={{ gridTemplateColumns: "auto 1fr", borderTop: "1px solid rgba(22,33,29,0.07)" }}>
      <span className="text-[12.5px]" style={{ color: "var(--ink-faint)" }}>{label}</span>
      <span className="text-[13px] font-medium text-right min-w-0" style={{ color: "var(--ink)", overflowWrap: "break-word", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}
/* Wraps a set of FieldPairs in the two-column layout, with the box heading's bottom border
   serving as the divider above the first row of each column. */
function FieldGrid({ children }) {
  return <div className="grid grid-cols-2 gap-x-6">{children}</div>;
}
/* Light grey rounded box wrapper for the spec sections */
function InfoBox({ children, className = "" }) {
  return <div className={`rounded-2xl px-5 py-4 ${className}`} style={{ background: "var(--surface-soft)" }}>{children}</div>;
}
function AssetInfoCard({ unit }) {
  const isReftech = unit.type === "reftech";
  return (
    <InfoBox>
      <BoxLabel>Asset Info</BoxLabel>
      <FieldGrid>
        <FieldPair label="Status" value={<StatusTag unit={unit} big />} />
        <FieldPair label="Type" value={isReftech ? "Reftech Room" : "Growth Cabinet"} />
        <FieldPair label="Research area" value={<DisciplineBadge discipline={unitDiscipline(unit)} size="md" />} />
        <FieldPair label="Manufacturer" value={unit.manufacturer} />
        <FieldPair label="Model" value={unit.model} />
        <FieldPair label="Serial No." value={unit.serialNumber} />
        <FieldPair label="Asset No." value={unit.assetNumber} />
        <FieldPair label="TSCAN ID" value={unit.tscanId} />
        <FieldPair label="Location" value={<RoomChip unit={unit} size="sm" />} />
        <FieldPair label="Installed" value={fmtGB(unit.installDate)} />
      </FieldGrid>
    </InfoBox>
  );
}
function EnvironmentControlsCard({ unit }) {
  const isReftech = unit.type === "reftech";
  return (
    <InfoBox>
      <BoxLabel>Environment &amp; Controls</BoxLabel>
      <FieldGrid>
        {!isReftech && <FieldPair label="Shelves" value={unit.shelves} />}
        <FieldPair label="Temp range" value={`${unit.tempRange[0]}–${unit.tempRange[1]}°C`} />
        <FieldPair label="Humidity range" value={`${unit.humidityRange[0]}–${unit.humidityRange[1]}%`} />
        <FieldPair label="Lighting type" value={unit.lightingType} />
        <FieldPair label="Ballasts" value={unit.ballasts} />
        <FieldPair label="CO₂ control" value={unit.co2Control ? "Yes" : "No"} />
        <FieldPair label="Dimming control" value={unit.dimmingControl ? "Yes" : "No"} />
        <FieldPair label="Last bulb fitting" value={fmtGB(unit.lastBulbFitting)} />
        <FieldPair label="Next service due" value={fmtGB(unit.nextServiceDue)} />
      </FieldGrid>
    </InfoBox>
  );
}

function ServiceLogEditor({ unit, onUpdate, categories, categoryColors, onAddCategory, onRemoveCategory }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [date, setDate] = useState(fmt(TODAY));
  const [category, setCategory] = useState(categories[0]);
  const [status, setStatus] = useState("completed");
  const [engineer, setEngineer] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setAdding(false); setEditingId(null); setEngineer(""); setNotes(""); setCost(""); setManageOpen(false);
    setDate(fmt(TODAY)); setCategory(categories[0]); setStatus("completed");
  };

  const buildEntry = (id) => ({
    id, date, category, status, engineer, notes,
    cost: cost === "" ? null : Number(cost),
  });

  const addEntry = () => {
    if (!notes.trim() || (status === "completed" && !engineer.trim())) return;
    const next = [buildEntry(`svc-${Date.now()}`), ...unit.serviceLog].sort((a, b) => (a.date < b.date ? 1 : -1));
    onUpdate(next);
    resetForm();
  };
  const startEdit = (entry) => {
    setEditingId(entry.id); setAdding(false);
    setDate(entry.date); setCategory(entry.category || categories[0]); setStatus(entry.status || "completed");
    setEngineer(entry.engineer || ""); setCost(entry.cost != null ? String(entry.cost) : ""); setNotes(entry.notes || "");
  };
  const logAsDone = (entry) => {
    startEdit(entry);
    setStatus("completed");
    setDate(fmt(TODAY));
  };
  const saveEdit = () => {
    if (!notes.trim() || (status === "completed" && !engineer.trim())) return;
    const next = unit.serviceLog
      .map((e) => (e.id === editingId ? buildEntry(editingId) : e))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    onUpdate(next);
    resetForm();
  };
  const removeEntry = (id) => onUpdate(unit.serviceLog.filter((e) => e.id !== id));

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Maintenance History</SectionLabel>
        {!adding && !editingId && (
          <button onClick={() => { setAdding(true); setEditingId(null); }} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--accent-dark)" }}>
            <PlusCircle size={13} /> Log / schedule maintenance
          </button>
        )}
      </div>

      {(adding || editingId) && (
        <div className="rounded-xl border p-3.5 mb-3 space-y-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Category">
              <div className="flex items-center gap-2">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="gc-input">
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button type="button" onClick={() => setManageOpen((v) => !v)} className="text-[11px] font-bold flex-shrink-0" style={{ color: "var(--accent-dark)" }}>Manage</button>
              </div>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="gc-input">
                <option value="completed">Completed</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </Field>
          </div>

          {manageOpen && (
            <div className="rounded-lg p-2.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {categories.map((c) => {
                  const col = categoryColors[c] || FALLBACK_CATEGORY_COLOR;
                  return (
                    <span key={c} className="gc-tag" style={{ background: col.bg, color: col.ink, borderColor: col.border }}>
                      {c}
                      <button type="button" onClick={() => onRemoveCategory(c)} className="rounded-full hover:bg-black/10"><X size={10} /></button>
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input value={newCat} onChange={(e) => setNewCat(e.target.value)} className="gc-input" placeholder="New category name" />
                <button
                  type="button"
                  onClick={() => { if (newCat.trim()) { onAddCategory(newCat.trim()); setNewCat(""); } }}
                  className="text-xs font-bold px-3 rounded-lg text-white flex-shrink-0"
                  style={{ background: "var(--accent-dark)" }}
                >
                  Add
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <Field label={status === "scheduled" ? "Date due" : "Date completed"}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="gc-input" /></Field>
            <Field label={status === "scheduled" ? "Contractor (optional)" : "Contractor"}><input value={engineer} onChange={(e) => setEngineer(e.target.value)} className="gc-input" placeholder="e.g. R. Adeyemi" /></Field>
          </div>
          <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="gc-input" placeholder="What was done, or what's planned…" /></Field>
          <Field label="Cost (optional)"><input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} className="gc-input" placeholder="£" /></Field>
          <div className="flex gap-2 pt-1">
            <button onClick={editingId ? saveEdit : addEntry} className="flex items-center gap-1.5 text-sm font-bold px-3 py-2 rounded-lg text-white" style={{ background: "var(--accent-dark)" }}>
              <Save size={13} /> {editingId ? "Save changes" : "Save entry"}
            </button>
            <button onClick={resetForm} className="text-sm font-semibold px-3 py-2 rounded-lg" style={{ color: "var(--ink-soft)" }}>Cancel</button>
          </div>
        </div>
      )}

      <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Date", "Contractor", "Category", "Notes", "Cost", ""].map((h, i) => (
              <th
                key={h + i}
                className={`text-[11px] font-semibold pb-2 ${i === 4 ? "text-right" : "text-left"}`}
                style={{ color: "var(--ink-faint)", borderBottom: "1px solid var(--border)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {unit.serviceLog.map((entry) => {
            const cat = categoryColors[entry.category] || FALLBACK_CATEGORY_COLOR;
            const isScheduled = entry.status === "scheduled";
            return (
              <tr key={entry.id} className="group" style={{ borderTop: "1px solid rgba(22,33,29,0.07)" }}>
                <td className="py-2.5 pr-3 align-top" style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{fmtGB(entry.date)}</td>
                <td className="py-2.5 pr-3 align-top font-medium" style={{ whiteSpace: "nowrap" }}>
                  {isScheduled ? (
                    <span className="flex flex-col">
                      <span>Scheduled</span>
                      <button onClick={() => logAsDone(entry)} className="text-[11.5px] font-bold text-left" style={{ color: "var(--accent-dark)" }}>Log as done</button>
                    </span>
                  ) : (entry.engineer || "—")}
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <span className="gc-tag" style={{ background: cat.bg, color: cat.ink, borderColor: cat.border }}>{entry.category || "Maintenance"}</span>
                </td>
                <td className="py-2.5 pr-3 align-top" style={{ color: "var(--ink-soft)" }}>{entry.notes}</td>
                <td className="py-2.5 pr-3 align-top text-right font-medium" style={{ whiteSpace: "nowrap" }}>{entry.cost != null ? `£${entry.cost.toLocaleString("en-GB")}` : "—"}</td>
                <td className="py-2.5 align-top">
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 justify-end">
                    <button onClick={() => startEdit(entry)} className="p-1" style={{ color: "var(--ink-faint)" }} title="Edit entry"><Pencil size={13} /></button>
                    <button onClick={() => removeEntry(entry.id)} className="p-1" style={{ color: "var(--ink-faint)" }} title="Delete entry"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unit.serviceLog.length === 0 && <p className="text-sm py-2" style={{ color: "var(--ink-faint)" }}>No service history yet.</p>}
    </section>
  );
}

function DocumentsSection({ unit, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState(DOCUMENT_TYPES[0]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.pdf$/i, ""));
  };

  const addDoc = async () => {
    if (!name.trim() || !file) return;
    setBusy(true);
    try {
      await onAdd(file, name.trim(), type);
      setName(""); setType(DOCUMENT_TYPES[0]); setFile(null); setAdding(false);
    } finally {
      setBusy(false);
    }
  };
  const removeDoc = (id) => onRemove(id);
  const openDoc = (d) => { if (d.url) window.open(d.url, "_blank", "noopener,noreferrer"); };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Documents</SectionLabel>
        <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--accent-dark)" }}>
          <PlusCircle size={13} /> Add document
        </button>
      </div>
      {adding && (
        <div className="rounded-xl border p-3.5 mb-3 space-y-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-soft)" }}>
          <Field label="PDF file">
            <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} className="gc-input text-left" style={{ color: file ? "var(--ink)" : "var(--ink-faint)" }}>
              {file ? file.name : "Choose a PDF…"}
            </button>
            <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" />
          </Field>
          <Field label="Document name"><input value={name} onChange={(e) => setName(e.target.value)} className="gc-input" placeholder="e.g. Calibration Certificate 2027" /></Field>
          <Field label="Type"><select value={type} onChange={(e) => setType(e.target.value)} className="gc-input">{DOCUMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="flex gap-2 pt-1">
            <button disabled={!file || !name.trim() || busy} onClick={addDoc} className="flex items-center gap-1.5 text-sm font-bold px-3 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: "var(--accent-dark)" }}><Save size={13} /> {busy ? "Uploading…" : "Save"}</button>
            <button disabled={busy} onClick={() => { setAdding(false); setFile(null); }} className="text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-40" style={{ color: "var(--ink-soft)" }}>Cancel</button>
          </div>
        </div>
      )}
      <div>
        {unit.documents.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2.5 group" style={{ borderTop: "1px solid rgba(22,33,29,0.07)" }}>
            <FileText size={15} className="flex-shrink-0" style={{ color: "var(--ink-faint)" }} />
            <button onClick={() => openDoc(d)} disabled={!d.url} className="flex-1 min-w-0 text-left" style={{ cursor: d.url ? "pointer" : "default" }}>
              <div className="text-[13px] font-medium truncate" style={{ color: d.url ? "var(--accent-dark)" : "var(--ink)" }}>{d.name}</div>
              <div className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{d.type} · {d.addedBy} · {fmtGB(d.date)}{!d.url ? " · no file attached" : ""}</div>
            </button>
            <button onClick={() => removeDoc(d.id)} className="opacity-0 group-hover:opacity-100 p-1 flex-shrink-0" style={{ color: "var(--ink-faint)" }} title="Remove"><Trash2 size={13} /></button>
          </div>
        ))}
        {unit.documents.length === 0 && <p className="text-sm py-2" style={{ color: "var(--ink-faint)" }}>No documents attached yet.</p>}
      </div>
    </section>
  );
}

function PhotoCard({ unit, onUpdate }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const openPicker = () => inputRef.current && inputRef.current.click();
  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setBusy(true);
    try {
      await onUpdate(file);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };
  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel>Photo</SectionLabel>
        <button disabled={busy} onClick={openPicker} className="text-xs font-bold disabled:opacity-40" style={{ color: "var(--accent-dark)" }}>{busy ? "Uploading…" : unit.photoDataUrl ? "Replace" : "Add photo"}</button>
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      </div>
      <button
        onClick={openPicker}
        className="group relative w-full rounded-xl flex items-center justify-center overflow-hidden"
        style={{ background: "var(--surface-soft)", height: 190 }}
      >
        {unit.photoDataUrl ? (
          <>
            <img src={unit.photoDataUrl} alt={unit.id} className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(22,33,29,0.45)" }}>
              <span className="text-white text-xs font-bold">Click to replace</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2" style={{ color: "var(--ink-faint)" }}>
            {unit.type === "reftech" ? <DoorOpen size={28} /> : <Leaf size={28} />}
            <span className="text-xs font-semibold">Click to add a photo</span>
          </div>
        )}
      </button>
    </>
  );
}

function BookingCard({ booking, status, onOpenRequisition }) {
  const clickable = !!onOpenRequisition;
  const Wrapper = clickable ? "button" : "div";
  const color = status ? status.color : "var(--occupied)";
  const soft = status ? status.soft : "var(--occupied-soft)";
  const initials = booking.researcher.split(" ").map((p) => p[0]).join("").slice(0, 2);
  return (
    <Wrapper
      onClick={onOpenRequisition}
      className={`w-full text-left rounded-2xl p-4 flex items-center gap-4 ${clickable ? "gc-clickable" : ""}`}
      style={{ background: soft }}
    >
      <span className="w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-sm flex-shrink-0" style={{ background: "rgba(255,255,255,0.65)", color }}>
        {initials}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-extrabold text-[15px]" style={{ color }}>{booking.researcher}</div>
        <div className="italic text-[13px] truncate" style={{ color, opacity: 0.85 }}>{booking.project} · {piDisplay(booking.labGroup)}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] font-semibold mt-1" style={{ color, opacity: 0.75 }}>
          <span>{fmtGB(booking.startDate)} → {fmtGB(booking.endDate)}</span>
          <span>{booking.setTemp}°C · {booking.setHumidity}% · {booking.lightCycle}</span>
        </div>
      </div>
      {clickable && <ChevronRight size={18} style={{ color, opacity: 0.6 }} className="flex-shrink-0" />}
    </Wrapper>
  );
}

function UnitDetailContent({
  unit, onEdit, onUpdateServiceLog, onAddDocument, onRemoveDocument, onUpdatePhoto, requests = [], onOpenRequisition, goRequisitions,
  categories, categoryColors, onAddCategory, onRemoveCategory,
}) {
  const s = displayStatus(unit);
  const isReftech = unit.type === "reftech";
  const cb = currentBooking(unit);
  const upcoming = upcomingBookings(unit);
  const pastBookings = isReftech ? unit.bookings.filter((b) => new Date(b.endDate) < TODAY) : [];
  const linkFor = (booking) => {
    if (!onOpenRequisition) return undefined;
    const idx = findRequisitionIndex(requests, booking);
    if (idx === null) return undefined;
    return () => onOpenRequisition(requisitionTab(requests[idx].status), idx);
  };

  const requisitionSection = (
    <section id="booking-section">
      <SectionLabel>Current Requisition</SectionLabel>
      <div className="space-y-3 mt-3">
        {isReftech ? (
          <>
            {cb && <BookingCard booking={cb} status={s} onOpenRequisition={linkFor(cb)} />}
            {upcoming.length > 0 && (
              <div>
                <div className="text-[11px] mb-1.5 font-bold uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>Upcoming</div>
                <div className="space-y-2">{upcoming.map((b) => <BookingCard key={b.id} booking={b} onOpenRequisition={linkFor(b)} />)}</div>
              </div>
            )}
            {!cb && upcoming.length === 0 && (
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No current or upcoming requisitions for this room.</p>
            )}
          </>
        ) : unit.occupant ? (
          <BookingCard booking={unit.occupant} status={s} onOpenRequisition={linkFor(unit.occupant)} />
        ) : (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{unit.status === "service" ? "Marked out of service — no active requisition." : "Currently free."}</p>
        )}
      </div>

      {pastBookings.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Past Requisitions ({pastBookings.length})</SectionLabel>
          <button
            onClick={() => goRequisitions && goRequisitions("completed", null, unit.id)}
            className="mt-3 w-full text-left text-[13px] rounded-xl px-4 py-3 gc-clickable"
            style={{ background: "var(--surface-soft)", color: "var(--ink-soft)" }}
          >
            Past requisitions are stored on the <strong style={{ color: "var(--ink)" }}>Requisitions</strong> page for reference.
          </button>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      {requisitionSection}
      <AssetInfoCard unit={unit} />
      <EnvironmentControlsCard unit={unit} />
      <ServiceLogEditor
        unit={unit} onUpdate={(log) => onUpdateServiceLog(unit.id, log)}
        categories={categories} categoryColors={categoryColors} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory}
      />
      <DocumentsSection
        unit={unit}
        onAdd={(file, name, type) => onAddDocument(unit.id, file, name, type)}
        onRemove={(docId) => onRemoveDocument(unit.id, docId)}
      />
      <PhotoCard unit={unit} onUpdate={(file) => onUpdatePhoto(unit.id, file)} />
    </div>
  );
}

function UnitModal({ unit, onClose, onEdit, onUpdateServiceLog, onAddDocument, onRemoveDocument, onUpdatePhoto, requests, onOpenRequisition, goRequisitions, categories, categoryColors, onAddCategory, onRemoveCategory }) {
  if (!unit) return null;

  return (
    <div
      className="flex items-center justify-center p-6"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, background: "rgba(22,33,29,0.4)" }}
      onClick={onClose}
    >
      <div
        className="gc-scroll rounded-3xl shadow-2xl"
        style={{
          background: "var(--surface)",
          width: "100%", maxWidth: 820,
          maxHeight: "82vh", overflowY: "auto",
          boxSizing: "border-box",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 py-5" style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div>
            <h1 className="gc-display text-2xl font-extrabold leading-none">{unit.id}</h1>
            <p className="text-[13.5px] mt-1.5" style={{ color: "var(--ink-soft)" }}>{unit.manufacturer} {unit.model}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => onEdit(unit)} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--surface-soft)" }} title="Edit"><Pencil size={15} /></button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--surface-soft)" }} title="Close"><X size={16} /></button>
          </div>
        </div>

        <div className="px-7 py-6">
          <UnitDetailContent
            unit={unit} onEdit={onEdit} onUpdateServiceLog={onUpdateServiceLog}
            onAddDocument={onAddDocument} onRemoveDocument={onRemoveDocument} onUpdatePhoto={onUpdatePhoto}
            requests={requests} onOpenRequisition={onOpenRequisition} goRequisitions={goRequisitions}
            categories={categories} categoryColors={categoryColors} onAddCategory={onAddCategory} onRemoveCategory={onRemoveCategory}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Add / edit unit modal                                                  */
/* ---------------------------------------------------------------------- */
function AddEditUnitModal({ unit, onClose, onSave }) {
  const isEdit = !!unit;
  const [form, setForm] = useState(
    unit
      ? { ...unit, tempMin: unit.tempRange[0], tempMax: unit.tempRange[1], humMin: unit.humidityRange[0], humMax: unit.humidityRange[1] }
      : {
          id: "", type: "cabinet", floor: "L1", room: ROOMS_BY_FLOOR.L1[0], discipline: "plant",
          manufacturer: MANUFACTURERS[0], model: "", serialNumber: "", assetNumber: "", tscanId: "",
          shelves: 4, lightingType: LIGHTING_TYPES[0], ballasts: BALLAST_TYPES[0],
          co2Control: false, dimmingControl: false, lastBulbFitting: fmt(TODAY),
          installDate: fmt(TODAY), tempMin: 4, tempMax: 30, humMin: 30, humMax: 85, status: "free",
        }
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const roomOptions = form.type === "reftech" ? REFTECH_ROOMS_BY_FLOOR[form.floor] : ROOMS_BY_FLOOR[form.floor];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(32,43,44,0.35)" }} onClick={onClose}>
      <div className="gc-scroll rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h2 className="gc-display text-lg font-extrabold">{isEdit ? `Edit ${unit.id}` : "Add new unit"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-black/5"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              ...form,
              id: isEdit ? unit.id : form.id || `GC-NEW-${Math.floor(Math.random() * 900 + 100)}`,
              shelves: form.type === "reftech" ? null : Number(form.shelves),
              tempRange: [Number(form.tempMin), Number(form.tempMax)],
              humidityRange: [Number(form.humMin), Number(form.humMax)],
              availableLightCycles: form.availableLightCycles || LIGHT_CYCLES,
            });
          }}
        >
          {!isEdit && (
            <Field label="Cabinet / Room ID">
              <input value={form.id} onChange={set("id")} className="gc-input" placeholder="e.g. GC-081" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, room: (e.target.value === "reftech" ? REFTECH_ROOMS_BY_FLOOR : ROOMS_BY_FLOOR)[f.floor][0] }))}
                className="gc-input"
              >
                <option value="cabinet">Growth cabinet</option>
                <option value="reftech">Reftech Room</option>
              </select>
            </Field>
            {form.type === "cabinet" && (
              <Field label="Discipline">
                <select value={form.discipline} onChange={set("discipline")} className="gc-input">
                  <option value="plant">Plant Sciences</option>
                  <option value="insect">Insect Sciences</option>
                </select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Floor">
              <select
                value={form.floor}
                onChange={(e) => setForm((f) => ({ ...f, floor: e.target.value, room: (f.type === "reftech" ? REFTECH_ROOMS_BY_FLOOR : ROOMS_BY_FLOOR)[e.target.value][0] }))}
                className="gc-input"
              >
                {FLOORS.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f]}</option>)}
              </select>
            </Field>
            <Field label="Room">
              <select value={form.room} onChange={set("room")} className="gc-input">
                {roomOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Manufacturer">
              <select value={form.manufacturer} onChange={set("manufacturer")} className="gc-input">
                {MANUFACTURERS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Model"><input value={form.model} onChange={set("model")} className="gc-input" placeholder="e.g. E-15" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Serial number"><input value={form.serialNumber} onChange={set("serialNumber")} className="gc-input" placeholder="SN-…" /></Field>
            <Field label="Asset number"><input value={form.assetNumber} onChange={set("assetNumber")} className="gc-input" placeholder="AST-…" /></Field>
            <Field label="TSCAN ID"><input value={form.tscanId} onChange={set("tscanId")} className="gc-input" placeholder="TSC-…" /></Field>
          </div>
          {form.type === "cabinet" && (
            <Field label="Shelves"><input type="number" min={1} value={form.shelves} onChange={set("shelves")} className="gc-input" /></Field>
          )}
          <Field label="Install date"><input type="date" value={form.installDate} onChange={set("installDate")} className="gc-input" /></Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Temp range (°C)">
              <div className="flex items-center gap-2">
                <input type="number" value={form.tempMin} onChange={set("tempMin")} className="gc-input" />
                <span style={{ color: "var(--ink-faint)" }}>–</span>
                <input type="number" value={form.tempMax} onChange={set("tempMax")} className="gc-input" />
              </div>
            </Field>
            <Field label="Humidity range (%)">
              <div className="flex items-center gap-2">
                <input type="number" value={form.humMin} onChange={set("humMin")} className="gc-input" />
                <span style={{ color: "var(--ink-faint)" }}>–</span>
                <input type="number" value={form.humMax} onChange={set("humMax")} className="gc-input" />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Lighting type">
              <select value={form.lightingType} onChange={set("lightingType")} className="gc-input">
                {LIGHTING_TYPES.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ballasts">
              <select value={form.ballasts} onChange={set("ballasts")} className="gc-input">
                {BALLAST_TYPES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Last bulb fitting"><input type="date" value={form.lastBulbFitting} onChange={set("lastBulbFitting")} className="gc-input" /></Field>
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.co2Control} onChange={setBool("co2Control")} /> CO₂ control</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.dimmingControl} onChange={setBool("dimmingControl")} /> Dimming control</label>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.status === "service"} onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? "service" : "free" }))} />
              Mark as out of service
            </label>
          )}
          <button type="submit" className="w-full py-2.5 rounded-xl font-medium text-white" style={{ background: "var(--gradient)" }}>
            {isEdit ? "Save changes" : "Add unit"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Requisitions                                                           */
/* ---------------------------------------------------------------------- */
/* Every field a researcher can submit on the Request Space form — shown in full to admins,
   reused by both the Requisitions page cards and the timeline's requisition preview panel. */
function RequisitionDetailFields({ req }) {
  const isPlant = req.discipline === "plant";
  return (
    <div className="space-y-4">
      <InfoBox>
        <BoxLabel>Requester</BoxLabel>
        <FieldGrid>
          <FieldPair label="Name" value={req.researcher} />
          <FieldPair label="Role" value={req.role || "—"} />
          <FieldPair label="Email" value={req.email} />
          <FieldPair label="Emergency number" value={req.emergencyNumber || "—"} />
          <FieldPair label="Lab group" value={piDisplay(req.labGroup)} />
          <FieldPair label="PI / supervisor" value={req.pi || "—"} />
        </FieldGrid>
      </InfoBox>

      <InfoBox>
        <BoxLabel>Space &amp; Environment</BoxLabel>
        <FieldGrid>
          <FieldPair label="Space type" value={req.unitType === "reftech" ? "Reftech Room" : "Growth cabinet"} />
          <FieldPair label="Research area" value={DISCIPLINE_META[req.discipline].label} />
          <FieldPair label="Species" value={req.species && req.species.length ? req.species.join(", ") : "—"} />
          {isPlant && <FieldPair label="Number of plants" value={req.numberOfPlants || "—"} />}
          {isPlant && <FieldPair label="Containment level" value={req.containmentLevel || "—"} />}
          <FieldPair label="Set temp / humidity" value={`${req.setTemp || "—"}°C / ${req.setHumidity || "—"}%`} />
          <FieldPair label="Light cycle" value={req.lightCycle || "—"} />
          {isPlant ? (
            <FieldPair label="Pest outbreak consent" value={req.pestConsent ? "Consented" : "Not given"} />
          ) : (
            <FieldPair label="Dimming required" value={req.dimmingRequired ? "Yes" : "No"} />
          )}
          <FieldPair label="Safety compliance" value={req.safetyCompliance ? "Confirmed" : "Not confirmed"} />
        </FieldGrid>
      </InfoBox>

      <InfoBox>
        <BoxLabel>Schedule</BoxLabel>
        <FieldGrid>
          <FieldPair label="Dates requested" value={`${fmtGB(req.startDate)} → ${fmtGB(req.endDate)}`} />
          <FieldPair label="Preferred floor" value={req.preferredFloor === "any" ? "No preference" : FLOOR_LABEL[req.preferredFloor]} />
          <FieldPair label="Submitted" value={fmtGB(req.submittedDate) || "—"} />
          {req.decidedDate && <FieldPair label="Decided" value={fmtGB(req.decidedDate)} />}
          {req.assignedUnitId && <FieldPair label="Assigned unit" value={req.assignedUnitId} />}
        </FieldGrid>
      </InfoBox>

      <div className="space-y-4">
        <div>
          <SectionLabel>Space required</SectionLabel>
          <p className="text-sm mt-2" style={{ color: "var(--ink-soft)" }}>{req.spaceDescription || "—"}</p>
        </div>
        <div>
          <SectionLabel>Purpose of project</SectionLabel>
          <p className="text-sm mt-2" style={{ color: "var(--ink-soft)" }}>{req.projectDesc || "—"}</p>
        </div>
        {req.notes && (
          <div>
            <SectionLabel>Additional notes</SectionLabel>
            <p className="text-sm mt-2" style={{ color: "var(--ink-soft)" }}>{req.notes}</p>
          </div>
        )}
        {req.hazardNotes && (
          <div className="flex items-start gap-2 rounded-lg p-3" style={{ background: "var(--warning-soft)" }}>
            <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" style={{ color: "var(--warning)" }} />
            <p className="text-xs" style={{ color: "var(--ink)" }}>{req.hazardNotes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* Full edit form for a requisition — mirrors the same section grouping as RequisitionDetailFields,
   but with editable inputs. Used from both the Requisitions page and the timeline preview panel. */
function RequisitionEditForm({ req, onSave, onCancel }) {
  const [form, setForm] = useState({ ...req });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));
  const setNum = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? "" : Number(e.target.value) }));
  const isPlant = form.discipline === "plant";

  return (
    <div className="space-y-4">
      <Field label="Project title"><input value={form.projectTitle} onChange={set("projectTitle")} className="gc-input font-semibold" /></Field>

      <InfoBox>
        <BoxLabel>Requester</BoxLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input value={form.researcher} onChange={set("researcher")} className="gc-input" /></Field>
          <Field label="Role"><select value={form.role || ROLES[0]} onChange={set("role")} className="gc-input">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="Email"><input value={form.email} onChange={set("email")} className="gc-input" /></Field>
          <Field label="Emergency number"><input value={form.emergencyNumber || ""} onChange={set("emergencyNumber")} className="gc-input" /></Field>
          <Field label="Lab group"><select value={form.labGroup} onChange={set("labGroup")} className="gc-input">{LAB_GROUPS.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="PI / supervisor"><input value={form.pi || ""} onChange={set("pi")} className="gc-input" /></Field>
        </div>
      </InfoBox>

      <InfoBox>
        <BoxLabel>Space &amp; Environment</BoxLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Space type">
            <select value={form.unitType} onChange={set("unitType")} className="gc-input">
              <option value="cabinet">Growth cabinet</option>
              <option value="reftech">Reftech Room</option>
            </select>
          </Field>
          <Field label="Research area">
            <select value={form.discipline} onChange={set("discipline")} className="gc-input">
              <option value="plant">Plant Sciences</option>
              <option value="insect">Insect Sciences</option>
            </select>
          </Field>
          <Field label="Species (comma-separated)">
            <input
              value={(form.species || []).join(", ")}
              onChange={(e) => setForm((f) => ({ ...f, species: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
              className="gc-input"
            />
          </Field>
          {isPlant && <Field label="Number of plants"><input type="number" min={0} value={form.numberOfPlants || ""} onChange={setNum("numberOfPlants")} className="gc-input" /></Field>}
          {isPlant && <Field label="Containment level"><select value={form.containmentLevel || CONTAINMENT_LEVELS[0]} onChange={set("containmentLevel")} className="gc-input">{CONTAINMENT_LEVELS.map((c) => <option key={c}>{c}</option>)}</select></Field>}
          <Field label="Set temp (°C)"><input type="number" value={form.setTemp || ""} onChange={setNum("setTemp")} className="gc-input" /></Field>
          <Field label="Set humidity (%)"><input type="number" value={form.setHumidity || ""} onChange={setNum("setHumidity")} className="gc-input" /></Field>
          <Field label="Light cycle"><select value={form.lightCycle || LIGHT_CYCLES[0]} onChange={set("lightCycle")} className="gc-input">{LIGHT_CYCLES.map((l) => <option key={l}>{l}</option>)}</select></Field>
          {isPlant ? (
            <Field label="Pest outbreak consent"><label className="flex items-center gap-2 text-sm mt-2.5"><input type="checkbox" checked={!!form.pestConsent} onChange={setBool("pestConsent")} /> Consented</label></Field>
          ) : (
            <Field label="Dimming required"><label className="flex items-center gap-2 text-sm mt-2.5"><input type="checkbox" checked={!!form.dimmingRequired} onChange={setBool("dimmingRequired")} /> Required</label></Field>
          )}
          <Field label="Safety compliance"><label className="flex items-center gap-2 text-sm mt-2.5"><input type="checkbox" checked={!!form.safetyCompliance} onChange={setBool("safetyCompliance")} /> Confirmed</label></Field>
        </div>
      </InfoBox>

      <InfoBox>
        <BoxLabel>Schedule</BoxLabel>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date"><input type="date" value={form.startDate} onChange={set("startDate")} className="gc-input" /></Field>
          <Field label="End date"><input type="date" value={form.endDate} onChange={set("endDate")} className="gc-input" /></Field>
          <Field label="Preferred floor">
            <select value={form.preferredFloor} onChange={set("preferredFloor")} className="gc-input">
              <option value="any">No preference</option>
              {FLOORS.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f]}</option>)}
            </select>
          </Field>
        </div>
      </InfoBox>

      <Field label="Space required"><textarea value={form.spaceDescription || ""} onChange={set("spaceDescription")} rows={2} className="gc-input" /></Field>
      <Field label="Purpose of project"><textarea value={form.projectDesc || ""} onChange={set("projectDesc")} rows={3} className="gc-input" /></Field>
      <Field label="Additional notes"><textarea value={form.notes || ""} onChange={set("notes")} rows={2} className="gc-input" /></Field>

      <div className="flex gap-2 pt-1">
        <button onClick={() => onSave(form)} className="flex items-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl text-white" style={{ background: "var(--accent-dark)" }}>
          <Save size={14} /> Save changes
        </button>
        <button onClick={onCancel} className="text-sm font-semibold px-4 py-2.5 rounded-xl" style={{ color: "var(--ink-soft)" }}>Cancel</button>
      </div>
    </div>
  );
}

function RequisitionCard({ req, index, units, onDecide, onEdit, onComplete, startExpanded = false }) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [editing, setEditing] = useState(false);
  const [chosenUnit, setChosenUnit] = useState("");
  // Any unit that matches type & discipline and is available across the *requested* date window —
  // not just units that happen to be free right now.
  const windowCandidates = units.filter((u) =>
    u.type === req.unitType
    && (u.type === "reftech" || u.discipline === req.discipline)
    && unitAvailableForWindow(u, req.startDate, req.endDate)
  );
  const STATUS_STYLE = {
    pending: { label: "Pending review", color: "var(--warning)", soft: "var(--warning-soft)" },
    approved: { label: "Ongoing", color: "var(--occupied)", soft: "var(--occupied-soft)" },
    completed: { label: "Completed", color: "var(--free)", soft: "var(--free-soft)" },
    declined: { label: "Declined", color: "var(--overdue)", soft: "var(--overdue-soft)" },
  };
  const statusColor = STATUS_STYLE[req.status].color;
  const statusSoft = STATUS_STYLE[req.status].soft;
  const labIdx = LAB_GROUPS.indexOf(req.labGroup);
  const avatarColor = labIdx !== -1 ? OKABE_ITO[labIdx] : "var(--ink-faint)";
  const avatarText = labIdx !== -1 ? OKABE_ITO_TEXT[labIdx] : "#fff";
  const initials = req.researcher.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const overdueForCompletion = req.status === "approved" && new Date(req.endDate) < TODAY;

  const saveEdit = (updated) => { onEdit(index, updated); setEditing(false); };

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: req.status === "pending" ? "1.5px solid var(--warning)" : "1px solid var(--border)", background: "var(--surface)" }}
    >
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center gap-3.5 p-4 text-left">
        <span className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-extrabold flex-shrink-0" style={{ background: avatarColor, color: avatarText }}>
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{req.researcher}</div>
          <div className="text-xs mt-0.5 truncate" style={{ color: "var(--ink-faint)" }}>{req.projectTitle} · {piDisplay(req.labGroup)}</div>
        </div>
        <div className="hidden sm:block text-xs font-semibold text-right flex-shrink-0" style={{ color: "var(--ink-faint)" }}>
          {fmtGB(req.startDate)} → {fmtGB(req.endDate)}
        </div>
        <span className="text-xs font-bold rounded-full px-2.5 py-1 flex-shrink-0" style={{ background: statusSoft, color: statusColor }}>
          {STATUS_STYLE[req.status].label}{overdueForCompletion ? " · past end date" : ""}
        </span>
        <ChevronDown size={16} style={{ color: "var(--ink-faint)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          {editing ? (
            <RequisitionEditForm req={req} onSave={saveEdit} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <div className="flex justify-end -mb-1">
                <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--accent-dark)" }}>
                  <Pencil size={12} /> Edit details
                </button>
              </div>
              <RequisitionDetailFields req={req} />

              {req.status === "pending" && (
                <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--surface-soft)" }}>
                  <div className="text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>Assign a unit to approve</div>
                  <p className="text-[11px] -mt-1.5" style={{ color: "var(--ink-faint)" }}>
                    Includes units free for the whole requested window ({fmtGB(req.startDate)} → {fmtGB(req.endDate)}), even if they're occupied by something else today.
                  </p>
                  <select value={chosenUnit} onChange={(e) => setChosenUnit(e.target.value)} className="gc-input">
                    <option value="">Select an available unit…</option>
                    {windowCandidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.id} — {FLOOR_LABEL[u.floor]}, {u.room}{displayStatus(u).key !== "free" ? " (free by requested start date)" : ""}
                      </option>
                    ))}
                  </select>
                  {windowCandidates.length === 0 && <p className="text-xs" style={{ color: "var(--overdue)" }}>No units match this request's type & discipline for the requested dates.</p>}
                  <div className="flex gap-2 pt-1">
                    <button disabled={!chosenUnit} onClick={() => onDecide(index, "approved", chosenUnit)} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: "var(--free)" }}>
                      <CheckCircle2 size={14} /> Approve & assign
                    </button>
                    <button onClick={() => onDecide(index, "declined")} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: "var(--overdue)", color: "var(--overdue)" }}>
                      <XCircle size={14} /> Decline
                    </button>
                  </div>
                </div>
              )}

              {req.status === "approved" && (
                <div className="rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--surface-soft)" }}>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>
                      {overdueForCompletion ? "Past its end date — still shown as active until you confirm it's finished." : "Still ongoing, assigned to " + (req.assignedUnitId || "a unit") + "."}
                    </div>
                  </div>
                  <button onClick={() => onComplete(index)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg text-white flex-shrink-0" style={{ background: "var(--accent-dark)" }}>
                    <CheckCircle2 size={13} /> Mark as completed
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Slide-over panel shown when clicking a bar on the dashboard timeline — lets the admin see the
   full requisition without leaving the dashboard, with an option to jump to the full Requisitions page. */
function RequisitionPreviewPanel({ req, index, units, onDecide, onEdit, onComplete, onClose, onOpenFull }) {
  const [chosenUnit, setChosenUnit] = useState("");
  const [editing, setEditing] = useState(false);
  if (!req) return null;
  const STATUS_STYLE = {
    pending: { label: "Pending review", color: "var(--warning)", soft: "var(--warning-soft)" },
    approved: { label: "Ongoing", color: "var(--occupied)", soft: "var(--occupied-soft)" },
    completed: { label: "Completed", color: "var(--free)", soft: "var(--free-soft)" },
    declined: { label: "Declined", color: "var(--overdue)", soft: "var(--overdue-soft)" },
  };
  const statusColor = STATUS_STYLE[req.status].color;
  const statusSoft = STATUS_STYLE[req.status].soft;
  const windowCandidates = units.filter((u) =>
    u.type === req.unitType && (u.type === "reftech" || u.discipline === req.discipline) && unitAvailableForWindow(u, req.startDate, req.endDate)
  );
  const saveEdit = (updated) => { onEdit(index, updated); setEditing(false); };

  return (
    <div
      className="flex items-center justify-center p-6"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, background: "rgba(22,33,29,0.4)" }}
      onClick={onClose}
    >
      <div
        className="gc-scroll rounded-3xl shadow-2xl"
        style={{ background: "var(--surface)", width: "100%", maxWidth: 820, maxHeight: "82vh", overflowY: "auto", boxSizing: "border-box" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-7 py-5" style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--ink-faint)" }}>Requisition</div>
            <h1 className="gc-display text-2xl font-extrabold leading-none truncate">{req.researcher}</h1>
            <p className="text-[13px] mt-1 truncate" style={{ color: "var(--ink-soft)" }}>{req.projectTitle}</p>
            <span className="inline-block mt-2 text-xs font-bold rounded-full px-2.5 py-1" style={{ background: statusSoft, color: statusColor }}>
              {STATUS_STYLE[req.status].label}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!editing && (
              <button onClick={() => setEditing(true)} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--surface-soft)" }} title="Edit"><Pencil size={15} /></button>
            )}
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--surface-soft)" }} title="Close"><X size={16} /></button>
          </div>
        </div>

        <div className="px-7 py-6 space-y-4">
          {editing ? (
            <RequisitionEditForm req={req} onSave={saveEdit} onCancel={() => setEditing(false)} />
          ) : (
            <>
              <RequisitionDetailFields req={req} />

              {req.status === "pending" && (
                <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--surface-soft)" }}>
                  <div className="text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>Assign a unit to approve</div>
                  <select value={chosenUnit} onChange={(e) => setChosenUnit(e.target.value)} className="gc-input">
                    <option value="">Select an available unit…</option>
                    {windowCandidates.map((u) => <option key={u.id} value={u.id}>{u.id} — {FLOOR_LABEL[u.floor]}, {u.room}</option>)}
                  </select>
                  <div className="flex gap-2 pt-1">
                    <button disabled={!chosenUnit} onClick={() => { onDecide(index, "approved", chosenUnit); onClose(); }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{ background: "var(--free)" }}>
                      <CheckCircle2 size={14} /> Approve & assign
                    </button>
                    <button onClick={() => { onDecide(index, "declined"); onClose(); }} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: "var(--overdue)", color: "var(--overdue)" }}>
                      <XCircle size={14} /> Decline
                    </button>
                  </div>
                </div>
              )}

              {req.status === "approved" && (
                <div className="rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: "var(--surface-soft)" }}>
                  <div className="text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>Still ongoing, assigned to {req.assignedUnitId || "a unit"}.</div>
                  <button onClick={() => { onComplete(index); onClose(); }} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg text-white flex-shrink-0" style={{ background: "var(--accent-dark)" }}>
                    <CheckCircle2 size={13} /> Mark as completed
                  </button>
                </div>
              )}

              <button onClick={onOpenFull} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface-soft)", color: "var(--accent-dark)" }}>
                Open in Requisitions page <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RequisitionsPage({ requests, units, onDecide, onEdit, onComplete, initialTab = "pending", initialExpandIndex = null, returnUnitId = null, onBackToUnit }) {
  const [tab, setTab] = useState(initialTab);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | "cabinet" | "reftech"

  const byType = ({ r }) => typeFilter === "all" || r.unitType === typeFilter;
  const withIdx = requests.map((r, i) => ({ r, i }));

  // Active = still needs attention or is still ongoing. A requisition only leaves Active once an
  // admin manually marks it completed — passing its end date does not move it on its own.
  const awaitingReview = withIdx.filter(({ r }) => r.status === "pending").filter(byType)
    .sort((a, b) => new Date(a.r.submittedDate || 0) - new Date(b.r.submittedDate || 0)); // longest-waiting first
  const ongoing = withIdx.filter(({ r }) => r.status === "approved").filter(byType)
    .sort((a, b) => new Date(b.r.decidedDate || 0) - new Date(a.r.decidedDate || 0)); // most recently approved first
  const activeCount = awaitingReview.length + ongoing.length;

  const historic = withIdx.filter(({ r }) => r.status === "completed" || r.status === "declined").filter(byType);
  const filteredHistoric = historic
    .filter(({ r }) => historyFilter === "all" || r.status === historyFilter)
    .sort((a, b) => new Date(b.r.decidedDate || 0) - new Date(a.r.decidedDate || 0)); // most recently approved/declined first

  const cabinetCount = requests.filter((r) => r.unitType === "cabinet").length;
  const reftechCount = requests.filter((r) => r.unitType === "reftech").length;

  return (
    <div>
      {returnUnitId && (
        <button
          onClick={onBackToUnit}
          className="flex items-center gap-1.5 text-sm font-semibold mb-4 px-3 py-1.5 rounded-full border"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--accent-ink)" }}
        >
          <ChevronLeft size={14} /> Back to {returnUnitId} in inventory
        </button>
      )}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="gc-display text-2xl font-extrabold">Requisitions</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-faint)" }}>{requests.length} requests submitted via the request-space form</p>
        </div>
        <div className="flex items-center rounded-xl border p-1" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <button onClick={() => setTab("pending")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: tab === "pending" ? "var(--sidebar-bg)" : "transparent", color: tab === "pending" ? "#fff" : "var(--ink-soft)" }}>
            <Clock size={14} /> Active {activeCount > 0 && <span className="text-[10px] font-bold">({activeCount})</span>}
          </button>
          <button onClick={() => setTab("completed")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: tab === "completed" ? "var(--sidebar-bg)" : "transparent", color: tab === "completed" ? "#fff" : "var(--ink-soft)" }}>
            <History size={14} /> Completed
          </button>
        </div>
      </div>

      {/* space-type filter — applies to both Active and Completed */}
      <div className="inline-flex items-center p-1 rounded-xl mb-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {[
          { key: "all", label: "All", count: requests.length },
          { key: "cabinet", label: "Growth Cabinets", count: cabinetCount },
          { key: "reftech", label: "Reftech Rooms", count: reftechCount },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTypeFilter(t.key)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: typeFilter === t.key ? "var(--sidebar-bg)" : "transparent", color: typeFilter === t.key ? "#fff" : "var(--ink-soft)" }}
          >
            {t.label}
            <span className="text-[10.5px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: typeFilter === t.key ? "rgba(255,255,255,0.15)" : "var(--surface-soft)", color: typeFilter === t.key ? "#fff" : "var(--ink-faint)" }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "pending" && (
        <div className="space-y-6">
          <section>
            <SectionLabel>Pending review ({awaitingReview.length})</SectionLabel>
            <div className="space-y-3 mt-3">
              {awaitingReview.map(({ r, i }) => (
                <RequisitionCard key={i} req={r} index={i} units={units} onDecide={onDecide} onEdit={onEdit} onComplete={onComplete} startExpanded={i === initialExpandIndex} />
              ))}
              {awaitingReview.length === 0 && <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Nothing waiting on a decision right now.</p>}
            </div>
          </section>

          <section>
            <SectionLabel>Ongoing ({ongoing.length})</SectionLabel>
            <div className="space-y-3 mt-3">
              {ongoing.map(({ r, i }) => (
                <RequisitionCard key={i} req={r} index={i} units={units} onDecide={onDecide} onEdit={onEdit} onComplete={onComplete} startExpanded={i === initialExpandIndex} />
              ))}
              {ongoing.length === 0 && <p className="text-sm" style={{ color: "var(--ink-faint)" }}>No approved requisitions currently in progress.</p>}
            </div>
          </section>

          {activeCount === 0 && (
            <div className="text-center py-12" style={{ color: "var(--ink-soft)" }}>
              <CheckCircle2 size={26} className="mx-auto mb-2" style={{ color: "var(--free)" }} />
              <p className="text-sm">Nothing active — every requisition has been reviewed and wrapped up.</p>
            </div>
          )}
        </div>
      )}

      {tab === "completed" && (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[{ key: "all", label: "All historic" }, { key: "completed", label: "Completed" }, { key: "declined", label: "Declined" }].map((c) => (
              <button key={c.key} onClick={() => setHistoryFilter(c.key)} className="px-3 py-1.5 rounded-full text-xs font-medium border" style={{ borderColor: historyFilter === c.key ? "var(--accent)" : "var(--border)", background: historyFilter === c.key ? "var(--accent)" : "var(--surface)", color: historyFilter === c.key ? "white" : "var(--ink-soft)" }}>
                {c.label}
              </button>
            ))}
            <span className="text-xs font-semibold ml-auto" style={{ color: "var(--ink-faint)" }}>{filteredHistoric.length} of {historic.length} · sorted by when closed out</span>
          </div>
          <div className="space-y-3">
            {filteredHistoric.map(({ r, i }) => (
              <RequisitionCard key={i} req={r} index={i} units={units} onDecide={onDecide} onEdit={onEdit} onComplete={onComplete} startExpanded={i === initialExpandIndex} />
            ))}
            {filteredHistoric.length === 0 && (
              <div className="text-center py-16" style={{ color: "var(--ink-faint)" }}>
                <History size={28} className="mx-auto mb-2" />
                <p className="text-sm">No historic requisitions here yet.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Request space — guided wizard                                          */
/* ---------------------------------------------------------------------- */
function WizardChoice({ icon: Icon, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} className="gc-clickable w-full flex items-center gap-4 p-5 rounded-2xl border text-left" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
        <Icon size={22} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">{title}</div>
        {subtitle && <div className="text-sm mt-0.5" style={{ color: "var(--ink-soft)" }}>{subtitle}</div>}
      </div>
      <ChevronRight size={18} style={{ color: "var(--ink-faint)" }} className="flex-shrink-0" />
    </button>
  );
}

function WizardShell({ step, totalSteps, onBack, title, subtitle, children }) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        {step > 0 && (
          <button onClick={onBack} className="p-2 rounded-full border flex-shrink-0" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <ChevronLeft size={16} />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span key={i} className="rounded-full" style={{ width: i === step ? 20 : 6, height: 6, background: i <= step ? "var(--accent)" : "var(--border)", transition: "width 0.15s" }} />
          ))}
        </div>
      </div>
      <h2 className="gc-display text-2xl font-extrabold mb-1">{title}</h2>
      {subtitle && <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

const WIZARD_STEPS_NEW = ["mode", "spaceType", "discipline", "form"];
const WIZARD_STEPS_AMEND = ["mode", "spaceType", "discipline", "pickExisting", "form"];

/* Small components used only by the discipline-specific request forms */
function SliderField({ label, value, onChange, min, max, unit }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--ink-soft)" }}>{label}</span>
        <span className="text-sm font-bold gc-mono">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={onChange} className="w-full" style={{ accentColor: "var(--accent)" }} />
    </div>
  );
}
function SpeciesPicker({ species, onChange, options }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const addSpecies = (val) => { if (!val || species.includes(val)) return; onChange([...species, val]); };
  const removeSpecies = (val) => onChange(species.filter((s) => s !== val));
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className="gc-input flex-1" value="" onChange={(e) => addSpecies(e.target.value)}>
          <option value="">— Add a species —</option>
          {options.filter((o) => !species.includes(o)).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" onClick={() => setCustomOpen((v) => !v)} className="w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0" style={{ borderColor: "var(--border)", background: "var(--surface)" }} title="Add a custom species">
          <PlusCircle size={16} style={{ color: "var(--accent-ink)" }} />
        </button>
      </div>
      {customOpen && (
        <div className="flex gap-2">
          <input className="gc-input flex-1" placeholder="Custom species name" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
          <button type="button" onClick={() => { addSpecies(customValue.trim()); setCustomValue(""); setCustomOpen(false); }} className="px-3 rounded-xl text-sm font-semibold text-white flex-shrink-0" style={{ background: "var(--gradient)" }}>Add</button>
        </div>
      )}
      {species.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {species.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium pl-2.5 pr-1.5 py-1" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
              {s}
              <button type="button" onClick={() => removeSpecies(s)} className="rounded-full p-0.5 hover:bg-black/10"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
/* Form section heading styled to match the reference requisition forms */
function FormSectionTitle({ children }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-wider pb-2 border-b" style={{ color: "var(--ink-faint)", borderColor: "var(--border)" }}>
      {children}
    </h3>
  );
}

function RequestSpacePage({ onSubmit, onAmend, requests, allowAmend = true }) {
  const [mode, setMode] = useState(null); // 'new' | 'amend'
  const [spaceType, setSpaceType] = useState(null); // 'cabinet' | 'reftech'
  const [discipline, setDiscipline] = useState(null); // 'plant' | 'insect'
  const [amendIndex, setAmendIndex] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  const steps = mode === "amend" ? WIZARD_STEPS_AMEND : WIZARD_STEPS_NEW;
  const stepName = steps[stepIndex];

  const emptyForm = {
    researcher: "", email: "", phone: "", pi: "", department: "",
    labGroup: LAB_GROUPS[0], role: ROLES[0], emergencyNumber: "",
    species: [], numberOfPlants: "", containmentLevel: CONTAINMENT_LEVELS[0], spaceDescription: "",
    projectTitle: "", projectDesc: "",
    setTemp: 22, setHumidity: 60, lightCycle: LIGHT_CYCLES[0], co2: "",
    pestConsent: false, dimmingRequired: false, safetyCompliance: false,
    preferredFloor: "any", startDate: "", endDate: "",
    hazardNotes: "", notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNum = (k) => (e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));
  const setBool = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  const goBack = () => setStepIndex((i) => Math.max(0, i - 1));
  const goNext = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1));

  const amendCandidates = requests
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status !== "declined" && r.status !== "completed" && r.unitType === spaceType && r.discipline === discipline);

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <CheckCircle2 size={40} style={{ color: "var(--free)" }} className="mx-auto mb-4" />
        <h2 className="gc-display text-2xl font-extrabold mb-2">{mode === "amend" ? "Amendment submitted" : "Request submitted"}</h2>
        <p className="text-sm mb-6" style={{ color: "var(--ink-soft)" }}>
          {mode === "amend"
            ? "The facilities team will review your changes and confirm shortly."
            : "It's now in the requisitions queue for the facilities team to review and assign a unit. You'll get a confirmation once it's approved."}
        </p>
        <button
          onClick={() => { setMode(null); setSpaceType(null); setDiscipline(null); setAmendIndex(null); setStepIndex(0); setForm(emptyForm); setSubmitted(false); }}
          className="px-5 py-2.5 rounded-xl font-semibold text-white" style={{ background: "var(--gradient)" }}
        >
          Start another request
        </button>
      </div>
    );
  }

  if (stepName === "mode") {
    return (
      <WizardShell step={0} totalSteps={steps.length} title="What would you like to do?" subtitle="Let's get you to the right form.">
        <WizardChoice icon={PlusCircle} title="Submit a new requisition" subtitle="Request space in a growth cabinet or Reftech Room" onClick={() => { setMode("new"); goNext(); }} />
        {allowAmend && (
          <WizardChoice icon={Pencil} title="Amend an existing requisition" subtitle="Change the dates or details on a request you've already submitted" onClick={() => { setMode("amend"); goNext(); }} />
        )}
      </WizardShell>
    );
  }

  if (stepName === "spaceType") {
    return (
      <WizardShell step={1} totalSteps={steps.length} onBack={goBack} title="Where would you like to request space?" subtitle="Choose the kind of environment your work needs.">
        <WizardChoice icon={Leaf} title="Growth Cabinet" subtitle="A single-occupant controlled cabinet" onClick={() => { setSpaceType("cabinet"); goNext(); }} />
        <WizardChoice icon={DoorOpen} title="Reftech Room" subtitle="A shared controlled-environment room, bookable by slot" onClick={() => { setSpaceType("reftech"); goNext(); }} />
      </WizardShell>
    );
  }

  if (stepName === "discipline") {
    return (
      <WizardShell step={2} totalSteps={steps.length} onBack={goBack} title="Which research area is this for?" subtitle="This helps us route your request to the right reviewer, and shows you the right form.">
        <WizardChoice
          icon={Leaf} title="Plant Sciences"
          onClick={() => { setDiscipline("plant"); setForm((f) => ({ ...f, setTemp: 22, setHumidity: 60, lightCycle: LIGHT_CYCLES[0] })); goNext(); }}
        />
        <WizardChoice
          icon={Bug} title="Insect Sciences"
          onClick={() => { setDiscipline("insect"); setForm((f) => ({ ...f, setTemp: 25, setHumidity: 65, lightCycle: LIGHT_CYCLES[0] })); goNext(); }}
        />
      </WizardShell>
    );
  }

  if (stepName === "pickExisting") {
    return (
      <WizardShell step={3} totalSteps={steps.length} onBack={goBack} title="Which requisition would you like to amend?" subtitle="Choose from your requests that match the Growth Cabinet / Reftech Room and research area chosen above.">
        {amendCandidates.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: "var(--ink-faint)" }}>No matching requisitions found. Go back and check your selections, or submit a new requisition instead.</p>
        ) : (
          <>
            <Field label="Your requisition">
              <select
                className="gc-input"
                defaultValue=""
                onChange={(e) => {
                  const i = e.target.value === "" ? null : Number(e.target.value);
                  setAmendIndex(i);
                }}
              >
                <option value="" disabled>Select a requisition…</option>
                {amendCandidates.map(({ r, i }) => (
                  <option key={i} value={i}>
                    {r.projectTitle} — {r.researcher} · {r.status === "approved" ? "Approved" : "Pending review"}
                  </option>
                ))}
              </select>
            </Field>
            <button
              disabled={amendIndex === null}
              onClick={() => {
                const r = requests[amendIndex];
                setForm({
                  researcher: r.researcher, email: r.email, phone: r.phone || "", pi: r.pi || "", department: r.department || "",
                  labGroup: r.labGroup, role: r.role || ROLES[0], emergencyNumber: r.emergencyNumber || "",
                  species: r.species || [], numberOfPlants: r.numberOfPlants || "", containmentLevel: r.containmentLevel || CONTAINMENT_LEVELS[0],
                  spaceDescription: r.spaceDescription || "",
                  projectTitle: r.projectTitle, projectDesc: r.projectDesc || "",
                  setTemp: r.setTemp || (discipline === "insect" ? 25 : 22), setHumidity: r.setHumidity || (discipline === "insect" ? 65 : 60),
                  lightCycle: r.lightCycle || LIGHT_CYCLES[0], co2: r.co2 || "",
                  pestConsent: r.pestConsent || false, dimmingRequired: r.dimmingRequired || false,
                  safetyCompliance: r.safetyCompliance || false,
                  preferredFloor: r.preferredFloor || "any", startDate: r.startDate, endDate: r.endDate,
                  hazardNotes: r.hazardNotes || "", notes: r.notes || "",
                });
                goNext();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--gradient)" }}
            >
              Continue <ChevronRight size={16} />
            </button>
          </>
        )}
      </WizardShell>
    );
  }

  // stepName === "form"
  const isPlant = discipline === "plant";
  const submitColor = isPlant ? "var(--free)" : "var(--gradient)";

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={goBack} className="flex items-center gap-1.5 text-sm font-medium mb-4" style={{ color: "var(--ink-soft)" }}>
        <ChevronLeft size={16} /> Back
      </button>

      <div className="mb-2">
        <h2 className="gc-display text-2xl font-extrabold">{isPlant ? "Plant Sciences Requisition" : "Insects Requisition"}</h2>
        <p className="text-sm mt-1" style={{ color: "var(--ink-faint)" }}>
          {mode === "amend" ? "Amend requisition" : "New requisition"} · {spaceType === "reftech" ? "Reftech Room" : "Growth Cabinet"}
        </p>
      </div>
      <div className="flex gap-1.5 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="h-1 flex-1 rounded-full" style={{ background: "var(--free)" }} />
        ))}
      </div>

      <form
        className="gc-card p-6 space-y-7"
        onSubmit={(e) => {
          e.preventDefault();
          const payload = { ...form, unitType: spaceType, discipline, status: "pending", submittedDate: fmt(TODAY) };
          if (mode === "amend" && amendIndex !== null) onAmend(amendIndex, payload);
          else onSubmit(payload);
          setSubmitted(true);
        }}
      >
        <section className="space-y-4">
          <FormSectionTitle>Researcher Details</FormSectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name *"><input required value={form.researcher} onChange={set("researcher")} className="gc-input" placeholder="Alejandro Reyes" /></Field>
            <Field label="Role">
              <select value={form.role} onChange={set("role")} className="gc-input">{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PI"><input value={form.pi} onChange={set("pi")} className="gc-input" placeholder="Optional, if different from you" /></Field>
            <Field label="Emergency Number *"><input required value={form.emergencyNumber} onChange={set("emergencyNumber")} className="gc-input" placeholder="Mobile number" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email"><input required type="email" value={form.email} onChange={set("email")} className="gc-input" placeholder="a.reyes@university.ac.uk" /></Field>
            <Field label="Lab group">
              <select value={form.labGroup} onChange={set("labGroup")} className="gc-input">{LAB_GROUPS.map((l) => <option key={l}>{l}</option>)}</select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <FormSectionTitle>Experiment Details</FormSectionTitle>
          <Field label="Project title *"><input required value={form.projectTitle} onChange={set("projectTitle")} className="gc-input" placeholder="Arabidopsis salt-stress trial" /></Field>
          <Field label="Species *">
            <SpeciesPicker species={form.species} onChange={(sp) => setForm((f) => ({ ...f, species: sp }))} options={isPlant ? PLANT_SPECIES : INSECT_SPECIES} />
          </Field>

          {isPlant && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Number of Plants"><input type="number" min={0} value={form.numberOfPlants} onChange={set("numberOfPlants")} className="gc-input" /></Field>
              <Field label="Containment Level">
                <select value={form.containmentLevel} onChange={set("containmentLevel")} className="gc-input">{CONTAINMENT_LEVELS.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
            </div>
          )}

          <Field label="Describe Space Required">
            <textarea
              value={form.spaceDescription} onChange={set("spaceDescription")} className="gc-input" rows={2}
              placeholder={isPlant ? "e.g. 2 shelves in a growth cabinet" : "e.g. Full cabinet, insect-safe containment needed"}
            />
          </Field>
          <Field label="Purpose of Project">
            <textarea value={form.projectDesc} onChange={set("projectDesc")} className="gc-input" rows={3} />
          </Field>

          <div className="rounded-2xl p-4" style={{ background: "var(--warning-soft)", border: "1px solid var(--warning)" }}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert size={15} style={{ color: "var(--warning)" }} />
              <span className="text-sm font-bold" style={{ color: "var(--accent-ink)" }}>Safety Compliance</span>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={form.safetyCompliance} onChange={setBool("safetyCompliance")} />
              <span>
                All relevant safety information is in place (risk assessments, SOPs{isPlant ? "" : ", containment protocols"}, etc.)
              </span>
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <FormSectionTitle>{isPlant ? "Growth Conditions" : "Conditions"}</FormSectionTitle>
          <div className="grid grid-cols-2 gap-5">
            <SliderField label="Temperature" value={form.setTemp} onChange={setNum("setTemp")} min={4} max={40} unit="°C" />
            <SliderField label="Humidity" value={form.setHumidity} onChange={setNum("setHumidity")} min={10} max={95} unit="%" />
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <Field label="Light Cycle">
              <select value={form.lightCycle} onChange={set("lightCycle")} className="gc-input">{LIGHT_CYCLES.map((l) => <option key={l}>{l}</option>)}</select>
            </Field>
            {isPlant ? (
              <div className="rounded-xl p-3" style={{ background: "var(--overdue-soft)", border: "1px solid var(--overdue)" }}>
                <div className="text-xs font-bold mb-1.5" style={{ color: "var(--overdue)" }}>Pest Outbreak Protocol</div>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={form.pestConsent} onChange={setBool("pestConsent")} />
                  <span>If required due to a pest outbreak, I consent to pesticides being sprayed</span>
                </label>
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm h-11">
                <input type="checkbox" checked={form.dimmingRequired} onChange={setBool("dimmingRequired")} /> Dimming required
              </label>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <FormSectionTitle>Scheduling</FormSectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date *"><input required type="date" value={form.startDate} onChange={set("startDate")} className="gc-input" /></Field>
            <Field label="End Date *"><input required type="date" value={form.endDate} onChange={set("endDate")} className="gc-input" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preferred Floor">
              <select value={form.preferredFloor} onChange={set("preferredFloor")} className="gc-input">
                <option value="any">Any</option>
                {FLOORS.map((f) => <option key={f} value={f}>{FLOOR_LABEL[f]}</option>)}
              </select>
            </Field>
            <Field label="Additional Notes"><textarea value={form.notes} onChange={set("notes")} className="gc-input" rows={1} placeholder="Special requirements…" /></Field>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl p-3.5 text-sm" style={{ background: "var(--occupied-soft)", color: "var(--ink)" }}>
            <ClipboardList size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--occupied)" }} />
            For specific programming requirements, please contact a facilities technician.
          </div>
        </section>

        <button type="submit" className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2" style={{ background: submitColor }}>
          {mode === "amend" ? "Resubmit Request" : "Submit Request"} <ArrowUpRight size={16} />
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App shell                                                              */
/* ---------------------------------------------------------------------- */
function LoadingScreen({ message = "Loading…", isError = false }) {
  return (
    <div className="gc-app min-h-screen flex items-center justify-center">
      <style>{TOKENS}</style>
      <p className="text-sm" style={{ color: isError ? "var(--overdue)" : "var(--ink-faint)" }}>{message}</p>
    </div>
  );
}

/* Minimal email/password sign-in — the temporary stand-in for Entra ID SSO
   until that's wired up for this org. Not styled beyond matching the
   existing gc-* utility classes. */
function AdminLoginForm({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else onDone();
  };

  return (
    <form onSubmit={submit} className="gc-card p-4 space-y-2.5" style={{ maxWidth: 320, marginLeft: "auto" }}>
      <div className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>Admin sign in</div>
      <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="gc-input" />
      <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="gc-input" />
      {error && <div className="text-xs" style={{ color: "var(--overdue)" }}>{error}</div>}
      <button type="submit" disabled={busy} className="text-xs font-bold px-3 py-2 rounded-lg text-white" style={{ background: "var(--accent-dark)" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function GrowthCabinetApp() {
  const { session, profile, authLoading } = useSession();
  const isAdmin = profile?.role === "admin";
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // appData is null until an admin session's data has loaded. Everything
  // the old mock generators produced now comes from src/lib/api.js instead.
  const [appData, setAppData] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const reload = async () => {
    try {
      const data = await api.fetchAdminData();
      setAppData(data);
      setLoadError(null);
    } catch (err) {
      console.error(err);
      setLoadError(err.message || String(err));
    }
  };

  useEffect(() => {
    if (isAdmin) reload();
    else setAppData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const [page, setPage] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  const [editingUnit, setEditingUnit] = useState(undefined); // undefined = closed, null = add-new, object = edit
  const [inventoryFilter, setInventoryFilter] = useState(null);
  const [inventoryKey, setInventoryKey] = useState(0);
  const [requisitionsTab, setRequisitionsTab] = useState("pending");
  const [requisitionsExpandIndex, setRequisitionsExpandIndex] = useState(null);
  const [requisitionsKey, setRequisitionsKey] = useState(0);
  const [returnUnitId, setReturnUnitId] = useState(null); // set when navigating to a requisition from a unit's drawer
  const [previewReqIndex, setPreviewReqIndex] = useState(null); // requisition shown in the timeline's preview side panel

  const units = appData ? appData.units : [];
  const requests = appData ? appData.requests : [];
  const categories = appData ? appData.categories : [];
  const categoryColors = appData ? appData.categoryColors : {};
  const categoryIdByName = appData ? appData.categoryIdByName : {};
  const labUsageHistory = appData ? appData.labUsageHistory : { labels: [], fullLabels: [], keys: [], series: {} };

  // Wraps a mutation so a failed Supabase call (RLS denial, constraint
  // violation, network error) surfaces to the admin instead of failing
  // silently — the old mock handlers never had a failure path to handle.
  const withErrorAlert = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      window.alert(err.message || "Something went wrong saving that — see the console for details.");
    }
  };

  const handleSaveUnit = withErrorAlert(async (data) => {
    await api.saveUnit(data);
    setEditingUnit(undefined);
    setSelected(null);
    await reload();
  });

  const handleUpdateServiceLog = withErrorAlert(async (unitId, log) => {
    const oldLog = (units.find((u) => u.id === unitId) || {}).serviceLog || [];
    await api.saveServiceLog(unitId, log, oldLog, categoryIdByName, session?.user?.id);
    await reload();
  });

  const handleAddDocument = withErrorAlert(async (unitId, file, name, type) => {
    await api.addUnitDocument(unitId, file, name, type, session?.user?.id);
    await reload();
  });
  const handleRemoveDocument = withErrorAlert(async (unitId, docId) => {
    await api.removeUnitDocument(docId);
    await reload();
  });
  const handleUpdatePhoto = withErrorAlert(async (unitId, file) => {
    await api.uploadUnitPhoto(unitId, file);
    await reload();
  });

  const handleAddCategory = withErrorAlert(async (name) => {
    await api.addMaintenanceCategory(name, categories.length);
    await reload();
  });
  const handleRemoveCategory = withErrorAlert(async (name) => {
    await api.removeMaintenanceCategory(name);
    await reload();
  });

  const handleEditRequisition = withErrorAlert(async (index, updates) => {
    // `updates` is already the full edited requisition (RequisitionEditForm's
    // local form state starts as a spread of the original), not a partial patch.
    await api.editRequisition(requests[index].id, updates);
    await reload();
  });

  const handleDecideRequisition = withErrorAlert(async (index, decision, unitId) => {
    await api.decideRequisition(requests[index], decision, unitId, session?.user?.id);
    await reload();
  });

  /* Admin manually confirms an ongoing (approved) requisition has finished. This closes the
     requisition out to "completed" — the booking row is kept as history, not deleted, and simply
     stops counting as active occupancy because fetchAdminData only pulls bookings whose requisition
     is still 'approved'. */
  const handleCompleteRequisition = withErrorAlert(async (index) => {
    await api.completeRequisition(requests[index].id, session?.user?.id);
    await reload();
  });

  const handleAmendRequisition = withErrorAlert(async (index, payload) => {
    await api.amendRequisition(requests[index].id, payload);
    await reload();
  });

  const handleSubmitRequisition = withErrorAlert(async (payload) => {
    await api.submitRequisition(payload, session ? session.user.id : null);
    if (isAdmin) await reload();
  });

  const goInventory = (filter) => {
    setInventoryFilter(filter || {});
    setInventoryKey((k) => k + 1);
    setPage("inventory");
  };
  // Navigate to the requisitions page. If called from within a unit's drawer (onOpenRequisition),
  // we remember which unit we came from so the requisitions page can offer a way back.
  const goRequisitions = (tab = "pending", expandIndex = null, fromUnitId = null) => {
    setRequisitionsTab(tab);
    setRequisitionsExpandIndex(expandIndex);
    setRequisitionsKey((k) => k + 1);
    setReturnUnitId(fromUnitId);
    setSelected(null);
    setPage("requisitions");
  };
  // Used by the unit drawer's booking cards — closes the drawer, jumps to the requisition, and
  // remembers the unit so "Back to inventory" can reopen it.
  const openRequisitionFromUnit = (tab, index) => goRequisitions(tab, index, selected ? selected.id : null);

  const backToInventoryUnit = () => {
    const unit = units.find((u) => u.id === returnUnitId);
    setReturnUnitId(null);
    goInventory({});
    if (unit) setSelected(unit);
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (authLoading) return <LoadingScreen />;

  // Non-admin — including signed out — only ever sees the request form.
  // This matches the real end-state design for researchers once Entra ID
  // SSO is live (see supabase/schema.sql's design notes and CLAUDE.md): the
  // request-submission INSERT works anonymously today via a temporary RLS
  // policy, everything else requires being an admin.
  if (!isAdmin) {
    return (
      <div className="gc-app min-h-screen">
        <style>{TOKENS}</style>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <div className="max-w-2xl mx-auto p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--gradient)" }}>
                <Leaf size={15} color="#fff" />
              </div>
              <span className="gc-display font-extrabold text-[14px]">Growth Space Admin</span>
            </div>
            {session ? (
              <button onClick={() => supabase.auth.signOut()} className="text-xs font-semibold underline" style={{ color: "var(--ink-faint)" }}>Sign out</button>
            ) : showAdminLogin ? (
              <button onClick={() => setShowAdminLogin(false)} className="text-xs font-semibold underline" style={{ color: "var(--ink-faint)" }}>Cancel</button>
            ) : (
              <button onClick={() => setShowAdminLogin(true)} className="text-xs font-semibold underline" style={{ color: "var(--ink-faint)" }}>Admin sign in</button>
            )}
          </div>
          {!session && showAdminLogin && (
            <div className="mb-4 flex justify-end">
              <AdminLoginForm onDone={() => setShowAdminLogin(false)} />
            </div>
          )}
          <RequestSpacePage requests={requests} onSubmit={handleSubmitRequisition} onAmend={handleAmendRequisition} allowAmend={!!session} />
        </div>
      </div>
    );
  }

  if (!appData) {
    return loadError ? <LoadingScreen message={`Couldn't load data: ${loadError}`} isError /> : <LoadingScreen />;
  }

  return (
    <div className="gc-app min-h-screen flex">
      <style>{TOKENS}</style>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <Sidebar page={page} setPage={setPage} pendingCount={pendingCount} />

      <main className="flex-1 p-8 max-w-[1400px]">
        {page === "dashboard" && (
          <DashboardPage units={units} requests={requests} goInventory={goInventory} goRequisitions={goRequisitions} onSelectUnit={setSelected} onPreviewRequisition={setPreviewReqIndex} labUsageHistory={labUsageHistory} />
        )}
        {page === "inventory" && (
          <InventoryPage key={inventoryKey} units={units} onSelect={setSelected} onAddNew={() => setEditingUnit(null)} initialFilter={inventoryFilter} />
        )}
        {page === "requisitions" && (
          <RequisitionsPage
            key={requisitionsKey}
            requests={requests}
            units={units}
            onDecide={handleDecideRequisition}
            onComplete={handleCompleteRequisition}
            onEdit={handleEditRequisition}
            initialTab={requisitionsTab}
            initialExpandIndex={requisitionsExpandIndex}
            returnUnitId={returnUnitId}
            onBackToUnit={backToInventoryUnit}
          />
        )}
        {page === "request" && (
          <RequestSpacePage requests={requests} onSubmit={handleSubmitRequisition} onAmend={handleAmendRequisition} />
        )}
      </main>

      {selected && (
        <UnitModal
          unit={selected}
          onClose={() => setSelected(null)}
          onEdit={(u) => { setEditingUnit(u); }}
          onUpdateServiceLog={handleUpdateServiceLog}
          onAddDocument={handleAddDocument}
          onRemoveDocument={handleRemoveDocument}
          onUpdatePhoto={handleUpdatePhoto}
          requests={requests}
          onOpenRequisition={openRequisitionFromUnit}
          goRequisitions={goRequisitions}
          categories={categories}
          categoryColors={categoryColors}
          onAddCategory={handleAddCategory}
          onRemoveCategory={handleRemoveCategory}
        />
      )}
      {editingUnit !== undefined && <AddEditUnitModal unit={editingUnit} onClose={() => setEditingUnit(undefined)} onSave={handleSaveUnit} />}
      {previewReqIndex !== null && (
        <RequisitionPreviewPanel
          req={requests[previewReqIndex]}
          index={previewReqIndex}
          units={units}
          onDecide={handleDecideRequisition}
          onComplete={handleCompleteRequisition}
          onEdit={handleEditRequisition}
          onClose={() => setPreviewReqIndex(null)}
          onOpenFull={() => {
            const req = requests[previewReqIndex];
            const idx = previewReqIndex;
            setPreviewReqIndex(null);
            goRequisitions(requisitionTab(req.status), idx);
          }}
        />
      )}
    </div>
  );
}

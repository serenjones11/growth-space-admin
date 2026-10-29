/* Date helpers shared by the UI (App.jsx), the data layer (api.js) and the
   backup export (backup.js), so all three agree on what "today" is and when
   a booking counts as ending soon or overdue.

   Dates in this app are calendar days ("YYYY-MM-DD", as Postgres `date`
   columns come back). `new Date("YYYY-MM-DD")` parses those as UTC
   midnight, so "today" is represented the same way: the *local* calendar
   date at UTC midnight. Comparing the two is then exact whatever the
   browser's time zone - including the hour after midnight in British
   Summer Time, when the UTC date is still yesterday. */

// A booking is "ending soon" this many days (or fewer) before its end date.
export const ENDING_SOON_DAYS = 2;

const pad = (n) => String(n).padStart(2, "0");

/* Local calendar date of `d` as "YYYY-MM-DD". */
export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* Today's local date, at UTC midnight (see above). */
export function today(now = new Date()) {
  return new Date(localISODate(now));
}

/* Whole days from `todayDate` to a "YYYY-MM-DD" date (negative = past). */
export function daysUntil(isoDate, todayDate = today()) {
  return Math.round((new Date(String(isoDate).slice(0, 10)) - todayDate) / 86400000);
}

/* "YYYY-MM-DD" (or a timestamp, date part taken) -> "DD/MM/YYYY". */
export function fmtGB(iso) {
  if (!iso) return "-";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/* Do two inclusive date ranges overlap? */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/* Where a booking stands on `todayDate`, by its dates alone:
   "upcoming" (not started), "overdue" (end date passed), "warning"
   (ending within ENDING_SOON_DAYS) or "current". */
export function bookingDateState(startDate, endDate, todayDate = today()) {
  if (daysUntil(startDate, todayDate) > 0) return "upcoming";
  const left = daysUntil(endDate, todayDate);
  if (left < 0) return "overdue";
  if (left <= ENDING_SOON_DAYS) return "warning";
  return "current";
}

/* "YYYY-MM" month key of a date - these compare correctly as strings. */
export function monthKey(isoDate) {
  return String(isoDate).slice(0, 7);
}

/* "YYYY-MM-DD" plus n days, as "YYYY-MM-DD" (UTC arithmetic, so no
   daylight-saving drift). */
export function addDays(isoDate, n) {
  const d = new Date(String(isoDate).slice(0, 10));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* The earliest start, on or after startDate, at which a stay as long as
   startDate..endDate fits without overlapping any of `ranges`
   ([{ startDate, endDate }], inclusive). */
export function earliestFreeStart(ranges, startDate, endDate) {
  const length = daysUntil(endDate, new Date(startDate));
  let start = startDate;
  for (;;) {
    const end = addDays(start, length);
    const blocking = ranges.filter((r) => rangesOverlap(start, end, r.startDate, r.endDate));
    if (!blocking.length) return start;
    start = addDays(blocking.reduce((m, r) => (r.endDate > m ? r.endDate : m), blocking[0].endDate), 1);
  }
}

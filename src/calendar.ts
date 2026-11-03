// Builds the day's schedule from the configured calendars and renders it as Markdown.
// No Obsidian imports, so it can be exercised from the terminal (see smoke.ts).
import { googleEvents, googleHeaders } from "./google";
import { feedEvents, isFeed } from "./ics";
import { Event, GcalSettings, Http } from "./types";

export type { CalendarSource, GcalSettings, Http, HttpRequest, ScheduleFormat } from "./types";
export { defaultCredentialsPath } from "./google";

export const DEFAULT_SETTINGS: GcalSettings = {
  format: "list",
  credentialsPath: "",
  quotaProject: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  calendars: [{ id: "primary", marker: "" }],
};

const RSVP: Record<string, string> = { accepted: "✅", tentative: "❓", needsAction: "⚠️", declined: "❌" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Pull a YYYY-MM-DD out of a note title like "2026-10-30, Friday"; default today (local). */
export function dateFromTitle(title?: string): string {
  const m = title?.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function scheduleMarkdown(date: string, settings: GcalSettings, http: Http): Promise<string> {
  const timeZone = settings.timeZone.trim() || DEFAULT_SETTINGS.timeZone;
  const next = addDays(date, 1);
  const timeMin = `${date}T00:00:00${tzOffset(date, timeZone)}`;
  const timeMax = `${next}T00:00:00${tzOffset(next, timeZone)}`;
  // Sign in to Google only if a Google calendar ID is configured; feed-only setups need no credentials.
  let headers: Promise<Record<string, string>> | undefined;
  const google = () => (headers = headers ?? googleHeaders(settings, http));

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const cal of settings.calendars) {
    const events = isFeed(cal.id)
      ? await feedEvents(http, cal, date, timeZone)
      : await googleEvents(http, await google(), cal.id, timeMin, timeMax, timeZone);
    for (const ev of events) {
      if (ev.cancelled) continue;
      const key = ev.uid + ev.start; // same event on several calendars: first calendar wins
      if (seen.has(key)) continue;
      seen.add(key);

      const rsvp = RSVP[ev.rsvp ?? ""] ?? "—";
      let title = cal.marker + cell(ev.summary ?? "(no title)");
      if (rsvp === "❌") title = `~~${title}~~`;
      rows.push({
        sort: (ev.allDay ? "0" : "1") + ev.start,
        allDay: ev.allDay,
        time: ev.allDay ? "" : timeRange(ev, date),
        range: ev.allDay ? allDayRange(ev) : "",
        title,
        rsvp,
        loc: location(ev),
      });
    }
  }
  rows.sort((a, b) => a.sort.localeCompare(b.sort));

  const now = new Date();
  const fetched = `${dateFromTitle()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const lines = !rows.length ? ["_No events._"] : settings.format === "table" ? renderTable(rows) : renderList(rows);
  const legend = settings.calendars.filter((c) => c.marker.trim() && c.label).map((c) => `${c.marker.trim()} ${c.label}`);
  lines.push("", `<small>${[`Fetched ${fetched}`, ...legend, "❌ declined"].join(" · ")}</small>`);
  return lines.join("\n");
}

interface Row {
  sort: string;
  allDay: boolean;
  time: string; // timed events only
  range: string; // multi-day all-day events only, e.g. "12 Oct – 6 Nov"
  title: string;
  rsvp: string; // "—" when there's no invite
  loc: string;
}

function renderTable(rows: Row[]): string[] {
  const time = (r: Row) => (r.allDay ? (r.range ? `All day (${r.range})` : "All day") : r.time);
  return ["| Time | Event | RSVP | Location |", "|---|---|---|---|", ...rows.map((r) => `| ${time(r)} | ${r.title} | ${r.rsvp} | ${r.loc} |`)];
}

// All-day items on one line up top, then a bullet per timed event. No RSVP mark when there's no invite.
function renderList(rows: Row[]): string[] {
  const mark = (r: Row) => (r.rsvp === "—" ? "" : ` ${r.rsvp}`);
  const lines: string[] = [];
  const allDay = rows.filter((r) => r.allDay).map((r) => `${r.title}${r.range ? ` (${r.range})` : ""}${mark(r)}`);
  if (allDay.length) lines.push(`**All day:** ${allDay.join(" · ")}`, "");
  for (const r of rows.filter((r) => !r.allDay)) {
    lines.push(`- **${r.time}** ${r.title}${mark(r)}${r.loc ? ` · ${r.loc}` : ""}`);
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Event times are already local to the schedule's time zone, so slicing them is safe.
function allDayRange(ev: Event): string {
  const start = ev.start;
  const end = addDays(ev.end || start, -1); // all-day end date is exclusive
  return start === end ? "" : `${shortDate(start)} – ${shortDate(end)}`;
}

function timeRange(ev: Event, day: string): string {
  const fmt = (dtStr = "") => (dtStr.slice(0, 10) === day ? dtStr.slice(11, 16) : `${shortDate(dtStr.slice(0, 10))} ${dtStr.slice(11, 16)}`);
  return `${fmt(ev.start)}–${fmt(ev.end)}`;
}

function location(ev: Event): string {
  const parts: string[] = [];
  // Room names carry a capacity "(6)" and "[Google Meet]" suffix; the Meet link is shown separately.
  const loc = (ev.location ?? "").replace(/\s*\(\d+\)/g, "").replace(/\s*\[Google Meet\]/gi, "");
  if (loc.trim()) parts.push(cell(loc));
  if (/^https:\/\/meet\.google\.com\/[\w-]+$/.test(ev.meetLink ?? "")) parts.push(`[Meet](${ev.meetLink})`);
  return parts.join(" · ");
}

// Titles and locations are written by whoever sent the invite, so neutralise anything
// Obsidian or Templater would act on: Markdown syntax, links/embeds, tags, HTML, `<% %>`.
// Bare URLs are left as-is (escaping would break them) apart from table pipes and HTML.
function cell(text: string): string {
  return text
    .replace(/\n/g, " ")
    .trim()
    .split(/(\s+)/)
    .map((w) => (/^https?:\/\//.test(w) ? w.replace(/\|/g, "\\|") : w.replace(/[\\`*_~[\]|#=$]/g, "\\$&")))
    .join("")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** UTC offset ("+01:00") of `timeZone` at the start of `date`. */
function tzOffset(date: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T00:00:00Z`));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return name.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? "+00:00";
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

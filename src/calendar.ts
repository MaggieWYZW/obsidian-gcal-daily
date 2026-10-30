// Calendar fetching + Markdown rendering. No Obsidian imports, so it can be
// exercised from the terminal (see smoke.ts).
import { execFile } from "child_process";
import { delimiter } from "path";

export interface CalendarSource {
  id: string;
  marker: string; // prefix for event titles, e.g. "🏠 "
  label?: string; // shown in the footer legend next to the marker, e.g. "personal"
}

export type ScheduleFormat = "list" | "table";

export interface GcalSettings {
  format: ScheduleFormat;
  gcloudPath: string;
  quotaProject: string;
  timeZone: string;
  calendars: CalendarSource[];
}

export const DEFAULT_SETTINGS: GcalSettings = {
  format: "list",
  gcloudPath: "gcloud",
  quotaProject: "",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  calendars: [{ id: "primary", marker: "" }],
};

// Minimal HTTP shape so Obsidian's requestUrl and Node's fetch can both be plugged in.
export type HttpGet = (url: string, headers: Record<string, string>) => Promise<{ status: number; json: any }>;

const RSVP: Record<string, string> = { accepted: "✅", tentative: "❓", needsAction: "⚠️", declined: "❌" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FIX_AUTH =
  "gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/cloud-platform";

export function accessToken(gcloudPath: string): Promise<string> {
  // Obsidian launched from the macOS Dock has a minimal PATH; gcloud needs to find python.
  const extra = process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : [];
  const env = { ...process.env, PATH: [...extra, process.env.PATH ?? ""].join(delimiter) };
  // On Windows gcloud is a .cmd script, which Node only runs through a shell.
  const opts = { env, timeout: 30000, shell: process.platform === "win32" };
  return new Promise((resolve, reject) => {
    execFile(gcloudPath, ["auth", "application-default", "print-access-token"], opts, (err, stdout, stderr) => {
      if (err) reject(new Error(`gcloud token failed: ${(stderr || err.message).trim()}. Re-auth with: ${FIX_AUTH}`));
      else resolve(stdout.trim());
    });
  });
}

/** Pull a YYYY-MM-DD out of a note title like "2026-10-30, Friday"; default today (local). */
export function dateFromTitle(title?: string): string {
  const m = title?.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function scheduleMarkdown(date: string, settings: GcalSettings, http: HttpGet): Promise<string> {
  const token = await accessToken(settings.gcloudPath);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (settings.quotaProject) headers["x-goog-user-project"] = settings.quotaProject;
  const next = addDays(date, 1);
  const timeMin = `${date}T00:00:00${tzOffset(date, settings.timeZone)}`;
  const timeMax = `${next}T00:00:00${tzOffset(next, settings.timeZone)}`;

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const cal of settings.calendars) {
    for (const ev of await listEvents(http, headers, cal.id, timeMin, timeMax, settings.timeZone)) {
      if (ev.status === "cancelled") continue;
      const start = ev.start.dateTime ?? ev.start.date;
      const key = (ev.iCalUID ?? ev.id) + start; // same event on several calendars: first calendar wins
      if (seen.has(key)) continue;
      seen.add(key);

      const me = (ev.attendees ?? []).find((a: any) => a.self);
      const rsvp = me ? RSVP[me.responseStatus] ?? "—" : "—";
      let title = cal.marker + cell(ev.summary ?? "(no title)");
      if (rsvp === "❌") title = `~~${title}~~`;
      const allDay = Boolean(ev.start.date);
      rows.push({
        sort: (allDay ? "0" : "1") + start,
        allDay,
        time: allDay ? "" : timeRange(ev, date),
        range: allDay ? allDayRange(ev) : "",
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

async function listEvents(http: HttpGet, headers: Record<string, string>, calId: string, timeMin: string, timeMax: string, timeZone: string) {
  const items: any[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, timeZone, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`;
    const res = await http(url, headers);
    if (res.status !== 200) {
      const msg = res.json?.error?.message ?? `HTTP ${res.status}`;
      const hint = /scope/i.test(msg) ? ` Re-auth with: ${FIX_AUTH}` : "";
      throw new Error(`Calendar API error for ${calId} (${res.status}): ${msg}${hint}`);
    }
    items.push(...(res.json.items ?? []));
    pageToken = res.json.nextPageToken;
  } while (pageToken);
  return items;
}

// dateTime strings come back in the requested timeZone, so slicing them is safe.
function allDayRange(ev: any): string {
  const start = ev.start.date;
  const end = addDays(ev.end.date, -1); // all-day end date is exclusive
  return start === end ? "" : `${shortDate(start)} – ${shortDate(end)}`;
}

function timeRange(ev: any, day: string): string {
  const fmt = (dtStr: string) => (dtStr.slice(0, 10) === day ? dtStr.slice(11, 16) : `${shortDate(dtStr.slice(0, 10))} ${dtStr.slice(11, 16)}`);
  return `${fmt(ev.start.dateTime)}–${fmt(ev.end.dateTime)}`;
}

function location(ev: any): string {
  const parts: string[] = [];
  // Room names carry a capacity "(6)" and "[Google Meet]" suffix; the Meet link is shown separately.
  const loc = (ev.location ?? "").replace(/\s*\(\d+\)/g, "").replace(/\s*\[Google Meet\]/gi, "");
  if (loc.trim()) parts.push(cell(loc));
  if (/^https:\/\/meet\.google\.com\/[\w-]+$/.test(ev.hangoutLink ?? "")) parts.push(`[Meet](${ev.hangoutLink})`);
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

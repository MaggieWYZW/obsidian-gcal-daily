// iCal feed source: a calendar's secret/published .ics URL, no credentials needed.
// Parsing, recurrence rules and VTIMEZONE maths come from ical.js; this module turns its
// output into the same Event shape the Google API source produces.
import ICAL from "ical.js";
import { CalendarSource, Event, Http } from "./types";

type Component = ICAL.Component;
type Property = ICAL.Property;
type Time = ICAL.Time;

// Stops a runaway rule (e.g. minutely since 2010) from hanging note creation.
const MAX_OCCURRENCES = 50_000;

const PARTSTAT: Record<string, string> = {
  ACCEPTED: "accepted",
  TENTATIVE: "tentative",
  "NEEDS-ACTION": "needsAction",
  DECLINED: "declined",
};

/** True when a calendar line is a feed URL rather than a Google calendar ID. */
export function isFeed(id: string): boolean {
  return /^(https?|webcal):\/\//i.test(id.trim());
}

/**
 * Fetch a feed and return its event occurrences on `date`.
 * A feed URL is a bearer credential: error messages name the calendar by its label (or host), never the URL.
 */
export async function feedEvents(http: Http, cal: CalendarSource, date: string, timeZone: string): Promise<Event[]> {
  const url = cal.id.trim().replace(/^webcal:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${cal.label ? `Feed "${cal.label}" has` : "A calendar line has"} an invalid feed URL`);
  }
  const host = parsed.host;
  const name = cal.label ? `"${cal.label}" (${host})` : host;
  // The URL is the credential, so never send it unencrypted.
  if (/^http:\/\//i.test(url)) throw new Error(`Feed ${name} uses http://; use its https:// or webcal:// address`);

  let res: { status: number; text: string };
  try {
    res = await http({ url });
  } catch (err) {
    // The underlying message usually quotes the URL, so only pass on a bare error code like ENOTFOUND.
    const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
    const detail = typeof code === "string" && /^[A-Z_]+$/.test(code) ? ` (${code})` : "";
    throw new Error(`Feed ${name} couldn't be fetched${detail}`);
  }
  if (res.status !== 200) throw new Error(`Feed ${name}: HTTP ${res.status}`);

  // Some servers send a BOM or leading blank lines; anything else (an HTML login page, say) isn't a feed.
  const body = res.text.replace(/^﻿/, "").trimStart();
  if (!/^BEGIN:VCALENDAR/i.test(body)) throw new Error(`Feed ${name} didn't return an iCalendar file`);

  try {
    return parseFeed(body, date, timeZone, googleCalendarAddress(parsed));
  } catch (err) {
    throw new Error(`Feed ${name} couldn't be parsed: ${redact(err instanceof Error ? err.message : String(err), url)}`);
  }
}

/**
 * Google secret addresses carry the calendar's ID: /calendar/ical/<id>/private-…/basic.ics. For someone's own
 * calendar the ID is their address, which finds their RSVP even when the calendar has been renamed
 * (X-WR-CALNAME then holds the new name, not the address).
 */
function googleCalendarAddress(url: URL): string[] {
  if (url.host !== "calendar.google.com") return [];
  const id = safeDecode(url.pathname.match(/^\/calendar\/ical\/([^/]+)\//)?.[1] ?? "");
  return /^[^@\s]+@[^@\s]+$/.test(id) && !id.endsWith(".calendar.google.com") ? [id] : [];
}

/**
 * Parse iCalendar text and return the occurrences overlapping `date` (00:00 to next 00:00 in `timeZone`),
 * with recurring events expanded. Pure: no network, so fixtures can test it.
 * `selfEmails` are the user's addresses, used to read their RSVP from the ATTENDEE lines.
 */
export function parseFeed(text: string, date: string, timeZone: string, selfEmails: string[] = []): Event[] {
  const roots = calendars(text);

  // ical.js keeps zones in a global registry; reset it so one feed's zones can't leak into the next.
  ICAL.TimezoneService.reset();
  for (const root of roots) {
    for (const vtz of root.getAllSubcomponents("vtimezone")) {
      try {
        ICAL.TimezoneService.register(vtz);
      } catch {
        // A broken VTIMEZONE: times using it fall back to wall-clock (see wallZone).
      }
    }
  }

  const next = addDays(date, 1);
  const win: Window = { date, next, start: zonedToEpoch(date, 0, 0, 0, timeZone), end: zonedToEpoch(next, 0, 0, 0, timeZone) };
  const out: Event[] = [];
  for (const root of roots) {
    const ctx: Ctx = { win, timeZone, me: identities(root, selfEmails), out };
    for (const group of byUid(root.getAllSubcomponents("vevent"))) expandGroup(group, ctx);
  }
  return out;
}

interface Window {
  date: string; // the day, YYYY-MM-DD
  next: string; // the day after
  start: number; // epoch ms of date 00:00 in the schedule's zone
  end: number; // epoch ms of next 00:00
}

interface Ctx {
  win: Window;
  timeZone: string;
  me: Set<string>; // the user's addresses, lower-cased
  out: Event[];
}

interface Group {
  uid: string;
  masters: Component[];
  overrides: Component[]; // VEVENTs with a RECURRENCE-ID
}

// ical.js returns one jCal component, or an array when the text has several top-level components.
function calendars(text: string): Component[] {
  const jcal: unknown = ICAL.parse(text);
  if (!Array.isArray(jcal)) throw new Error("no calendar data");
  const list: unknown[] = typeof jcal[0] === "string" ? [jcal] : jcal;
  const roots = list.filter((c): c is unknown[] => Array.isArray(c) && c[0] === "vcalendar").map((c) => new ICAL.Component(c));
  if (!roots.length) throw new Error("no VCALENDAR component");
  return roots;
}

// Google primary calendars are named after their address, so X-WR-CALNAME identifies the user there.
function identities(root: Component, selfEmails: string[]): Set<string> {
  const me = new Set(selfEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const calName = text(root, "x-wr-calname");
  if (calName?.includes("@")) me.add(calName.trim().toLowerCase());
  return me;
}

// A recurring event is a master VEVENT plus one VEVENT per changed instance, all sharing a UID.
function byUid(vevents: Component[]): Group[] {
  const groups = new Map<string, Group>();
  vevents.forEach((comp, i) => {
    const uid = text(comp, "uid") ?? `no-uid-${i}`; // no UID (malformed): keep it as its own event
    const group = groups.get(uid) ?? { uid, masters: [], overrides: [] };
    groups.set(uid, group);
    (comp.hasProperty("recurrence-id") ? group.overrides : group.masters).push(comp);
  });
  return [...groups.values()];
}

function expandGroup(group: Group, ctx: Ctx): void {
  // Each override replaces one slot of the master; keep the latest revision of each.
  const overrides = new Map<string, { comp: Component; seq: number }>();
  for (const comp of group.overrides) {
    try {
      const prop = comp.getFirstProperty("recurrence-id");
      const rid = prop?.getFirstValue();
      if (!(rid instanceof ICAL.Time)) continue;
      const key = slotKey(rid, wallZone(prop, ctx.timeZone));
      const seq = Number(comp.getFirstPropertyValue("sequence") ?? 0) || 0;
      const prev = overrides.get(key);
      if (!prev || seq >= prev.seq) overrides.set(key, { comp, seq });
    } catch {
      // Malformed override: skip it.
    }
  }

  for (const master of group.masters) {
    try {
      expandMaster(master, group.uid, new Set(overrides.keys()), ctx);
    } catch {
      // Malformed event (bad dates, impossible rule): skip it rather than lose the whole feed.
    }
  }

  // Overrides are judged on their own DTSTART/DTEND, so an instance moved into or out of the day is right.
  // Without a master (e.g. only one instance was shared) they stand alone.
  const master = group.masters[0];
  for (const { comp } of overrides.values()) {
    try {
      const ev = new ICAL.Event(comp, { exceptions: [] });
      const startProp = comp.getFirstProperty("dtstart");
      const zone = wallZone(startProp, ctx.timeZone);
      const endZone = comp.hasProperty("dtend") ? wallZone(comp.getFirstProperty("dtend"), ctx.timeZone) : zone;
      emit(group.uid, ev.startDate, ev.endDate, zone, endZone, master ? [comp, master] : [comp], ctx);
    } catch {
      // Malformed override: skip it.
    }
  }
}

function expandMaster(comp: Component, uid: string, overridden: Set<string>, ctx: Ctx): void {
  // Pass `exceptions` explicitly: by default ical.js scans the whole calendar for them on every event.
  const ev = new ICAL.Event(comp, { exceptions: [] });
  const start = ev.startDate;
  if (!(start instanceof ICAL.Time)) return; // no DTSTART
  const zone = wallZone(comp.getFirstProperty("dtstart"), ctx.timeZone);

  if (!ev.isRecurring()) {
    const endZone = comp.hasProperty("dtend") ? wallZone(comp.getFirstProperty("dtend"), ctx.timeZone) : zone;
    emit(uid, start, ev.endDate, zone, endZone, [comp], ctx);
    return;
  }

  // RRULE/RDATE/EXDATE are applied by the iterator, in DTSTART's zone, so 09:00 stays 09:00 across DST.
  const duration = ev.duration;
  if (endedBefore(comp, duration, zone, ctx.win)) return;
  const it = ev.iterator();
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const next: unknown = it.next();
    // An RDATE can be a PERIOD; its start is the occurrence.
    const occ = next instanceof ICAL.Period ? next.start : next;
    if (!(occ instanceof ICAL.Time)) break; // expansion finished
    if (occ.isDate ? occ.toString() >= ctx.win.next : epochMs(occ, zone) >= ctx.win.end) break;
    if (overridden.has(slotKey(occ, zone))) continue; // the override is emitted on its own
    const end = occ.clone();
    end.addDuration(duration);
    emit(uid, occ, end, zone, zone, [comp], ctx);
  }
}

// Feeds carry years of finished series; skip expanding one whose every RRULE has an UNTIL well before the day.
// (COUNT-limited series still have to be walked to find where they end.)
function endedBefore(comp: Component, duration: ICAL.Duration, zone: string, win: Window): boolean {
  if (comp.hasProperty("rdate")) return false;
  const DAY = 86_400_000; // margin for date-valued UNTILs and zone differences
  return comp.getAllProperties("rrule").every((prop) => {
    const rule = prop.getFirstValue();
    const until = rule instanceof ICAL.Recur ? rule.until : null;
    return until instanceof ICAL.Time && epochMs(until, zone) + duration.toSeconds() * 1000 + DAY < win.start;
  });
}

/**
 * Add the occurrence to the output if it overlaps the day.
 * `comps` are where fields are read from, first match wins (an override, then its master).
 * `startZone`/`endZone` are the zones floating times are read in.
 */
function emit(uid: string, start: Time, end: Time, startZone: string, endZone: string, comps: Component[], ctx: Ctx): void {
  const { win } = ctx;
  let fields: { allDay: boolean; start: string; end: string };
  if (start.isDate) {
    // All-day: compare dates, end exclusive. A missing or backwards end means one day.
    const s = start.toString().slice(0, 10);
    let e = end.toString().slice(0, 10);
    if (e <= s) e = addDays(s, 1);
    if (!(s <= win.date && win.date < e)) return;
    fields = { allDay: true, start: s, end: e };
  } else {
    const s = epochMs(start, startZone);
    const e = Math.max(s, epochMs(end, endZone));
    // Overlaps the day; a zero-length event counts if it starts within it.
    const overlaps = s < win.end && (e > win.start || (e === s && s >= win.start));
    if (!overlaps) return;
    fields = { allDay: false, start: localStamp(s, ctx.timeZone), end: localStamp(e, ctx.timeZone) };
  }

  const description = first(comps, (c) => text(c, "description"));
  const conference = first(comps, (c) => text(c, "x-google-conference"));
  ctx.out.push({
    uid,
    ...fields,
    summary: first(comps, (c) => text(c, "summary") || undefined),
    location: first(comps, (c) => text(c, "location") || undefined),
    meetLink: /^https:\/\/meet\.google\.com\//.test(conference ?? "")
      ? conference
      : description?.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/)?.[0],
    rsvp: rsvp(first(comps, (c) => (c.hasProperty("attendee") ? c.getAllProperties("attendee") : undefined)) ?? [], ctx.me),
    cancelled: first(comps, (c) => text(c, "status"))?.toUpperCase() === "CANCELLED",
  });
}

// The user's PARTSTAT, from the first ATTENDEE whose address is theirs.
function rsvp(attendees: Property[], me: Set<string>): string | undefined {
  if (!me.size) return undefined;
  for (const a of attendees) {
    const value = a.getFirstValue();
    const email = typeof value === "string" ? value.replace(/^mailto:/i, "").trim().toLowerCase() : "";
    if (!me.has(email)) continue;
    return PARTSTAT[String(a.getParameter("partstat") ?? "").toUpperCase()];
  }
  return undefined;
}

function first<T>(comps: Component[], get: (c: Component) => T | undefined): T | undefined {
  for (const c of comps) {
    const v = get(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

function text(comp: Component, name: string): string | undefined {
  const v = comp.getFirstPropertyValue(name);
  return typeof v === "string" ? v : undefined;
}

/**
 * The zone a floating time (no TZID, no Z) is read in: the schedule's zone, not the machine's.
 * A TZID with no VTIMEZONE also comes back floating from ical.js; use it if it's an IANA name.
 */
function wallZone(prop: Property | null, timeZone: string): string {
  const tzid = prop?.getParameter("tzid");
  return typeof tzid === "string" && isIanaZone(tzid) ? tzid : timeZone;
}

function isIanaZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
}

function isFloating(t: Time): boolean {
  return t.zone === ICAL.Timezone.localTimezone || t.zone?.tzid === "floating";
}

// ical.js treats floating times as UTC in toUnixTime() and as machine-local in toJSDate(); neither is
// wanted, so floating wall-clock fields are converted in `wall` here.
function epochMs(t: Time, wall: string): number {
  if (!isFloating(t)) return t.toUnixTime() * 1000;
  const d = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  return zonedToEpoch(d, t.hour, t.minute, t.second, wall);
}

// Identifies a recurrence slot, so an override (RECURRENCE-ID) can be matched to the master's occurrence.
function slotKey(t: Time, wall: string): string {
  return t.isDate ? `D${t.toString().slice(0, 10)}` : `T${epochMs(t, wall)}`;
}

/** Epoch ms of a wall-clock time in an IANA zone. */
function zonedToEpoch(date: string, hour: number, minute: number, second: number, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hour, minute, second);
  let t = asUtc - offsetMs(asUtc, timeZone);
  // The offset at the guess may differ from the offset at the answer near a DST change; one correction settles it.
  const corrected = asUtc - offsetMs(t, timeZone);
  if (corrected !== t) t = corrected;
  return t;
}

/** How far `timeZone` is ahead of UTC at instant `ms`. */
function offsetMs(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:MM" local to `timeZone`, the format Google's dateTime strings are sliced to. */
function localStamp(ms: number, timeZone: string): string {
  const p = zoneParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneParts(ms: number, timeZone: string): Record<"year" | "month" | "day" | "hour" | "minute" | "second", number> {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Parser messages can quote feed content; strip anything URL-like, and the feed URL's own parts, before showing them.
function redact(message: string, url: string): string {
  let msg = message.replace(/\b(https?|webcal):\/\/\S+/gi, "<url>");
  const secrets = [url];
  try {
    const u = new URL(url);
    secrets.push(u.pathname + u.search, u.search.slice(1), ...u.pathname.split("/"));
    secrets.push(...u.pathname.split("/").map((s) => safeDecode(s)));
    secrets.push(...[...u.searchParams.values()]);
  } catch {
    // Unparseable URL: the whole-URL replacement above still applies.
  }
  for (const s of secrets.filter((s) => s.length >= 10)) msg = msg.split(s).join("<redacted>");
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Dependency-free checks for iCal feed support: `npm run check`.
// Expected values are written by hand from the fixtures in test/fixtures/ (see the comments next to
// each case for how the trickier times were worked out); they are not derived from src/ics.ts.
import { readFileSync } from "fs";
import { scheduleMarkdown } from "./calendar";
import { feedEvents, isFeed, parseFeed } from "./ics";
import { CalendarSource, Event, GcalSettings, Http, HttpRequest } from "./types";

// parseFeed gains an optional `selfEmails` parameter; this alias keeps the file compiling against
// either signature without `any`.
const parse = parseFeed as (text: string, date: string, timeZone: string, selfEmails?: string[]) => Event[];

const LONDON = "Europe/London";
const NY = "America/New_York";

const fixture = (name: string): string => readFileSync(`test/fixtures/${name}`, "utf8");
const RECURRING = fixture("google-recurring.ics");
const MISC = fixture("google-misc.ics");
const WORK = fixture("google-work.ics");
const OUTLOOK = fixture("outlook.ics");

// ---------------------------------------------------------------------------------------------
// Expected events and comparison

interface Expected {
  uid: string;
  start: string;
  end: string;
  summary?: string;
  location?: string;
  meetLink?: string;
  rsvp?: string;
  cancelled?: boolean;
}

// Optional strings: undefined and "" render identically in calendar.ts, so both project to "".
function project(e: Expected | Event): string {
  const allDay = "allDay" in e ? e.allDay : e.start.length === 10;
  return [
    e.uid,
    allDay ? "allDay" : "timed",
    e.start,
    e.end,
    `summary=${e.summary ?? ""}`,
    `location=${e.location ?? ""}`,
    `meet=${e.meetLink ?? ""}`,
    `rsvp=${e.rsvp ?? ""}`,
    `cancelled=${e.cancelled ?? false}`,
  ].join(" | ");
}

class Failure extends Error {}

function sameLines(actual: string[], expected: string[], what: string, sorted: boolean): void {
  const a = sorted ? [...actual].sort() : actual;
  const e = sorted ? [...expected].sort() : expected;
  if (a.length === e.length && a.every((line, i) => line === e[i])) return;
  const missing = e.filter((line) => !a.includes(line));
  const extra = a.filter((line) => !e.includes(line));
  const out = [`${what} differ`];
  if (!missing.length && !extra.length) out.push("  (same lines, different order or duplicates)");
  out.push(...missing.map((l) => `  - expected: ${l}`), ...extra.map((l) => `  + actual:   ${l}`));
  out.push("  full expected:", ...e.map((l) => `      ${l}`), "  full actual:", ...a.map((l) => `      ${l}`));
  throw new Failure(out.join("\n"));
}

function events(actual: Event[], expected: Expected[]): void {
  if (!Array.isArray(actual)) throw new Failure(`expected an array of events, got ${typeof actual}`);
  sameLines(actual.map(project), expected.map(project), "events", true);
}

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Failure(msg);
}

async function rejects(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Failure("expected a rejection, but it resolved");
}

// ---------------------------------------------------------------------------------------------
// Cases

interface Case {
  name: string;
  run: () => void | Promise<void>;
}
const cases: Case[] = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });
const day = (fixtureName: string, text: string, date: string, tz: string, expected: Expected[], self?: string[]) =>
  test(`parseFeed ${fixtureName} ${date} ${tz}${self ? ` self=${self.join(",")}` : ""}`, () =>
    events(self ? parse(text, date, tz, self) : parse(text, date, tz), expected),
  );

// --- isFeed -----------------------------------------------------------------------------------
const feedIds = [
  "https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics",
  "http://example.com/cal.ics",
  "webcal://p01-caldav.icloud.com/published/2/MTIz",
  "WEBCAL://Example.com/a.ics",
  "HTTPS://outlook.office365.com/owa/calendar/x/reachcalendar.ics",
];
const googleIds = ["me@gmail.com", "primary", "c_abc123@group.calendar.google.com", "en.uk#holiday@group.v.calendar.google.com", "ftp://example.com/a.ics", ""];
for (const id of feedIds) test(`isFeed true: ${id}`, () => ok(isFeed(id) === true, `isFeed(${JSON.stringify(id)}) should be true`));
for (const id of googleIds) test(`isFeed false: ${JSON.stringify(id)}`, () => ok(isFeed(id) === false, `isFeed(${JSON.stringify(id)}) should be false`));

// --- google-recurring.ics: weekly standup across both UK DST changes, with an EXDATE ----------
// Mondays 09:00–09:30 Europe/London from 2026-03-16, UNTIL 2026-11-30T09:00Z (= 09:00 GMT, inclusive),
// EXDATE 2026-10-12. In London the wall clock never moves, whichever side of a DST change.
const standup = (d: string, from = "09:00", to = "09:30"): Expected => ({
  uid: "standup-001@google.com",
  start: `${d}T${from}`,
  end: `${d}T${to}`,
  summary: "Team standup",
  location: "Room 4.01 (6) [Google Meet]",
  meetLink: "https://meet.google.com/abc-defg-hij",
  rsvp: "accepted", // self via X-WR-CALNAME maggie@example.com
});
day("recurring", RECURRING, "2026-03-23", LONDON, [standup("2026-03-23")]); // last Monday on GMT
day("recurring", RECURRING, "2026-03-30", LONDON, [standup("2026-03-30")]); // first Monday on BST (clocks forward 29 Mar)
day("recurring", RECURRING, "2026-10-19", LONDON, [standup("2026-10-19")]); // last Monday on BST
day("recurring", RECURRING, "2026-10-26", LONDON, [standup("2026-10-26")]); // first Monday on GMT (clocks back 25 Oct)
day("recurring", RECURRING, "2026-10-12", LONDON, []); // EXDATE
day("recurring", RECURRING, "2026-10-13", LONDON, []); // Tuesday: nothing
day("recurring", RECURRING, "2026-11-02", LONDON, [standup("2026-11-02")]);
day("recurring", RECURRING, "2026-11-30", LONDON, [standup("2026-11-30")]); // UNTIL is inclusive
day("recurring", RECURRING, "2026-12-07", LONDON, []); // past UNTIL
// New York view: London 09:00 converted through both zones' offsets. US DST: 8 Mar – 1 Nov 2026.
//   23 Mar: 09:00 GMT = 09:00Z = 05:00 EDT     30 Mar: 09:00 BST = 08:00Z = 04:00 EDT
//   26 Oct: 09:00 GMT = 09:00Z = 05:00 EDT     02 Nov: 09:00 GMT = 09:00Z = 04:00 EST
day("recurring", RECURRING, "2026-03-23", NY, [standup("2026-03-23", "05:00", "05:30")]);
day("recurring", RECURRING, "2026-03-30", NY, [standup("2026-03-30", "04:00", "04:30")]);
day("recurring", RECURRING, "2026-10-26", NY, [standup("2026-10-26", "05:00", "05:30")]);
day("recurring", RECURRING, "2026-11-02", NY, [standup("2026-11-02", "04:00", "04:30")]);

// --- google-recurring.ics: 1:1 series with a moved and a cancelled instance -------------------
// Thursdays 14:00–14:30 Europe/London from 2026-10-01, COUNT=8 (1 Oct … 19 Nov).
// Override RECURRENCE-ID 15 Oct → moved to Fri 16 Oct 11:00–11:30, accepted. Override 29 Oct →
// STATUS:CANCELLED (listed before the master in the file). Meet link is only in DESCRIPTION, after a
// docs URL, and the line is folded in the middle of the Meet URL.
const oneOnOne = (d: string, extra: Partial<Expected> = {}, from = "14:00", to = "14:30"): Expected => ({
  uid: "oneonone-sam@google.com",
  start: `${d}T${from}`,
  end: `${d}T${to}`,
  summary: "1:1 Maggie / Sam",
  meetLink: "https://meet.google.com/xyz-abcd-efg",
  rsvp: "tentative",
  ...extra,
});
day("recurring", RECURRING, "2026-10-15", LONDON, []); // moved out: original slot must not appear
day("recurring", RECURRING, "2026-10-16", LONDON, [
  oneOnOne("2026-10-16", { summary: "1:1 Maggie / Sam (moved)", rsvp: "accepted" }, "11:00", "11:30"),
]);
day("recurring", RECURRING, "2026-10-22", LONDON, [oneOnOne("2026-10-22")]); // BST
day("recurring", RECURRING, "2026-10-29", LONDON, [oneOnOne("2026-10-29", { cancelled: true })]); // returned, flagged
day("recurring", RECURRING, "2026-11-05", LONDON, [oneOnOne("2026-11-05")]); // GMT, same wall clock
day("recurring", RECURRING, "2026-11-26", LONDON, []); // past COUNT
// 22 Oct 14:00 BST = 13:00Z = 09:00 EDT
day("recurring", RECURRING, "2026-10-22", NY, [oneOnOne("2026-10-22", {}, "09:00", "09:30")]);

// --- google-recurring.ics: orphan override (RECURRENCE-ID with no master in the feed) ---------
const designReview: Expected = {
  uid: "designreview-weekly@google.com",
  start: "2026-11-04T15:30",
  end: "2026-11-04T16:30",
  summary: "Design review",
  location: "Room 2.10",
  rsvp: "accepted",
};
day("recurring", RECURRING, "2026-11-04", LONDON, [designReview]);
day("recurring", RECURRING, "2026-11-03", LONDON, []); // orphan only on 4 Nov; nothing else in this feed on 3 Nov

// --- google-misc.ics: all-day, cross-midnight, UTC, floating, zero-length, RSVP variants ------
const conf: Expected = { uid: "conf-pydata-2026@google.com", start: "2026-10-21", end: "2026-10-24", summary: "PyData London", location: "Tobacco Dock, London" };
const bins = (d: string, next: string): Expected => ({ uid: "bins@google.com", start: d, end: next, summary: "Bin day" }); // no DTEND ⇒ 1 day
const bday: Expected = { uid: "bday-mum@google.com", start: "2026-11-03", end: "2026-11-04", summary: "Mum's birthday" };
// 23:00 BST 24 Oct → 03:00 GMT 25 Oct (crosses midnight and the DST change: 5 real hours).
const handover = (start: string, end: string): Expected => ({ uid: "handover-1024@google.com", start, end, summary: "On-call handover" });
const release = (from: string, to: string): Expected => ({ uid: "release-1020@google.com", start: `2026-10-20T${from}`, end: `2026-10-20T${to}`, summary: "Release window" });

day("misc", MISC, "2026-10-20", LONDON, [release("16:00", "17:00")]); // 15:00Z in BST
day("misc", MISC, "2026-10-21", LONDON, [conf]); // first day of multi-day all-day
day("misc", MISC, "2026-10-23", LONDON, [conf, bins("2026-10-23", "2026-10-24")]); // last day + weekly all-day
day("misc", MISC, "2026-10-24", LONDON, [handover("2026-10-24T23:00", "2026-10-25T03:00")]); // DTEND 24 Oct is exclusive
day("misc", MISC, "2026-10-25", LONDON, [handover("2026-10-24T23:00", "2026-10-25T03:00")]); // crossed in from the previous day
day("misc", MISC, "2026-10-26", LONDON, []);
day("misc", MISC, "2026-10-30", LONDON, [bins("2026-10-30", "2026-10-31")]);
day("misc", MISC, "2026-11-02", LONDON, [
  { uid: "latecall@google.com", start: "2026-11-02T23:00", end: "2026-11-03T00:00", summary: "Late call with Sydney" },
]);
day("misc", MISC, "2026-11-04", LONDON, [{ uid: "deadline@google.com", start: "2026-11-04T00:00", end: "2026-11-04T00:00", summary: "Deadline" }]);

// 3 Nov (GMT). Not included: the late call (ends exactly at 00:00) and the zero-length deadline at 4 Nov 00:00.
const nov3London: Expected[] = [
  bday,
  { uid: "opscheck@google.com", start: "2026-11-03T03:00", end: "2026-11-03T03:30", summary: "Ops check" }, // 03:00Z
  { uid: "gym@google.com", start: "2026-11-03T07:00", end: "2026-11-03T08:00", summary: "Gym", location: "PureGym Shoreditch" }, // floating
  { uid: "expenses@google.com", start: "2026-11-03T09:00", end: "2026-11-03T09:00", summary: "Reminder: submit expenses" }, // zero-length
  { uid: "planning@google.com", start: "2026-11-03T10:00", end: "2026-11-03T11:00", summary: "Planning", location: "Room 1.05 (4)", rsvp: "needsAction" }, // mailto in upper case
  { uid: "worksync@google.com", start: "2026-11-03T12:00", end: "2026-11-03T12:30", summary: "Work sync", meetLink: "https://meet.google.com/wrk-sync-abc" }, // attendee is the work address: not self
  { uid: "vendordemo@google.com", start: "2026-11-03T13:00", end: "2026-11-03T14:00", summary: "Vendor demo", location: "Zoom" }, // DELEGATED ⇒ no rsvp; Zoom URL ⇒ no Meet
  { uid: "townhall@google.com", start: "2026-11-03T16:00", end: "2026-11-03T17:00", summary: "Optional town hall", location: "Auditorium [Google Meet]", meetLink: "https://meet.google.com/twn-hall-now", rsvp: "declined" },
];
day("misc", MISC, "2026-11-03", LONDON, nov3London);
// selfEmails adds to (doesn't replace) the X-WR-CALNAME identity, case-insensitively.
day(
  "misc",
  MISC,
  "2026-11-03",
  LONDON,
  nov3London.map((e) => (e.uid === "worksync@google.com" ? { ...e, rsvp: "accepted" } : e)),
  ["Maggie.Wang@Work.Example"],
);

// New York views of google-misc.ics.
//   Release 15:00Z 20 Oct = 11:00 EDT. Handover 22:00Z 24 Oct – 03:00Z 25 Oct = 18:00–23:00 EDT on 24 Oct, so NY 25 Oct is empty.
//   3 Nov window = [05:00Z 3 Nov, 05:00Z 4 Nov) (EST). Ops check (03:00Z) and the late call (23:00Z–00:00Z 2 Nov) fall on 2 Nov;
//   the deadline (00:00Z 4 Nov) falls at 19:00 on 3 Nov; the floating gym stays 07:00 wall clock (X-WR-TIMEZONE is ignored).
day("misc", MISC, "2026-10-20", NY, [release("11:00", "12:00")]);
day("misc", MISC, "2026-10-24", NY, [handover("2026-10-24T18:00", "2026-10-24T23:00")]);
day("misc", MISC, "2026-10-25", NY, []);
day("misc", MISC, "2026-11-02", NY, [
  { uid: "latecall@google.com", start: "2026-11-02T18:00", end: "2026-11-02T19:00", summary: "Late call with Sydney" },
  { uid: "opscheck@google.com", start: "2026-11-02T22:00", end: "2026-11-02T22:30", summary: "Ops check" },
]);
day("misc", MISC, "2026-11-03", NY, [
  bday,
  { uid: "gym@google.com", start: "2026-11-03T07:00", end: "2026-11-03T08:00", summary: "Gym", location: "PureGym Shoreditch" },
  { uid: "expenses@google.com", start: "2026-11-03T04:00", end: "2026-11-03T04:00", summary: "Reminder: submit expenses" },
  { uid: "planning@google.com", start: "2026-11-03T05:00", end: "2026-11-03T06:00", summary: "Planning", location: "Room 1.05 (4)", rsvp: "needsAction" },
  { uid: "worksync@google.com", start: "2026-11-03T07:00", end: "2026-11-03T07:30", summary: "Work sync", meetLink: "https://meet.google.com/wrk-sync-abc" },
  { uid: "vendordemo@google.com", start: "2026-11-03T08:00", end: "2026-11-03T09:00", summary: "Vendor demo", location: "Zoom" },
  { uid: "townhall@google.com", start: "2026-11-03T11:00", end: "2026-11-03T12:00", summary: "Optional town hall", location: "Auditorium [Google Meet]", meetLink: "https://meet.google.com/twn-hall-now", rsvp: "declined" },
  { uid: "deadline@google.com", start: "2026-11-03T19:00", end: "2026-11-03T19:00", summary: "Deadline" },
]);

// --- google-work.ics: STATUS:CANCELLED on a single event, X-WR-CALNAME identity -------------
day("work", WORK, "2026-11-03", LONDON, [
  { uid: "planning@google.com", start: "2026-11-03T10:00", end: "2026-11-03T11:00", summary: "Planning (work copy)", location: "Room 1.05 (4)", rsvp: "accepted" },
  { uid: "offsite@google.com", start: "2026-11-03T11:00", end: "2026-11-03T12:00", summary: "Offsite planning", cancelled: true },
  { uid: "fraudreview@google.com", start: "2026-11-03T14:30", end: "2026-11-03T15:30", summary: "Fraud model review", location: "Room 3.02 (8) [Google Meet]", meetLink: "https://meet.google.com/frd-modl-rev", rsvp: "accepted" },
]);

// --- outlook.ics: Windows zone names with their own VTIMEZONEs ---------------------------------
// "Risk forum": Wednesdays 10:00–11:00 "GMT Standard Time" (= UK rules) from 7 Oct, UNTIL 2 Dec.
// "Vendor call": 28 Oct 09:00–09:30 "Pacific Standard Time"; US DST still on until 1 Nov ⇒ PDT, 16:00Z.
// X-WR-CALNAME is "Calendar" (no @), so the RSVP only shows when selfEmails is given.
const RISK_UID = "040000008200E00074C5B7101A82E00800000000D0A1B2C3D4E5F601000000000000" + "000010000000AABBCCDDEEFF00112233445566778899";
const VENDOR_UID = "040000008200E00074C5B7101A82E00800000000E1F2A3B4C5D6E701000000000000" + "000010000000FFEEDDCCBBAA99887766554433221100";
const risk = (d: string, from: string, to: string, rsvp?: string): Expected => ({
  uid: RISK_UID,
  start: `${d}T${from}`,
  end: `${d}T${to}`,
  summary: "Risk forum",
  location: "Microsoft Teams Meeting",
  rsvp,
});
const vendorCall = (from: string, to: string): Expected => ({ uid: VENDOR_UID, start: `2026-10-28T${from}`, end: `2026-10-28T${to}`, summary: "Vendor call (Seattle)" });
day("outlook", OUTLOOK, "2026-10-21", LONDON, [risk("2026-10-21", "10:00", "11:00")]); // BST
day("outlook", OUTLOOK, "2026-10-28", LONDON, [risk("2026-10-28", "10:00", "11:00"), vendorCall("16:00", "16:30")]); // GMT
day("outlook", OUTLOOK, "2026-10-22", LONDON, []);
day("outlook", OUTLOOK, "2026-11-04", LONDON, [risk("2026-11-04", "10:00", "11:00", "accepted")], ["maggie.wang@work.example"]);
//   21 Oct: 10:00 BST = 09:00Z = 05:00 EDT     28 Oct: 10:00 GMT = 10:00Z = 06:00 EDT; vendor 16:00Z = 12:00 EDT
//   04 Nov: 10:00 GMT = 10:00Z = 05:00 EST
day("outlook", OUTLOOK, "2026-10-21", NY, [risk("2026-10-21", "05:00", "06:00")]);
day("outlook", OUTLOOK, "2026-10-28", NY, [risk("2026-10-28", "06:00", "07:00"), vendorCall("12:00", "12:30")]);
day("outlook", OUTLOOK, "2026-11-04", NY, [risk("2026-11-04", "05:00", "06:00")]);

// --- feedEvents: fetching, webcal rewrite, and errors that never leak the URL ----------------
const SECRET = "private-abc123secret";
const QUERY_SECRET = "qs-secret-999";
const googleFeed = `https://calendar.google.com/calendar/ical/maggie%40example.com/${SECRET}/basic.ics`;
const personal: CalendarSource = { id: googleFeed, marker: "🏠 ", label: "personal" };
const unlabelled: CalendarSource = { id: `https://outlook.office365.com/owa/calendar/abc/${SECRET}/reachcalendar.ics?token=${QUERY_SECRET}`, marker: "" };

function noLeak(msg: string, cal: CalendarSource): void {
  ok(!msg.includes(SECRET), `error leaks the secret path segment: ${msg}`);
  ok(!msg.includes(QUERY_SECRET), `error leaks the query string: ${msg}`);
  ok(!msg.includes(cal.id) && !msg.includes(cal.id.replace(/^webcal:/i, "https:")), `error contains the URL: ${msg}`);
}
const named = (msg: string, expected: string) => ok(msg.includes(expected), `error should name the feed as ${expected}: ${msg}`);

const fakeHttp =
  (status: number, text: string, seen: string[] = []): Http =>
  (req: HttpRequest) => {
    seen.push(req.url);
    return Promise.resolve({ status, text });
  };

test("feedEvents 200 + valid feed returns the day's events", async () => {
  const seen: string[] = [];
  events(await feedEvents(fakeHttp(200, MISC, seen), personal, "2026-11-03", LONDON), nov3London);
  sameLines(seen, [googleFeed], "requested URLs", false);
});
test("feedEvents webcal:// is fetched over https://", async () => {
  const seen: string[] = [];
  const cal: CalendarSource = { ...personal, id: googleFeed.replace(/^https:/, "webcal:") };
  events(await feedEvents(fakeHttp(200, RECURRING, seen), cal, "2026-11-04", LONDON), [designReview]);
  sameLines(seen, [googleFeed], "requested URLs", false);
});
test("feedEvents 404 names the feed by label and host, no URL", async () => {
  const msg = await rejects(feedEvents(fakeHttp(404, "Not Found"), personal, "2026-11-03", LONDON));
  named(msg, '"personal" (calendar.google.com)');
  named(msg, "HTTP 404");
  noLeak(msg, personal);
});
test("feedEvents 403 without a label names the host, no path or query", async () => {
  const msg = await rejects(feedEvents(fakeHttp(403, "Forbidden"), unlabelled, "2026-11-03", LONDON));
  named(msg, "outlook.office365.com");
  named(msg, "HTTP 403");
  noLeak(msg, unlabelled);
});
test("feedEvents HTML body (sign-in page) is reported as not iCalendar", async () => {
  const html = "<!DOCTYPE html><html><head><title>Sign in</title></head><body>Sign in to continue</body></html>";
  const msg = await rejects(feedEvents(fakeHttp(200, html), personal, "2026-11-03", LONDON));
  named(msg, "didn't return an iCalendar file");
  named(msg, '"personal" (calendar.google.com)');
  noLeak(msg, personal);
});
test("feedEvents throwing http whose error contains the URL: message doesn't leak it", async () => {
  const throwing: Http = (req) => Promise.reject(new Error(`request to ${req.url} failed, reason: getaddrinfo ENOTFOUND`));
  const msg = await rejects(feedEvents(throwing, personal, "2026-11-03", LONDON));
  named(msg, '"personal" (calendar.google.com)');
  noLeak(msg, personal);
});
test("feedEvents throwing http, unlabelled feed: names the host, no URL", async () => {
  const throwing: Http = (req) => Promise.reject(new Error(`net::ERR_CONNECTION_RESET ${req.url}`));
  const msg = await rejects(feedEvents(throwing, unlabelled, "2026-11-03", LONDON));
  named(msg, "outlook.office365.com");
  noLeak(msg, unlabelled);
});

test("feedEvents reads the user's address from a Google feed URL when the calendar was renamed", async () => {
  const renamed = MISC.replace("X-WR-CALNAME:maggie@example.com", "X-WR-CALNAME:Personal");
  ok(renamed !== MISC, "fixture should contain X-WR-CALNAME:maggie@example.com");
  events(await feedEvents(fakeHttp(200, renamed), personal, "2026-11-03", LONDON), nov3London); // URL holds maggie%40example.com
  const noAddress = parse(renamed, "2026-11-03", LONDON).filter((e) => e.rsvp);
  sameLines(noAddress.map((e) => e.uid), [], "events with rsvp when neither name nor URL gives the address", false);
});
test("feedEvents refuses plain http:// without fetching, no URL in the error", async () => {
  const seen: string[] = [];
  const cal: CalendarSource = { ...personal, id: googleFeed.replace(/^https:/, "http:") };
  const msg = await rejects(feedEvents(fakeHttp(200, MISC, seen), cal, "2026-11-03", LONDON));
  named(msg, "https://");
  noLeak(msg, cal);
  sameLines(seen, [], "requested URLs", false);
});

// --- scheduleMarkdown with feed-only settings --------------------------------------------------
const workFeed = `webcal://calendar.google.com/calendar/ical/maggie.wang%40work.example/${SECRET}/basic.ics`;
const feedOnly: GcalSettings = {
  format: "list",
  credentialsPath: "/nonexistent/credentials.json", // must never be read
  quotaProject: "",
  timeZone: LONDON,
  calendars: [
    { id: googleFeed, marker: "🏠 ", label: "personal" },
    { id: workFeed, marker: "💼 ", label: "work" },
  ],
};
// Serves fixtures by URL; any Google API / OAuth request (i.e. credentials being needed) throws.
const feedOnlyHttp =
  (feeds: Record<string, { status: number; text: string }>): Http =>
  (req) => {
    if (/googleapis\.com/.test(req.url)) return Promise.reject(new Error(`Google API requested in a feed-only setup: ${req.url}`));
    const hit = feeds[req.url];
    return hit ? Promise.resolve(hit) : Promise.reject(new Error(`unexpected request: ${req.url}`));
  };
const servedFeeds = {
  [googleFeed]: { status: 200, text: MISC },
  [workFeed.replace(/^webcal:/, "https:")]: { status: 200, text: WORK },
};

const FOOTER = /^<small>Fetched \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 🏠 personal · 💼 work · ❌ declined<\/small>$/;
function markdown(md: string, expected: string[]): void {
  const lines = md.split("\n");
  const footer = lines.pop() ?? "";
  ok(FOOTER.test(footer), `footer line doesn't match ${FOOTER}: ${footer}`);
  sameLines(lines, expected, "Markdown lines", false);
}

// 3 Nov: planning@google.com is on both calendars at 10:00; personal comes first, so its marker,
// title and ⚠️ win over the work copy's "Planning (work copy)" ✅. The cancelled offsite is skipped.
test("scheduleMarkdown feed-only: no credentials, cross-feed dedupe, declined struck through", async () => {
  markdown(await scheduleMarkdown("2026-11-03", feedOnly, feedOnlyHttp(servedFeeds)), [
    "**All day:** 🏠 Mum's birthday",
    "",
    "- **03:00–03:30** 🏠 Ops check",
    "- **07:00–08:00** 🏠 Gym · PureGym Shoreditch",
    "- **09:00–09:00** 🏠 Reminder: submit expenses",
    "- **10:00–11:00** 🏠 Planning ⚠️ · Room 1.05",
    "- **12:00–12:30** 🏠 Work sync · [Meet](https://meet.google.com/wrk-sync-abc)",
    "- **13:00–14:00** 🏠 Vendor demo · Zoom",
    "- **14:30–15:30** 💼 Fraud model review ✅ · Room 3.02 · [Meet](https://meet.google.com/frd-modl-rev)",
    "- **16:00–17:00** ~~🏠 Optional town hall~~ ❌ · Auditorium · [Meet](https://meet.google.com/twn-hall-now)",
    "",
  ]);
});
test("scheduleMarkdown feed-only: multi-day all-day range", async () => {
  markdown(await scheduleMarkdown("2026-10-23", feedOnly, feedOnlyHttp(servedFeeds)), [
    "**All day:** 🏠 PyData London (21 Oct – 23 Oct) · 🏠 Bin day",
    "",
  ]);
});
test("scheduleMarkdown feed error names the calendar, not the URL", async () => {
  const http = feedOnlyHttp({ ...servedFeeds, [googleFeed]: { status: 404, text: "Not Found" } });
  const msg = await rejects(scheduleMarkdown("2026-11-03", feedOnly, http));
  named(msg, '"personal" (calendar.google.com)');
  noLeak(msg, personal);
});

// ---------------------------------------------------------------------------------------------
// Runner

async function main(): Promise<void> {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.run();
      process.stdout.write(`PASS  ${c.name}\n`);
    } catch (e) {
      failed++;
      const detail = e instanceof Failure ? e.message : `threw: ${e instanceof Error ? e.message : String(e)}`;
      process.stdout.write(`FAIL  ${c.name}\n${detail.replace(/^/gm, "      ")}\n`);
    }
  }
  const summary = `\n${cases.length - failed}/${cases.length} passed, ${failed} failed\n`;
  (failed ? process.stderr : process.stdout).write(summary);
  process.exit(failed ? 1 : 0);
}

main().catch((e: unknown) => {
  process.stderr.write(`check runner crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});

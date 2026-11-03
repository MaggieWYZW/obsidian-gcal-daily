// Shared types. No Obsidian imports, so everything can be exercised from the terminal.

export interface CalendarSource {
  id: string; // a Google calendar ID, or an iCal feed URL (https:// or webcal://)
  marker: string; // prefix for event titles, e.g. "🏠 "
  label?: string; // shown in the footer legend next to the marker, e.g. "personal"
}

export type ScheduleFormat = "list" | "table";

export interface GcalSettings {
  format: ScheduleFormat;
  credentialsPath: string; // blank = gcloud's default location (Google calendar IDs only)
  quotaProject: string; // blank = the quota project saved in the credentials file (Google calendar IDs only)
  timeZone: string;
  includeGmailEvents: boolean; // Google feeds only: keep events Gmail added from emails (the API leaves them out)
  calendars: CalendarSource[];
}

// Minimal HTTP shape so Obsidian's requestUrl and Node's https (smoke test) can both be plugged in.
export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}
export type Http = (req: HttpRequest) => Promise<{ status: number; text: string }>;

/**
 * One event occurrence on the requested day, whichever source it came from.
 * Times are local to the schedule's time zone.
 */
export interface Event {
  uid: string; // iCalUID / UID: the same value from the API and a feed, so the same event dedupes across sources
  allDay: boolean;
  start: string; // all-day: "YYYY-MM-DD"; timed: "YYYY-MM-DDTHH:MM"
  end: string; // all-day: exclusive "YYYY-MM-DD"; timed: "YYYY-MM-DDTHH:MM"
  summary?: string;
  location?: string;
  meetLink?: string;
  rsvp?: string; // the user's response: accepted | tentative | needsAction | declined; absent when there's no invite
  cancelled: boolean;
  fromGmail?: boolean; // looks like an event Gmail added from an email (Google feeds only)
}

// Google Calendar API source, authorised by gcloud's Application Default Credentials.
// Only used for calendar lines that are Google calendar IDs (not feed URLs).
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { Event, GcalSettings, Http } from "./types";

// The fields read from gcloud's credentials file and Google's responses.
interface Credentials {
  type?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  quota_project_id?: string;
}
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface EventTime {
  date?: string; // all-day events
  dateTime?: string; // timed events
}
interface CalEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  location?: string;
  hangoutLink?: string;
  start: EventTime;
  end: EventTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
}
interface EventsResponse {
  items?: CalEvent[];
  nextPageToken?: string;
  error?: { message?: string };
}

const FIX_AUTH =
  "gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/cloud-platform";

/** Where `gcloud auth application-default login` saves its credentials. */
export function defaultCredentialsPath(): string {
  const configDir =
    process.env.CLOUDSDK_CONFIG ??
    (process.platform === "win32" ? join(process.env.APPDATA ?? homedir(), "gcloud") : join(homedir(), ".config", "gcloud"));
  return join(configDir, "application_default_credentials.json");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null; // Not JSON (e.g. an HTML error page); callers fall back to the status code.
  }
}

interface Auth {
  token: string;
  quotaProject: string;
}

// Access tokens last about an hour; keep one in memory rather than refreshing on every fetch.
let cached: { file: string; expires: number; auth: Auth } | undefined;

/**
 * Trade the refresh token in gcloud's Application Default Credentials for a short-lived
 * access token. The credentials are only read from disk and sent to Google's token endpoint.
 */
export async function authenticate(credentialsPath: string, http: Http): Promise<Auth> {
  const file = credentialsPath.trim() || defaultCredentialsPath();
  if (cached && cached.file === file && Date.now() < cached.expires) return cached.auth;

  let creds: Credentials;
  try {
    creds = JSON.parse(await readFile(file, "utf8")) as Credentials;
  } catch {
    throw new Error(`Couldn't read credentials at ${file}. Sign in with: ${FIX_AUTH}`);
  }
  if (creds.type !== "authorized_user" || !creds.refresh_token) {
    throw new Error(`${file} isn't user credentials from gcloud. Sign in with: ${FIX_AUTH}`);
  }

  const res = await http({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.client_id ?? "",
      client_secret: creds.client_secret ?? "",
      refresh_token: creds.refresh_token,
    }).toString(),
  });
  const body = (parseJson(res.text) ?? {}) as TokenResponse;
  if (res.status !== 200 || !body.access_token) {
    const msg = body.error_description ?? body.error ?? `HTTP ${res.status}`;
    throw new Error(`Google sign-in failed: ${msg}. Re-auth with: ${FIX_AUTH}`);
  }

  const auth = { token: body.access_token, quotaProject: creds.quota_project_id ?? "" };
  cached = { file, auth, expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  return auth;
}

/** Request headers for Calendar API calls. Signs in, so only call it when a Google calendar is configured. */
export async function googleHeaders(settings: GcalSettings, http: Http): Promise<Record<string, string>> {
  const auth = await authenticate(settings.credentialsPath, http);
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}` };
  const quotaProject = settings.quotaProject.trim() || auth.quotaProject;
  if (quotaProject) headers["x-goog-user-project"] = quotaProject;
  return headers;
}

/** Events on a Google calendar between timeMin and timeMax, recurring events expanded by Google. */
export async function googleEvents(
  http: Http,
  headers: Record<string, string>,
  calId: string,
  timeMin: string,
  timeMax: string,
  timeZone: string,
): Promise<Event[]> {
  const items: CalEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ timeMin, timeMax, timeZone, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`;
    const res = await http({ url, headers });
    const body = (parseJson(res.text) ?? {}) as EventsResponse;
    if (res.status !== 200) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      const hint = /scope/i.test(msg) ? ` Re-auth with: ${FIX_AUTH}` : "";
      throw new Error(`Calendar API error for ${calId} (${res.status}): ${msg}${hint}`);
    }
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return items.map(toEvent);
}

// dateTime strings come back in the requested timeZone ("2026-11-03T10:00:00Z" / "+01:00"),
// so the first 16 characters are the local date and time.
function toEvent(ev: CalEvent): Event {
  const allDay = Boolean(ev.start.date);
  const me = (ev.attendees ?? []).find((a) => a.self);
  return {
    uid: ev.iCalUID ?? ev.id,
    allDay,
    start: allDay ? ev.start.date ?? "" : (ev.start.dateTime ?? "").slice(0, 16),
    end: allDay ? ev.end.date ?? "" : (ev.end.dateTime ?? "").slice(0, 16),
    summary: ev.summary,
    location: ev.location,
    meetLink: ev.hangoutLink,
    rsvp: me?.responseStatus,
    cancelled: ev.status === "cancelled",
  };
}

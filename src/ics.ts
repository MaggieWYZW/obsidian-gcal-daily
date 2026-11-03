// iCal feed source: a calendar's secret/published .ics URL, no credentials needed.
import { CalendarSource, Event, Http } from "./types";

/** True when a calendar line is a feed URL rather than a Google calendar ID. */
export function isFeed(id: string): boolean {
  return /^(https?|webcal):\/\//i.test(id.trim());
}

/**
 * Fetch a feed and return its event occurrences on `date`.
 * A feed URL is a bearer credential: error messages name the calendar by its label (or host), never the URL.
 */
export async function feedEvents(http: Http, cal: CalendarSource, date: string, timeZone: string): Promise<Event[]> {
  void http;
  void cal;
  void date;
  void timeZone;
  throw new Error("not implemented");
}

/**
 * Parse iCalendar text and return the occurrences overlapping `date` (00:00 to next 00:00 in `timeZone`),
 * with recurring events expanded. Pure: no network, so fixtures can test it.
 */
export function parseFeed(text: string, date: string, timeZone: string): Event[] {
  void text;
  void date;
  void timeZone;
  throw new Error("not implemented");
}

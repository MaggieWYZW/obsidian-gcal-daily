# GCal Daily

Insert a day's Google Calendar schedule into a note. It's designed for daily notes: drop one line into your Templater daily-note template and each new note starts with that day's events.

The schedule is fetched once, when you insert it. It doesn't sync, so the note won't change if your calendar changes later.

## What it inserts

A bullet list (default) or a table, merged from as many calendars as you configure:

```markdown
**All day:** Company offsite (3 Nov – 5 Nov)

- **09:00–09:30** Team stand-up ✅ · [Meet](https://meet.google.com/abc-defg-hij)
- **12:00–13:00** 🏠 Lunch with Sam
- **14:00–15:00** ~~Quarterly planning~~ ❌ · Room 4

<small>Fetched 2026-10-30 08:55 · 🏠 personal · ❌ declined</small>
```

- **All-day events** go on one line at the top. Multi-day ranges are shown in brackets.
- **RSVP status** is shown for events you were invited to: ✅ accepted · ❓ tentative · ⚠️ not responded · ❌ declined. Declined events are struck through.
- **Title markers** (e.g. 🏠) show which calendar an event came from. If an event is on several calendars, it's shown once, using the first calendar listed in your settings.
- **Meet links** and locations are shown after the title.
- **Event titles and locations are escaped.** They come from whoever sent the invite, so the plugin neutralises Markdown, links, tags, HTML and Templater tags before inserting them.

## Requirements

- **Obsidian desktop.** The plugin runs the `gcloud` command-line tool, so it doesn't work on mobile.
- **A Google account** with the calendars you want to read.
- **The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)** (`gcloud`), installed and signed in. See Setup.
- **A Google Cloud project with the Google Calendar API enabled.** API calls count against this project's quota. Reading your calendar this way costs nothing.

## Setup

1. **Enable the Calendar API** in a Google Cloud project you own: [Enable the API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. **Sign in with Calendar read access:**
   ```sh
   gcloud auth application-default login \
     --scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/cloud-platform
   ```
3. **Open the plugin's settings in Obsidian** and set:
   - **Quota project:** the ID of the project from step 1.
   - **gcloud path:** if Obsidian can't find `gcloud`, enter its full path. To find the path, run `which gcloud` on macOS or Linux, or `where gcloud` on Windows.
   - **Calendars:** add one calendar per line (see Settings).

## Usage

**From a Templater daily-note template.** Add this where you want the schedule to appear:

```
<%* tR += await app.plugins.plugins["gcal-daily"].scheduleMarkdown(tp.file.title) %>
```

The date is read from the note title. Any `YYYY-MM-DD` in the title works, e.g. `2026-10-30` or `2026-10-30, Friday`. If the title has no date, the plugin uses today.

**From the command palette.** Run **GCal Daily: Insert schedule for this note's date** to insert the schedule at the cursor. This works well for filling in older notes, or for retrying after a failed fetch.

If a fetch fails, the plugin inserts a warning callout instead of the schedule. The callout says what went wrong and how to retry, so creating the note still succeeds.

## Settings

| Setting | Description | Default |
|---|---|---|
| Format | Bullet list or table. | Bullet list |
| gcloud path | The `gcloud` executable used to get access tokens. | `gcloud` |
| Quota project | The Google Cloud project with the Calendar API enabled. | (empty) |
| Time zone | An IANA time zone name, e.g. `Europe/London`. Sets which hours count as "the day". | Your system time zone |
| Calendars | One calendar per line, as `calendar id, marker, label`. The marker and label are optional. | `primary` |

**Writing calendar lines:**
- **Main calendar:** use `primary`.
- **Other calendars:** find the ID in Google Calendar under **Settings → (calendar) → Integrate calendar → Calendar ID**.
- **Example:**
  ```
  primary
  family123@group.calendar.google.com, 🏠, personal
  ```
  The marker (🏠) is added to the start of event titles from that calendar. If a line has both a marker and a label, the pair (e.g. `🏠 personal`) is added to the footer legend.

## Network use, data access and privacy

This plugin:

- **Connects to the Google Calendar API** (`https://www.googleapis.com/calendar/v3`) to read the events for the requested day from the calendars you list. It doesn't use any other remote service.
- **Accesses files outside your vault, through `gcloud`.** It runs `gcloud auth application-default print-access-token` to get a short-lived access token. `gcloud` reads your Application Default Credentials, which are stored outside the vault (e.g. in `~/.config/gcloud`). The plugin never reads, stores or sends those credentials itself.
- **Requires a Google account and a Google Cloud project,** as described in Requirements.
- **Is read-only.** It requests events only and never changes your calendars.
- **Collects no telemetry and stores no tokens.** A new token is requested on every fetch. Your settings are saved in the plugin's `data.json` inside your vault.

## Known limitations

- **Desktop only.** It's tested on macOS. Windows and Linux should work but haven't been tested.
- **Uses gcloud's own sign-in.** Google has warned that it may stop gcloud's default sign-in from accessing the Calendar API. If that happens, the sign-in in Setup step 2 will fail. A future version may use a dedicated sign-in instead.
- **One-off snapshot.** Re-run the command to refresh the schedule.

## Development

```sh
npm install
npm run build                 # type-check and bundle to main.js
npm run smoke -- 2026-10-30   # print a day's schedule in the terminal, using data.json if present
```

The source is in `src/`. `src/calendar.ts` handles fetching and rendering and has no Obsidian dependencies, which is why the smoke test can run it from the terminal.

## License

[MIT](LICENSE). Not affiliated with Google.

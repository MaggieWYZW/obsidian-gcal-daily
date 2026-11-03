# GCal Daily

☕ **Enjoying GCal Daily?** If it saves you a few minutes each morning, you can [buy me a coffee](https://buymeacoffee.com/magswang) 💛 It keeps me building and fixing things 🛠️✨

Insert a day's calendar schedule into a note. It's designed for daily notes: drop one line into your Templater daily-note template and each new note starts with that day's events.

Calendars can come from two kinds of source, and you can mix them:

- **iCal feed URLs** (simplest): paste a calendar's private `.ics` link from Google Calendar, Outlook / Microsoft 365, iCloud, Fastmail and so on. No sign-in, no Google Cloud project.
- **The Google Calendar API** (advanced): reads Google calendars by ID using `gcloud` credentials. See [Advanced: Google Calendar API](#advanced-google-calendar-api).

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
- **Title markers** (e.g. 🏠) show which calendar an event came from. If an event is on several calendars, it's shown once, using the first calendar listed in your settings. This also applies if the same calendar is listed both as a feed and as a Google calendar ID.
- **Meet links** and locations are shown after the title.
- **Event titles and locations are escaped.** They come from whoever sent the invite, so the plugin neutralises Markdown, links, tags, HTML and Templater tags before inserting them.

The output looks the same whichever source an event came from.

## Requirements

- **Obsidian desktop, version 1.13 or later.**
- **A calendar feed URL** for each calendar you want to read (see below), or the extra setup in [Advanced: Google Calendar API](#advanced-google-calendar-api) if you prefer that route.

## Setup: iCal feed URLs

1. **Copy your calendar's private iCal (`.ics`) link** (see [Finding your feed URL](#finding-your-feed-url)).
2. **Paste it into the plugin's Calendars setting**, one calendar per line, optionally followed by a marker and label:
   ```
   https://calendar.google.com/calendar/ical/…/basic.ics, 🏠, personal
   webcal://example.com/…/rota.ics, 🔄, rota
   ```
   `webcal://` links are fine; they're fetched over `https://`.

That's it. With only feed URLs, the Credentials file and Quota project settings are ignored, and you don't need gcloud or a Google Cloud project.

**Before you paste a link, read [Privacy & security](#privacy--security).** A private feed URL works like a password for that calendar.

### Finding your feed URL

These menus change from time to time, so treat the paths as rough directions.

- **Google Calendar:** on the web, open **Settings** (⚙️), pick the calendar under **Settings for my calendars** on the left, scroll to **Integrate calendar**, and copy **Secret address in iCal format**. It's below the public address and may be hidden until you click it. The right link looks like this:
  ```
  https://calendar.google.com/calendar/ical/you%40gmail.com/private-<long code>/basic.ics
  ```
  Two look-alike links on the same page won't work:
  - **Public address in iCal format** (`…/public/basic.ics`) returns *HTTP 404* unless the calendar is public.
  - **Public URL to this calendar / embed code** (`…/calendar/embed?src=…`) is a web page, not a feed, and returns *HTTP 401*.
- **Outlook / Microsoft 365:** in Outlook on the web, roughly **Settings → Calendar → Shared calendars → Publish a calendar**. Choose the calendar and a level of detail, publish, then copy the **ICS** link.
- **iCloud:** in the Calendar app, share the calendar and turn on **Public Calendar** to get a `webcal://` link. Note that this makes the calendar public to anyone with the link.

**Work accounts:** Google Workspace and Microsoft 365 admins can turn off secret or published calendar addresses, so the option may be missing. Even where it's available, check your organisation's policy before exporting a work calendar through a link.

### How feeds behave

- **Recurring events** are expanded on your computer (using [ical.js](https://github.com/kewisch/ical.js)), including exceptions and moved occurrences.
- **RSVP marks** come from the attendee entry whose address is yours. For Google feeds the address is read from the secret URL itself, so this works even if you've renamed the calendar. For other providers it's read from the calendar's name, so events show no mark if the calendar isn't named after your address. Events you created without inviting anyone never have a mark.
- **Freshness:** the provider may cache the feed, so an edit made in the last few minutes may not show up yet. Re-run the command later if needed.
- **Size:** a feed contains the calendar's full history and is downloaded each time you insert a schedule. Large calendars can take a moment.

## Usage

**From a Templater daily-note template.** Add this where you want the schedule to appear:

```
<%* tR += await app.plugins.plugins["gcal-daily"].scheduleMarkdown(tp.file.title) %>
```

The date is read from the note title. Any `YYYY-MM-DD` in the title works, e.g. `2026-10-30` or `2026-10-30, Friday`. If the title has no date, the plugin uses today.

**From the command palette.** Run **GCal Daily: Insert schedule for this note's date** to insert the schedule at the cursor. This works well for filling in older notes, or for retrying after a failed fetch.

If a fetch fails, the plugin inserts a warning callout instead of the schedule. The callout says what went wrong and how to retry, so creating the note still succeeds. Feed errors name the calendar by its label (or the feed's host name), never by its URL.

## Settings

| Setting | Description | Default |
|---|---|---|
| Format | Bullet list or table. | Bullet list |
| Credentials file | Google calendar IDs only. The file saved by `gcloud auth application-default login`. | gcloud's default location: `~/.config/gcloud/application_default_credentials.json`, or `%APPDATA%\gcloud\…` on Windows |
| Quota project | Google calendar IDs only. The Google Cloud project with the Calendar API enabled. | The quota project saved with your credentials |
| Time zone | An IANA time zone name, e.g. `Europe/London`. Sets which hours count as "the day". | Your system time zone |
| Calendars | One calendar per line, as `calendar, marker, label`. The first field is a feed URL or a Google calendar ID. The marker and label are optional. | `primary` |

**Writing calendar lines:**
- **Feed:** paste the `https://…` or `webcal://…` URL.
- **Google calendar (advanced):** use `primary` for your main calendar, or a calendar ID (Google Calendar: **Settings → (calendar) → Integrate calendar → Calendar ID**).
- **Example:**
  ```
  https://calendar.google.com/calendar/ical/…/basic.ics, 🏠, personal
  https://outlook.office365.com/owa/calendar/…/calendar.ics, 💼, work
  ```
  The marker (🏠) is added to the start of event titles from that calendar. If a line has both a marker and a label, the pair (e.g. `🏠 personal`) is added to the footer legend. Earlier lines win when an event is on several calendars.

## Privacy & security

- **A private feed URL is a key to your calendar.** Anyone who has it can read the calendar, without signing in. Treat it like a password.
- **Where it's stored:** in the plugin's settings file, `.obsidian/plugins/gcal-daily/data.json`, inside your vault. Don't commit that file to a public repository or share it, and think about who can see it if you sync or share your vault.
- **It isn't written into notes.** Error messages name the calendar by its label or host, never the URL.
- **If a URL leaks, reset it.** In Google Calendar: **Settings → (calendar) → Integrate calendar → Reset** next to the secret address, then paste the new URL into the plugin. In Outlook, unpublish and republish the calendar. Old links stop working once reset.
- **Work calendars:** check your organisation's policy first (see [Work accounts](#finding-your-feed-url)).

## Network use, data access and privacy

This plugin:

- **Only connects to the calendars you configure:**
  - **Feed URLs:** it downloads each feed you list, from that feed's host (e.g. `calendar.google.com`, `outlook.office365.com`). Nothing else is sent.
  - **Google calendar IDs (advanced only):** Google's sign-in endpoint (`https://oauth2.googleapis.com/token`), to swap your saved credentials for a short-lived access token, and the Google Calendar API (`https://www.googleapis.com/calendar/v3`), to read the requested day's events. With only feed URLs, neither is contacted.
- **Reads one file outside your vault, only for Google calendar IDs:** the Application Default Credentials file (see [Advanced: Google Calendar API](#advanced-google-calendar-api)). Feed-only setups don't read it.
- **Is read-only.** It requests events only and never changes your calendars.
- **Doesn't run commands or programs on your computer.**
- **Collects no telemetry and stores no tokens.** A Google access token is kept in memory only, until it expires (about an hour). Your settings, including any feed URLs, are saved in the plugin's `data.json` inside your vault.

## Advanced: Google Calendar API

Use this if you'd rather not create feed URLs, or want to read Google calendars by ID. It needs more setup.

### Extra requirements

- **A Google account** with the calendars you want to read.
- **The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)** (`gcloud`). It's only used once, to sign in. The plugin never runs it.
- **A Google Cloud project with the Google Calendar API enabled.** API calls count against this project's quota. Reading your calendar this way costs nothing.

### Setup

1. **Enable the Calendar API** in a Google Cloud project you own: [Enable the API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. **Sign in with Calendar read access:**
   ```sh
   gcloud auth application-default login \
     --scopes=https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/cloud-platform
   ```
3. **Set the quota project** to the project from step 1. Either run `gcloud auth application-default set-quota-project <project-id>`, or enter the project ID in the plugin's **Quota project** setting.
4. **Add your calendars** in the Calendars setting, one per line: `primary` for your main calendar, or a calendar ID. You can mix these with feed URLs.

### How it uses your credentials

- **It reads the Application Default Credentials file** that `gcloud auth application-default login` saves (see the Credentials file setting). It reads the refresh token and client ID from that file and sends them only to Google's sign-in endpoint, to get access tokens. The plugin never writes to the file, copies it, or sends it anywhere else.
- **Why Node's `fs` is used:** Obsidian's vault API can only reach files inside the vault, so the plugin uses Node's `fs` to read this one file. It makes a single read-only call (`readFile`), for the path in the Credentials file setting. It doesn't list, write or delete files, or read anything else.
- **Sign-in happens only when needed:** if no calendar line is a Google calendar ID, the file is never read.

### Limitations

- **Uses gcloud's own sign-in.** Google has warned that it may stop gcloud's default sign-in from accessing the Calendar API. If that happens, the sign-in in step 2 will fail; feed URLs are unaffected.
- **The credentials file is shared with other tools.** Running a plain `gcloud auth application-default login` (e.g. for BigQuery) replaces it without the Calendar scope, and fetches then fail with an "insufficient authentication scopes" error. Repeat step 2 to fix it.

## Known limitations

- **Desktop only.** It's tested on macOS. Windows and Linux should work but haven't been tested.
- **One-off snapshot.** Re-run the command to refresh the schedule.
- **Feed RSVP marks** depend on the feed being named after your address (see [How feeds behave](#how-feeds-behave)).

## Development

```sh
npm install
npm run build                 # type-check and bundle to main.js
npm run smoke -- 2026-10-30   # print a day's schedule in the terminal, using data.json if present
```

The source is in `src/`. `src/calendar.ts` handles fetching and rendering, with the two sources in `src/ics.ts` (feeds) and `src/google.ts` (Google Calendar API). None of these depend on Obsidian, which is why the smoke test can run them from the terminal.

## Third-party code

The plugin bundles [ical.js](https://github.com/kewisch/ical.js) to parse iCal feeds. ical.js is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/) and is included unmodified.

## License

[MIT](LICENSE). Not affiliated with Google, Microsoft or Apple.

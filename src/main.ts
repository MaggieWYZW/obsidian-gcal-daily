import { App, Notice, Plugin, PluginSettingTab, SettingDefinitionItem, requestUrl } from "obsidian";
import { CalendarSource, DEFAULT_SETTINGS, GcalSettings, Http, dateFromTitle, defaultCredentialsPath, scheduleMarkdown } from "./calendar";

const obsidianHttp: Http = async ({ url, method, headers, body }) => {
  const res = await requestUrl({ url, method, headers, body, throw: false });
  return { status: res.status, text: res.text };
};

export default class GcalDailyPlugin extends Plugin {
  settings!: GcalSettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<GcalSettings> | null);
    this.addSettingTab(new GcalSettingTab(this.app, this));

    // Retry / backfill: insert the schedule for the active note's date at the cursor.
    this.addCommand({
      id: "insert-schedule",
      name: "Insert schedule for this note's date",
      editorCallback: async (editor, ctx) => {
        editor.replaceSelection(await this.scheduleMarkdown(ctx.file?.basename));
      },
    });
  }

  /**
   * Public API for Templater:
   *   <%* tR += await app.plugins.plugins["gcal-daily"].scheduleMarkdown(tp.file.title) %>
   * Never throws — on failure returns a warning callout so note creation still succeeds.
   */
  async scheduleMarkdown(titleOrDate?: string): Promise<string> {
    const date = dateFromTitle(titleOrDate);
    try {
      return await scheduleMarkdown(date, this.settings, obsidianHttp);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`GCal Daily: ${msg}`, 10000);
      return `> [!warning] Calendar fetch failed for ${date}\n> ${msg.replace(/\n/g, " ")}\n> Re-run: command palette → "GCal Daily: Insert schedule for this note's date".`;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// Calendars are stored as a list but edited as lines of `id, marker, label`.
function formatCalendars(calendars: CalendarSource[]): string {
  return calendars.map((c) => [c.id, c.marker.trim(), c.label ?? ""].join(", ").replace(/(, )+$/, "")).join("\n");
}

function parseCalendars(text: string): CalendarSource[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, marker = "", label = ""] = l.split(",").map((x) => x.trim());
    return { id, marker: marker ? `${marker} ` : "", label };
  });
}

// Declarative settings (Obsidian 1.13+): Obsidian renders these, indexes them for
// settings search, and reads/writes plugin.settings[key] for each control.
class GcalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GcalDailyPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Format",
        desc: "How the schedule is written into the note.",
        control: { type: "dropdown", key: "format", options: { list: "Bullet list", table: "Table" } },
      },
      {
        name: "Credentials file",
        desc: "Only used for Google calendar IDs, not feed URLs. Saved by `gcloud auth application-default login`. Leave blank for the default location.",
        control: { type: "text", key: "credentialsPath", placeholder: defaultCredentialsPath() },
      },
      {
        name: "Quota project",
        desc: "Only used for Google calendar IDs, not feed URLs. GCP project with the Calendar API enabled; calls count against its quota. Leave blank to use the one saved with your credentials.",
        control: { type: "text", key: "quotaProject" },
      },
      {
        name: "Time zone",
        desc: "IANA name, e.g. Europe/London.",
        control: { type: "text", key: "timeZone", placeholder: DEFAULT_SETTINGS.timeZone, validate: validateTimeZone },
      },
      {
        name: "Calendars",
        desc: "One per line: an iCal feed URL (`https://…` or `webcal://…`) or a Google calendar ID, then optional title marker and legend label, comma-separated (e.g. `https://…/basic.ics, 🏠, personal`). Feed URLs need no credentials; keep them private. Google calendar IDs (e.g. `primary`) need the credentials above. Earlier lines win when an event is on several calendars.",
        // Rendered by hand: the textarea text is parsed into the calendars list, so it can't bind to a key directly.
        render: (setting) => {
          setting.addTextArea((t) => {
            t.inputEl.rows = 5;
            t.inputEl.addClass("gcal-daily-calendars");
            t.setValue(formatCalendars(this.plugin.settings.calendars)).onChange(async (v) => {
              this.plugin.settings.calendars = parseCalendars(v);
              await this.plugin.saveSettings();
            });
          });
        },
      },
    ];
  }
}

function validateTimeZone(value: string): string | void {
  if (!value.trim()) return;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value.trim() });
  } catch {
    return "Not a time zone name. Use an IANA name, e.g. Europe/London.";
  }
}

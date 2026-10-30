import { App, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from "obsidian";
import { DEFAULT_SETTINGS, GcalSettings, Http, dateFromTitle, defaultCredentialsPath, scheduleMarkdown } from "./calendar";

const obsidianHttp: Http = async ({ url, method, headers, body }) => {
  const res = await requestUrl({ url, method, headers, body, throw: false });
  return { status: res.status, json: res.json };
};

export default class GcalDailyPlugin extends Plugin {
  settings!: GcalSettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

class GcalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: GcalDailyPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();

    new Setting(containerEl).setName("Format").setDesc("How the schedule is written into the note.")
      .addDropdown((d) => d.addOption("list", "Bullet list").addOption("table", "Table").setValue(s.format)
        .onChange(async (v) => { s.format = v as GcalSettings["format"]; await save(); }));
    new Setting(containerEl).setName("Credentials file").setDesc("Saved by `gcloud auth application-default login`. Leave blank for the default location.")
      .addText((t) => t.setPlaceholder(defaultCredentialsPath()).setValue(s.credentialsPath)
        .onChange(async (v) => { s.credentialsPath = v.trim(); await save(); }));
    new Setting(containerEl).setName("Quota project").setDesc("GCP project with the Calendar API enabled; calls count against its quota. Leave blank to use the one saved with your credentials.")
      .addText((t) => t.setValue(s.quotaProject).onChange(async (v) => { s.quotaProject = v.trim(); await save(); }));
    new Setting(containerEl).setName("Time zone").setDesc("IANA name, e.g. Europe/London.")
      .addText((t) => t.setValue(s.timeZone).onChange(async (v) => { s.timeZone = v.trim(); await save(); }));
    new Setting(containerEl).setName("Calendars").setDesc("One per line: calendar id, then optional title marker and legend label, comma-separated (e.g. `me@gmail.com, 🏠, personal`). Use `primary` for your main calendar. Earlier lines win when an event is on several calendars.")
      .addTextArea((t) => {
        t.inputEl.rows = 5;
        t.inputEl.addClass("gcal-daily-calendars");
        t.setValue(s.calendars.map((c) => [c.id, c.marker.trim(), c.label ?? ""].join(", ").replace(/(, )+$/, "")).join("\n"))
          .onChange(async (v) => {
            s.calendars = v.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
              const [id, marker = "", label = ""] = l.split(",").map((x) => x.trim());
              return { id, marker: marker ? `${marker} ` : "", label };
            });
            await save();
          });
      });
  }
}

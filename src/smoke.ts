// Terminal check of the calendar logic: `npm run smoke -- 2026-10-30`
// Uses the plugin's saved settings (data.json) when present, else the defaults.
import { existsSync, readFileSync } from "fs";
import { DEFAULT_SETTINGS, HttpGet, dateFromTitle, scheduleMarkdown } from "./calendar";

const nodeHttp: HttpGet = async (url, headers) => {
  const res = await fetch(url, { headers });
  return { status: res.status, json: await res.json() };
};

const saved = existsSync("data.json") ? JSON.parse(readFileSync("data.json", "utf8")) : {};

scheduleMarkdown(dateFromTitle(process.argv[2]), { ...DEFAULT_SETTINGS, ...saved }, nodeHttp)
  .then((md) => console.log(md))
  .catch((e) => {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  });

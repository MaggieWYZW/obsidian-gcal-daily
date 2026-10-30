// Terminal check of the calendar logic: `npm run smoke -- 2026-10-30`
// Uses the plugin's saved settings (data.json) when present, else the defaults.
import { existsSync, readFileSync } from "fs";
import { request } from "https";
import { DEFAULT_SETTINGS, GcalSettings, Http, dateFromTitle, scheduleMarkdown } from "./calendar";

const nodeHttp: Http = ({ url, method = "GET", headers, body }) =>
  new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        let json: unknown = null;
        try {
          json = JSON.parse(data) as unknown;
        } catch {
          // Not JSON (e.g. an HTML error page); callers fall back to the status code.
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });

const saved = (existsSync("data.json") ? JSON.parse(readFileSync("data.json", "utf8")) : {}) as Partial<GcalSettings>;

scheduleMarkdown(dateFromTitle(process.argv[2]), { ...DEFAULT_SETTINGS, ...saved }, nodeHttp)
  .then((md) => process.stdout.write(`${md}\n`))
  .catch((e: unknown) => {
    process.stderr.write(`ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });

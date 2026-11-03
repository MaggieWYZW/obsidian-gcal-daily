import esbuild from "esbuild";
import { builtinModules } from "node:module";

// `node esbuild.config.mjs`        -> main.js for Obsidian
// `node esbuild.config.mjs smoke`  -> smoke.cjs, a terminal test of the calendar logic
// `node esbuild.config.mjs check`  -> check.cjs, the fixture-based tests for iCal feeds
const mode = process.argv[2];
const terminal = { smoke: "smoke", check: "check" }[mode];

await esbuild.build({
  entryPoints: [terminal ? `src/${terminal}.ts` : "src/main.ts"],
  outfile: terminal ? `${terminal}.cjs` : "main.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  // ical.js is MPL-2.0: say where its source is, since minifying drops its comments.
  banner: { js: "/* Bundles ical.js (MPL-2.0), source: https://github.com/kewisch/ical.js */" },
  minify: !terminal, // smaller main.js for users; terminal builds stay readable
  logLevel: "info",
});

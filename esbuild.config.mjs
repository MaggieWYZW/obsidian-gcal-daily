import esbuild from "esbuild";
import builtins from "builtin-modules";

// `node esbuild.config.mjs`        -> main.js for Obsidian
// `node esbuild.config.mjs smoke`  -> smoke.cjs, a terminal test of the calendar logic
const smoke = process.argv[2] === "smoke";

await esbuild.build({
  entryPoints: [smoke ? "src/smoke.ts" : "src/main.ts"],
  outfile: smoke ? "smoke.cjs" : "main.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2020",
  external: ["obsidian", "electron", ...builtins],
  logLevel: "info",
});

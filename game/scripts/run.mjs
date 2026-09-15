import { spawn } from "node:child_process";
process.env.WRANGLER_LOG_PATH ||= ".wrangler/wrangler.log";
// The production bundle imports cloudflare:workers and must run in workerd,
// not vinext's Node-only production server.
const isPreview = process.argv[2] === "start";
const previewArgs = process.argv.slice(3).map(arg => arg === "--hostname" ? "--ip" : arg);
const command = isPreview
  ? ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--config", "dist/server/wrangler.json", ...(!previewArgs.includes("--port") ? ["--port", "3000"] : []), ...previewArgs]
  : ["node_modules/vinext/dist/cli.js", ...process.argv.slice(2)];
const child = spawn(
  process.execPath,
  command,
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

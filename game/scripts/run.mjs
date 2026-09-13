import { spawn } from "node:child_process";
import { prepareLocalDatabase } from "./init-db.mjs";
process.env.WRANGLER_LOG_PATH ||= ".wrangler/wrangler.log";
if (["dev", "start"].includes(process.argv[2])) await prepareLocalDatabase();
const child = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

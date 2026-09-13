import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Provision only the local simulator; Sites provisions production D1. */
export async function prepareLocalDatabase() {
  await mkdir(".wrangler", { recursive: true });
  const configPath = resolve(".wrangler/local-config.json");
  const schemaPath = resolve(".wrangler/local-schema.sql");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "draw-derby-local",
      compatibility_date: "2026-05-15",
      main: resolve("worker/index.ts"),
      d1_databases: [
        {
          binding: "DB",
          database_name: "draw-derby-local",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
    }),
  );
  const migration = await readFile("drizzle/0000_outstanding_loki.sql", "utf8");
  await writeFile(
    schemaPath,
    migration
      .replace(/CREATE TABLE /g, "CREATE TABLE IF NOT EXISTS ")
      .replace(/CREATE INDEX /g, "CREATE INDEX IF NOT EXISTS "),
  );
  await promisify(execFile)(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      resolve(".wrangler/state"),
      "--file",
      schemaPath,
    ],
    {
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: resolve(".wrangler/wrangler.log"),
      },
      timeout: 30000,
      windowsHide: true,
    },
  );
}

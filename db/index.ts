import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getRoomDatabase() {
  if (!env.DB) throw new Error('레이스 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  return env.DB;
}

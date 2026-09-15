/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    RACE_ROOMS: DurableObjectNamespace;
    ASSETS: Fetcher;
  }
}

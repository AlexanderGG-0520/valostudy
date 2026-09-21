import { cp } from "node:fs/promises";
import { URL } from "node:url";
// Next standalone deliberately omits static assets; include them for pnpm start.
await cp(new URL("../.next/static", import.meta.url),
  new URL("../.next/standalone/apps/web/.next/static", import.meta.url), { recursive: true });

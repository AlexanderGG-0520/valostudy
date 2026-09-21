import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
export * from "./schema";
export { and, eq, inArray, asc, desc, gte, isNull, sql } from "drizzle-orm";

let instance: ReturnType<typeof connect> | undefined;

function connect() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = postgres(process.env.DATABASE_URL, { max: 10 });
  return drizzle(client, { schema });
}

export function db() {
  return instance ??= connect();
}

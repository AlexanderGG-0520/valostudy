import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const client = postgres(process.env.DATABASE_URL, { max: 1 });
try { await migrate(drizzle(client), { migrationsFolder: new URL("../migrations", import.meta.url).pathname }); }
finally { await client.end(); }

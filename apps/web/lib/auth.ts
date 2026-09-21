import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification } from "@valostudy/db";
import { config } from "@valostudy/config";
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
    const c = config();
    return betterAuth({
      database: drizzleAdapter(db(), { provider: "pg", schema: { user, session, account, verification } }),
      baseURL: c.BETTER_AUTH_URL, secret: c.BETTER_AUTH_SECRET,
      emailAndPassword: { enabled: true, minPasswordLength: 12 },
      rateLimit: { enabled: true },
    });
}
export function auth() { return instance ??= createAuth(); }

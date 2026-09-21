import { betterAuth } from "better-auth";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification, passkey } from "@valostudy/db";
import { config } from "@valostudy/config";

let instance: ReturnType<typeof createAuth> | undefined;

function createAuth() {
  const c = config();
  return betterAuth({
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user, session, account, verification, passkey },
    }),
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    plugins: [passkeyPlugin({ rpName: "VALOSTUDY" })],
    // E2E creates several accounts from the same loopback IP in a few seconds.
    // Keep production throttling enabled while avoiding unrelated signup flakes in the isolated test runner.
    rateLimit: { enabled: !process.env.E2E_RUN_ID },
  });
}

export function auth() {
  return instance ??= createAuth();
}

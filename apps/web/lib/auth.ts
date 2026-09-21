import { betterAuth } from "better-auth";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification, passkey } from "@valostudy/db";
import { config } from "@valostudy/config";
import { assertEmailConfiguration, sendVerificationEmailDetached } from "./email";

let instance: ReturnType<typeof createAuth> | undefined;

function createAuth() {
  const c = config();
  const requireEmailVerification = !process.env.E2E_RUN_ID;
  if (requireEmailVerification) assertEmailConfiguration();
  return betterAuth({
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user, session, account, verification, passkey },
    }),
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        sendVerificationEmailDetached(user.email, url);
      },
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification,
    },
    plugins: [passkeyPlugin({ rpName: "VALOSTUDY" })],
    // E2E creates several accounts from the same loopback IP in a few seconds.
    // Keep production throttling enabled while avoiding unrelated signup flakes in the isolated test runner.
    rateLimit: { enabled: !process.env.E2E_RUN_ID },
  });
}

export function auth() {
  return instance ??= createAuth();
}

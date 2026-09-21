import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { db, user, session, account, verification, passkey } from "@valostudy/db";
import { config } from "@valostudy/config";
import { sendVerificationEmail } from "./email";

let instance: ReturnType<typeof createAuth> | undefined;

function createAuth() {
  const c = config();
  const e2e = Boolean(process.env.E2E_RUN_ID);
  return betterAuth({
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user, session, account, verification, passkey },
    }),
    baseURL: c.BETTER_AUTH_URL,
    secret: c.BETTER_AUTH_SECRET,
    emailVerification: {
      sendOnSignUp: !e2e,
      sendOnSignIn: !e2e,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user.email, url);
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: !e2e,
    },
    plugins: [passkeyPlugin()],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const terms = ctx.headers?.get("x-valostudy-terms-accepted");
        const privacy = ctx.headers?.get("x-valostudy-privacy-accepted");
        if (terms !== "2026-09-22" || privacy !== "2026-09-22") {
          throw new APIError("BAD_REQUEST", {
            message: "利用規約とプライバシーポリシーへの同意が必要です",
          });
        }
      }),
    },
    // E2E creates several accounts from the same loopback IP in a few seconds.
    // Keep production throttling enabled while avoiding unrelated signup flakes in the isolated test runner.
    rateLimit: { enabled: !process.env.E2E_RUN_ID },
  });
}

export function auth() {
  return instance ??= createAuth();
}

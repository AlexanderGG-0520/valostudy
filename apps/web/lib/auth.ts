import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { passkey as passkeyPlugin } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification, passkey } from "@valostudy/db";
import { config } from "@valostudy/config";
import { assertEmailConfiguration, sendVerificationEmail } from "./email";

const LEGAL_VERSION = "2026-09-22";

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
    user: {
      additionalFields: {
        termsAccepted: { type: "boolean", required: true },
        privacyAccepted: { type: "boolean", required: true },
        legalAcceptedAt: { type: "date", required: false, input: false, returned: false },
        legalVersion: { type: "string", required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        if (ctx.body?.termsAccepted !== true || ctx.body?.privacyAccepted !== true) {
          throw new APIError("BAD_REQUEST", {
            message: "利用規約とプライバシーポリシーへの同意が必要です",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser, ctx) => {
            if (ctx?.path !== "/sign-up/email") return;
            return {
              data: {
                ...newUser,
                legalAcceptedAt: new Date(),
                legalVersion: LEGAL_VERSION,
              },
            };
          },
        },
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user.email, url);
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

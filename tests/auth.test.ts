import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const state = vi.hoisted(() => ({ database: undefined as unknown }));

vi.mock("@valostudy/db", async (original) => ({
  ...await original<typeof import("@valostudy/db")>(),
  db: () => state.database,
}));

vi.mock("@valostudy/config", () => ({
  config: () => ({
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  }),
  log: vi.fn(),
}));

import { auth } from "../apps/web/lib/auth";
import * as schema from "@valostudy/db/schema";

let pg: PGlite;

beforeAll(async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "VALOSTUDY <auth@example.test>";
  pg = new PGlite();
  const directory = new URL("../packages/db/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(file, directory), "utf8"));
  state.database = drizzle(pg, { schema });
}, 30000);

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  await pg.close();
});

it("requires email verification before password login, then authenticates and signs out", async () => {
  const password = randomBytes(20).toString("hex");
  let verificationUrl = "";

  const mail = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text?: string };
    verificationUrl = body.text?.match(/https?:\/\/\S+/)?.[0] ?? "";
    return new Response(JSON.stringify({ id: "email_test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const request = (path: string, body: unknown, cookie = "") => new Request("http://localhost:3000/api/auth/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
    body: JSON.stringify(body),
  });

  const signup = await auth().handler(request("sign-up/email", {
    name: "Player",
    email: "player@example.test",
    password,
    callbackURL: "/account",
  }));
  expect(signup.status).toBe(200);
  expect(signup.headers.getSetCookie().join(";")).not.toContain("session_token");
  await vi.waitFor(() => expect(verificationUrl).toMatch(/^http:\/\/localhost:3000\/api\/auth\/verify-email/));
  expect(mail).toHaveBeenCalledTimes(1);

  const unverified = await auth().handler(request("sign-in/email", {
    email: "player@example.test",
    password,
  }));
  expect(unverified.status).toBe(403);

  const verify = await auth().handler(new Request(verificationUrl, { method: "GET" }));
  expect([302, 303, 307]).toContain(verify.status);

  const signin = await auth().handler(request("sign-in/email", {
    email: "player@example.test",
    password,
  }));
  expect(signin.status).toBe(200);
  const cookie = signin.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  expect(cookie).toContain("session_token");

  const session = await auth().api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user.email).toBe("player@example.test");
  expect(session?.user.emailVerified).toBe(true);

  const rejected = await auth().handler(request("sign-in/email", {
    email: "player@example.test",
    password: "incorrect-password",
  }));
  expect(rejected.status).toBe(401);

  const signedOut = await auth().handler(request("sign-out", {}, cookie));
  expect(signedOut.status).toBe(200);
  expect(await auth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();

  mail.mockRestore();
});

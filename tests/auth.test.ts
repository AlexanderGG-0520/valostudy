import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const state = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock("@valostudy/db", async (original) => ({
  ...await original<typeof import("@valostudy/db")>(), db: () => state.database,
}));
vi.mock("@valostudy/config", () => ({ config: () => ({
  BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
}) }));
import { auth } from "../apps/web/lib/auth";
import * as schema from "@valostudy/db/schema";
import { eq } from "@valostudy/db";
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  const directory = new URL("../packages/db/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(file, directory), "utf8"));
  state.database = drizzle(pg, { schema });
}, 30000);
afterAll(async () => { await pg.close(); });
it("registers, authenticates a session, rejects bad credentials and signs out", async () => {
  const password = randomBytes(20).toString("hex");
  const request = (path: string, body: unknown, cookie = "") => new Request("http://localhost:3000/api/auth/" + path, {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie, "x-valostudy-terms-accepted": "2026-09-22", "x-valostudy-privacy-accepted": "2026-09-22" },
    body: JSON.stringify(body),
  });
  const signup = await auth().handler(request("sign-up/email", { name: "Player", email: "player@example.test", password }));
  expect(signup.status).toBe(200);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  expect(cookie).not.toContain("session_token");
  expect(await auth().api.getSession({ headers: new Headers({ cookie }) })).toBeNull();

  const unverified = await auth().handler(request("sign-in/email", { email: "player@example.test", password }));
  expect(unverified.status).toBe(403);

  await (state.database as ReturnType<typeof drizzle>).update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, "player@example.test"));
  const rejected = await auth().handler(request("sign-in/email", { email: "player@example.test", password: "incorrect-password" }));
  expect(rejected.status).toBe(401);
  const signedIn = await auth().handler(request("sign-in/email", { email: "player@example.test", password }));
  expect(signedIn.status).toBe(200);
  const sessionCookie = signedIn.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  expect(sessionCookie).toContain("session_token");
  const session = await auth().api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
  expect(session?.user.email).toBe("player@example.test");
  const signedOut = await auth().handler(request("sign-out", {}, sessionCookie));
  expect(signedOut.status).toBe(200);
  expect(await auth().api.getSession({ headers: new Headers({ cookie: sessionCookie }) })).toBeNull();
});

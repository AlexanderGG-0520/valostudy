import { defineConfig } from "@playwright/test";
if (!process.env.E2E_RUN_ID || !process.env.E2E_ARTIFACT_DIR)
  throw new Error("Use pnpm test:e2e; the runner creates an isolated environment.");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  outputDir: process.env.E2E_ARTIFACT_DIR + "/playwright",
  use: {
    baseURL: process.env.BETTER_AUTH_URL,
    browserName: "chromium",
    // Traces/HAR contain signed storage URLs and auth cookies. Do not record them.
    trace: "off",
    screenshot: "only-on-failure",
  },
});

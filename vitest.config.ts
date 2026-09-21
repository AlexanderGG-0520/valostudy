import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: {
    "next/headers": new URL("./apps/web/node_modules/next/headers.js", import.meta.url).pathname,
    "next/navigation": new URL("./apps/web/node_modules/next/navigation.js", import.meta.url).pathname,
  } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});

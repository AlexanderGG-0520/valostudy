import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@valostudy/schema", "@valostudy/config", "@valostudy/db", "@valostudy/prompts", "@valostudy/storage"],
  experimental: { cpus: 2 },
};
export default config;

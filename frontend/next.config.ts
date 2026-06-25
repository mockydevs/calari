import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// Load the single repo-root `.env` shared with the Django backend, so local dev
// uses one env file instead of one per app. Production injects env directly and
// does not evaluate this at runtime.
loadEnvConfig(resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

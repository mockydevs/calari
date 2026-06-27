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
  // CI (.github/workflows/ci.yml) already runs `tsc --noEmit` + eslint as gates, so the
  // production build doesn't need to repeat the ~1 min in-build TypeScript pass — skipping
  // it cuts build time + memory on the deploy host, reducing the OOM/255 failures seen when
  // the frontend is rebuilt. (Next 16's build no longer runs ESLint, so no eslint key needed.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

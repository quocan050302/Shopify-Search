import type { NextConfig } from "next";
import { execSync } from "child_process";

function resolveCompileTimeGitSha(): string {
  if (process.env.SWAI_BUILD_SHA) return process.env.SWAI_BUILD_SHA;
  if (process.env.GIT_COMMIT_SHA) return process.env.GIT_COMMIT_SHA;
  if (process.env.NEXT_PUBLIC_GIT_COMMIT_SHA) return process.env.NEXT_PUBLIC_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    return "unknown";
  }
}

const compileTimeSha = resolveCompileTimeGitSha();
const compileTimeTimestamp = process.env.BUILD_TIMESTAMP || new Date().toISOString();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    NEXT_PUBLIC_SWAI_RELEASE_VERSION: "12.4.3.4.6",
    NEXT_PUBLIC_SWAI_FRONTEND_BUILD_SHA: compileTimeSha,
    NEXT_PUBLIC_BUILD_TIMESTAMP: compileTimeTimestamp,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

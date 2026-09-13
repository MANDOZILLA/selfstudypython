import type { NextConfig } from "next";
import { isAbsolute } from "node:path";

function runtimeDatabaseTraceExcludes(value: string | undefined) {
  if (!value || !isAbsolute(value) || /[%?#\0]/.test(value) || value.replace(/^[a-z]:/i, "").includes(":") || /^(?:\\\\|\/\/|file:|https?:|libsql:)/i.test(value) || !/\.db$/i.test(value)) return [];
  const path = value.replaceAll("\\", "/");
  return [path, `${path}-wal`, `${path}-shm`];
}

const nextConfig: NextConfig = {
  distDir: process.env.CODING_SCHOOL_BUILD_DIR || ".next",
  // Learner data is created at runtime. It must never be copied with a build.
  outputFileTracingExcludes: {
    "/*": [".data/**", ...runtimeDatabaseTraceExcludes(process.env.CODING_SCHOOL_DB_PATH)],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CODING_SCHOOL_BUILD_DIR || ".next",
};

export default nextConfig;

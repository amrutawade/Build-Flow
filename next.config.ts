import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["sharp"],
  transpilePackages: ["three"],
};

export default nextConfig;

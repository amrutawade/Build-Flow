
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: __dirname,
  transpilePackages: ["three"],

  images: {
    unoptimized: true,
  },

  trailingSlash: true,
};

export default nextConfig;

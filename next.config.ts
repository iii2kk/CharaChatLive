import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: false,
  },
  experimental: {
    mcpServer: false,
  },
  transpilePackages: ["three"],
};

export default nextConfig;

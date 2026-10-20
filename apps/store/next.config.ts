import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  transpilePackages: ["@kitabee/core", "@kitabee/pdf-engine"],
  images: {
    remotePatterns: [
      { hostname: "*.supabase.co" },
      { hostname: "replicate.delivery" },
    ],
  },
};

export default nextConfig;

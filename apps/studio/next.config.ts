import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  transpilePackages: ["@kitabee/core", "@kitabee/pdf-engine"],
  // pdf.ts reads the GRACoL2006 ICC profile via fs.readFileSync at a
  // source-relative path -- standalone output only bundles files its tracer
  // can detect are needed, so this guarantees the binary asset survives.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/color-profiles/**"],
  },
  images: {
    remotePatterns: [
      { hostname: "*.supabase.co" },
      { hostname: "replicate.delivery" },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The read-only analytics database is read at runtime by the API routes, the
  // records pages and the CSV export; make sure it ships with every function.
  // content/ holds the markdown docs rendered on /methods.
  outputFileTracingIncludes: {
    "/": ["./data/analytics.db"],
    "/**": ["./data/analytics.db", "./content/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              // the AI providers are called directly from the visitor's browser with their own key
              "connect-src 'self' https://tiles.openfreemap.org https://vercel.live https://api.anthropic.com https://api.openai.com",
              "img-src 'self' data: blob: https://tiles.openfreemap.org",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;

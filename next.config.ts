import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `typedRoutes` is stable in Next.js 16; it is no longer read from `experimental`.
  typedRoutes: false,
  // The dev server is sometimes opened through 127.0.0.1 instead of localhost.
  // Without this allow-list Next.js blocks its dev resources on that origin and
  // the page ships without hydration (buttons/forms do nothing until a reload
  // on `localhost`).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" }
        ]
      }
    ];
  }
};

export default nextConfig;

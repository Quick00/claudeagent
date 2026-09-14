import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // These run before the proxy and before rendering, so an old URL never
  // reaches the shell layout's session query.
  async redirects() {
    return [
      // Root may be repurposed later, so avoid a permanently cached 308.
      { source: "/", destination: "/chat", permanent: false },
      { source: "/conversation/:id", destination: "/chat/:id", permanent: true },
      { source: "/dashboard", destination: "/knowledge/dashboard", permanent: true },
      // Exact match only: the new nested /knowledge/* routes are unaffected.
      { source: "/knowledge", destination: "/knowledge/map", permanent: true },
      { source: "/admin", destination: "/admin/users", permanent: false },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
});

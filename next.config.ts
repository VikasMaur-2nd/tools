import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Non-script directives only: Next.js injects inline scripts, so no script-src here.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

// PostHog ingestion host (https://us.i.posthog.com or https://eu.i.posthog.com). The browser
// never talks to it directly: /relay on this origin is rewritten to it (see lib/analytics).
const posthogHost = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "").replace(/\/$/, "");
const posthogAssets = posthogHost.replace(/^https:\/\/(us|eu)\.i\.posthog\.com$/, "https://$1-assets.i.posthog.com");

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // PostHog's API paths end in a slash (/relay/e/, /relay/flags/), which Next.js would
  // otherwise redirect away; the redirect below keeps doing that for every other path.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    if (!posthogHost) return [];
    return {
      beforeFiles: [
        { source: "/relay/static/:path*", destination: `${posthogAssets}/static/:path*` },
        { source: "/relay/array/:path*", destination: `${posthogAssets}/array/:path*` },
        { source: "/relay/:path*", destination: `${posthogHost}/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // The blog lives at /blogs; send the common singular spelling there too.
  async redirects() {
    return [
      // What Next.js does by default (skipTrailingSlashRedirect turns it off): /about/ → /about.
      { source: "/:path((?!relay/).+)/", destination: "/:path", permanent: true },
      { source: "/blog", destination: "/blogs", permanent: true },
      { source: "/blog/:slug", destination: "/blogs/:slug", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The viewer receives big documents from the site that opened its tab ("View in Tool
      // Kumar", lib/link.ts): only possible while that site keeps its window handle.
      { source: "/", headers: [{ key: "Cross-Origin-Opener-Policy", value: "unsafe-none" }] },
      // The "View in Tool Kumar" kit other sites embed: readable from any origin, and cached
      // for a day (not `immutable`: the URLs are stable, so updates must reach them).
      ...["/toolkumar.js", "/badges/:file*"].map((source) => ({
        source,
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      })),
      {
        // Always revalidate the service worker so new versions roll out immediately.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      // Manifest icons in public/ are not content-hashed, so cache them for a
      // week (not `immutable`) and serve stale while revalidating after that.
      ...["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      })),
    ];
  },
};

// Build-only credentials upload our source maps so sanitized code coordinates
// resolve to readable stacks. They are never included in the browser bundle.
const uploadSourceMaps = Boolean(process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID);
export default uploadSourceMaps ? withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_API_KEY!,
  projectId: process.env.POSTHOG_PROJECT_ID!,
  host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || (posthogHost || "https://us.i.posthog.com").replace(/\/(us|eu)\.i\./, "/$1."),
  sourcemaps: { enabled: true, deleteAfterUpload: true },
}) : nextConfig;

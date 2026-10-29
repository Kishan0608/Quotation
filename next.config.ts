import type { NextConfig } from "next";

// The Content-Security-Policy (with a per-request nonce) is set in src/proxy.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Every page is per-user and needs a per-request CSP nonce, so pages are
  // rendered dynamically; Cache Components (partial prerendering) is disabled.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // Run in plain Node: exceljs, the PDF reader, the OCR engine (it starts worker threads) and the
  // image tools used to clean up photos and to turn scanned PDF pages into pictures.
  serverExternalPackages: ["exceljs", "unpdf", "tesseract.js", "sharp", "@napi-rs/canvas"],
  experimental: {
    serverActions: {
      // Excel imports send up to 2,000 validated rows in one action.
      bodySizeLimit: "2mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

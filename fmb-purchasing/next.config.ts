import type { NextConfig } from "next";

/**
 * Response headers.
 *
 * None of these were set. Individually each is a small thing; together they
 * are the difference between a browser enforcing this app's assumptions and
 * merely hoping for them.
 *
 * The app is entirely private — accounts are admin-created, there is no
 * self-signup and no public page — so it should also never appear in a search
 * result. `X-Robots-Tag` covers that for every response, including the login
 * page, which is the only one a crawler could otherwise reach.
 */
const SECURITY_HEADERS = [
  // Nothing here is ever meant to be framed. Clickjacking a page whose buttons
  // approve payments is worth ruling out explicitly.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrers leak expense ids in paths like /expenses/<uuid>. Same-origin
  // navigation still sends the full path; anything cross-origin gets the
  // origin only.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app asks for none of these, so no page should be able to.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  // Two years, so the domain can be preloaded later if wanted. Vercel already
  // redirects to HTTPS; this stops the first request of a session being made
  // in the clear at all.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/**
 * Content Security Policy.
 *
 * `unsafe-inline` and `unsafe-eval` on scripts are Next's requirement rather
 * than a choice: the framework inlines its bootstrap and hydration payloads.
 * Tightening that needs per-request nonces, which means moving CSP into the
 * proxy — worth doing, but it is a change to how every page is served and does
 * not belong in the same commit as the rest of these.
 *
 * Everything else is closed: no plugins, no framing, no form posts off-site,
 * and images and fonts limited to what the app actually loads — its own
 * assets, Supabase-signed receipt URLs, and Google Fonts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // blob: is the PDF viewer rendering pages to canvas; https: covers the
  // signed storage URLs, which carry a per-request host.
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co https://*.supabase.in",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: CSP }],
      },
    ];
  },

  experimental: {
    // Server Actions cap request bodies at 1MB by default, and receipts are
    // uploaded through one. A PDF forwarded from email sits well under that
    // (the ones tested were 73KB and 160KB), but a photo taken on a phone is
    // routinely 2-5MB — so the cap threw a server error the moment anyone
    // photographed a receipt instead of forwarding one.
    //
    // Not raised further because the host imposes its own request body limit
    // that this cannot exceed, and the limit also covers multipart boundary
    // and header overhead on top of the file itself. The client downscales
    // images before sending (lib/image-resize.ts) so real uploads land far
    // below this rather than relying on the ceiling.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;

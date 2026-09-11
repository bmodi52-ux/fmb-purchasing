"use client";

import "./globals.css";

/**
 * The last resort: an error in the root layout itself, which the per-segment
 * boundary cannot catch because it sits above it.
 *
 * This replaces the root layout when it renders, so it has to supply its own
 * <html> and <body>. That also means none of the app's fonts are loaded here —
 * the next/font variables are declared in the layout that just failed — so the
 * type falls back to a system stack on purpose rather than by omission. Colours
 * come from globals.css, which is imported directly for the same reason.
 *
 * Deliberately plainer than the in-app boundary. If the root layout is broken
 * then the session, the navigation and the permission fetch are all suspect,
 * so this offers a reload and nothing that depends on any of them — no links
 * into the app, no sign-out form.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          backgroundColor: "#FBF6EC",
          color: "#2B211C",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <title>Something went wrong — FMB Sydney</title>
        <main style={{ maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.8rem",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#8A7B6C",
            }}
          >
            FMB Sydney
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.5rem", letterSpacing: "-0.02em" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0.75rem 0 1.5rem", lineHeight: 1.6, color: "rgb(43 33 28 / 0.7)" }}>
            The site failed to load. This is usually temporary. Nothing you submitted has been lost —
            reloading will normally fix it.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              border: "none",
              borderRadius: "0.375rem",
              backgroundColor: "#D89C24",
              color: "#2B211C",
              padding: "0.6rem 1.1rem",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "rgb(43 33 28 / 0.45)" }}>
              Reference: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}

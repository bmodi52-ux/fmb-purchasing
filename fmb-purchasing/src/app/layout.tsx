import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, IBM_Plex_Mono, Amiri } from "next/font/google";
import "./globals.css";
import { SandboxBanner } from "@/components/sandbox-banner";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  /**
   * Every page names itself in the tab.
   *
   * Without the template each route inherited this one string, so anyone
   * working across My submissions, Vendors and Pricelist at once had three
   * tabs reading "FMB Sydney" and had to open each to tell them apart — which
   * is most of the reason to have tabs at all. The page name leads because a
   * tab is truncated from the right.
   */
  title: {
    template: "%s · FMB Sydney",
    default: "FMB Sydney",
  },
  description: "Expense submission, approval and reporting for FMB.",
  // Named here as well as in the manifest: iOS reads this one when the site is
  // added to a home screen, and ignores the manifest's short_name.
  appleWebApp: { capable: true, title: "FMB Purchasing", statusBarStyle: "default" },
};

/**
 * Tints the browser chrome to the brand gold on Android, and stops the page
 * being zoomable-but-unusable on a phone by pinning the initial scale without
 * locking out zoom entirely — receipts get squinted at, so pinch must work.
 */
export const viewport: Viewport = {
  themeColor: "#D89C24",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} ${amiri.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-cream text-ink font-sans">
        <SandboxBanner />
        {children}
      </body>
    </html>
  );
}

import type { MetadataRoute } from "next";

/**
 * Makes the site installable to a phone's home screen.
 *
 * This is a phone-first tool. The whole flow starts with someone standing in a
 * supplier's car park photographing a receipt, and until now the only way to
 * reach it was to find a browser, find a tab, and type or hunt for the URL.
 * An icon on the home screen and a window with no address bar is a small piece
 * of work that changes how often that gets done at the till rather than
 * remembered later.
 *
 * `standalone` rather than `fullscreen`: the status bar carries the clock and
 * the battery, and the app is not a game.
 *
 * `start_url: "/"` deliberately, not "/submit". Most opens are to check on
 * something already sent, and the dashboard is one tap from submitting anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FMB Sydney — Purchasing",
    short_name: "FMB Purchasing",
    description:
      "Submit receipts, track approvals and record payments for Faiz ul Mawaid il Burhaniyah, Sydney.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Cream and gold, from the crest — so the splash screen and the browser
    // chrome match the app rather than flashing white before it loads.
    background_color: "#FBF6EC",
    theme_color: "#D89C24",
    lang: "en-AU",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/fmb-logo.png",
        // The real size of the file. Chrome needs at least 192px to offer
        // installation, so 400 qualifies; a 512px version would give a
        // sharper Android splash screen, and is worth adding if anyone has
        // the crest at that size.
        sizes: "400x400",
        type: "image/png",
        // Not "maskable": the crest has detail close to its edge, and a
        // launcher cropping it to a circle would cut into the design.
        purpose: "any",
      },
    ],
  };
}

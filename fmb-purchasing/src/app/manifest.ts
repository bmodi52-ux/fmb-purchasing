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
    name: "Mashk · FMB Sydney",
    short_name: "Mashk",
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
    // 192 and 512 (#53). With only the 400px crest, Chrome on Android added
    // the site as a shortcut rather than installing it as an app (a WebAPK),
    // and a shortcut's notifications come from Chrome, headed by the site's
    // address. An installed app's are headed by its own name. Made from the
    // 400px crest, so the 512 is a slight upscale.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The crest has detail close to its edge, so the maskable one sits on
      // cream inside the safe zone: a launcher cropping to a circle takes
      // background, not design.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

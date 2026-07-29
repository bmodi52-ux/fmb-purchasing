/**
 * Teaches Node's module resolver the "@/" alias that tsconfig.json declares
 * and Next.js honours at build time. Node reads neither, so without this a
 * test importing anything that itself imports "@/..." fails to resolve.
 *
 * Loaded via --import from the "test" script; not part of the app bundle.
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC_URL = pathToFileURL(path.join(import.meta.dirname, "..", "src", "/")).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(specifier.slice(2), SRC_URL).href, context);
    }
    return nextResolve(specifier, context);
  },
});

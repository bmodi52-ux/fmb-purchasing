/**
 * Teaches Node's module resolver two things TypeScript and Next.js take for
 * granted and Node does not:
 *
 *   1. The "@/" alias that tsconfig.json declares. Node reads neither
 *      tsconfig nor Next's config, so without this a test importing anything
 *      that itself imports "@/..." fails to resolve.
 *
 *   2. Extensionless imports. TypeScript source routinely writes
 *      `from "@/lib/units"`, and Node's ESM resolver requires the real
 *      filename. Without this only modules that happen to import with explicit
 *      extensions can be tested — which quietly meant most of the app could
 *      not be, since one extensionless import anywhere in the graph is enough
 *      to fail the whole test file.
 *
 * Loaded via --import from the "test" script; not part of the app bundle.
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC_URL = pathToFileURL(path.join(import.meta.dirname, "..", "src", "/")).href;

/** Candidate filenames for a specifier written without one. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

/** Bare "node:test" and package names have no extension to add usefully. */
function looksExtensionless(specifier) {
  return !/\.[cm]?[jt]sx?$/i.test(specifier);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), SRC_URL).href
      : specifier;

    try {
      return nextResolve(target, context);
    } catch (error) {
      if (!looksExtensionless(target)) throw error;

      for (const extension of EXTENSIONS) {
        try {
          return nextResolve(target + extension, context);
        } catch {
          // try the next one; the original error is rethrown below
        }
      }
      throw error;
    }
  },
});

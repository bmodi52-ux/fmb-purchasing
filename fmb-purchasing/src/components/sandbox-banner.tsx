import { isSandbox } from "@/lib/sandbox";

/**
 * Says, on every page, that this is not the real thing (scratchpad #1).
 *
 * Deliberately hard to miss and deliberately not dismissible: someone being
 * trained should never be in doubt about which system they are looking at,
 * and a trainer should be able to tell from across a room. Renders nothing at
 * all on the live site.
 */
export function SandboxBanner() {
  if (!isSandbox()) return null;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-maroon px-4 py-1.5 text-center text-sm text-cream">
      <span className="font-semibold uppercase tracking-wide">Sandbox</span>
      <span className="text-cream/85">
        A copy for training. Names, bank details and email addresses are invented, and nothing here is real.
      </span>
    </div>
  );
}

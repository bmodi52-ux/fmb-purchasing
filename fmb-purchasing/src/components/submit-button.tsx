"use client";

import { useFormStatus } from "react-dom";
import { useReportPending } from "./pending";

/**
 * Submit button that shows its own form's in-flight state.
 *
 * useFormStatus reads the status of the nearest enclosing <form>, so this has
 * to be the button itself (or a descendant of the form) rather than something
 * a page wires up centrally — which is why it replaces the raw submit buttons
 * throughout.
 *
 * Feedback is deliberately restrained: the button dims and stops accepting
 * clicks, the label swaps where the caller gives one, and the shared hairline
 * appears at the top of the viewport. No injected spinner element, because a
 * spinner that only exists while pending shifts the label sideways the moment
 * it appears.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "",
  disabled,
  ...rest
}: React.ComponentProps<"button"> & { pendingLabel?: React.ReactNode }) {
  const { pending } = useFormStatus();
  useReportPending(pending);

  return (
    <button
      {...rest}
      type="submit"
      disabled={pending || disabled}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      className={`is-pending-aware ${className}`}
    >
      {pending && pendingLabel != null ? pendingLabel : children}
    </button>
  );
}

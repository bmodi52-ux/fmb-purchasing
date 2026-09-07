import { SubmitButton } from "@/components/submit-button";

/**
 * Deciding a record from the record itself.
 *
 * Approving used to be something you could only do from a list — the pending
 * table on Pricelist, the Vendors table, the Approvals queue. Each of those
 * rows shows a fraction of what the record holds, so the honest way to review
 * anything was to open it, read it, go back, find the row again, and act on
 * the summary. The person who has just read the whole record is exactly the
 * person in a position to decide it, so the decision belongs on the page they
 * are already looking at.
 *
 * Deliberately the same action the list calls, in every case. Two code paths
 * to the same decision is how they drift — one recording history, notifying,
 * or re-checking a status the other forgets.
 *
 * Renders nothing at all unless there is a decision to make: the viewer may
 * decide, and the record is waiting on one.
 */
export function ReviewDecision({
  action,
  idField,
  id,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  approveValue = "approved",
  rejectValue = "rejected",
  commentLabel,
  note,
}: {
  /** The same server action the list view submits to. */
  action: (formData: FormData) => void | Promise<void>;
  /** Form field naming the record, e.g. "vendor_id". */
  idField: string;
  id: string;
  approveLabel?: string;
  rejectLabel?: string;
  /** What the action expects in its "decision" field. */
  approveValue?: string;
  rejectValue?: string;
  /**
   * When set, a comment box is offered alongside — for decisions where the
   * reason travels with the outcome, as a declined expense's does back to
   * whoever submitted it.
   */
  commentLabel?: string;
  /** A line of context under the buttons, where one is worth saying. */
  note?: string;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {/* One form, two submit buttons carrying their own decision, so the
          comment typed above is sent with whichever is pressed. */}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name={idField} value={id} />
        {commentLabel && (
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">{commentLabel}</span>
            <input name="comment" className="input" />
          </label>
        )}
        <SubmitButton
          name="decision"
          value={approveValue}
          className="rounded-md bg-palm/90 px-4 py-2 text-sm font-medium text-white hover:bg-palm"
        >
          {approveLabel}
        </SubmitButton>
        <SubmitButton
          name="decision"
          value={rejectValue}
          className="rounded-md border border-maroon/40 px-4 py-2 text-sm font-medium text-maroon hover:bg-maroon/5"
        >
          {rejectLabel}
        </SubmitButton>
      </form>
      {note && <p className="text-xs text-ink/45">{note}</p>}
    </div>
  );
}

/** The colours every status badge in the app already uses. */
const STATUS_CLASS: Record<string, string> = {
  approved: "bg-palm/15 text-palm",
  rejected: "bg-maroon/10 text-maroon",
  declined: "bg-maroon/10 text-maroon",
  pending: "bg-gold/20 text-gold-deep",
  submitted: "bg-gold/20 text-gold-deep",
};

/** Where a record stands, said the same way on every page that shows one. */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_CLASS[status] ?? "bg-ink/10 text-ink/70"
      }`}
    >
      {label ?? status}
    </span>
  );
}

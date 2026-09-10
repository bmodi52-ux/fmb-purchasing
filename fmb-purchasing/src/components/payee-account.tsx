import Link from "next/link";
import { formatAccount, type PaymentInstruction } from "@/lib/payment-instruction";

/**
 * Who to pay, and whether anyone has vouched for the account.
 *
 * Shared by Payments and the expense page so the two cannot come to disagree
 * about what counts as confirmed — which, of everything in this app, is the
 * disagreement with the worst consequence.
 */
export function PayeeAccount({
  instruction,
  compact = false,
}: {
  instruction: PaymentInstruction | null;
  /** The Payments table cell, where a paragraph of prose would not fit. */
  compact?: boolean;
}) {
  if (!instruction) {
    return <span className="text-ink/40">No payee recorded</span>;
  }

  const unconfirmed = instruction.status === "pending";
  const account = formatAccount(instruction);
  const hasNumbers = account !== "—";

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-ink">{instruction.displayName}</span>
      {hasNumbers && <span className="font-mono text-xs text-ink/60">{account}</span>}

      {unconfirmed && (
        <span
          className={
            compact
              ? "mt-0.5 inline-flex w-fit items-center rounded bg-gold/25 px-1.5 py-0.5 text-[11px] font-medium text-gold-deep"
              : "mt-1 inline-flex w-fit items-center rounded bg-gold/25 px-2 py-0.5 text-xs font-medium text-gold-deep"
          }
        >
          {instruction.disagreesWith
            ? "Unconfirmed — disagrees with the account on file"
            : "Unconfirmed — read off the invoice"}
        </span>
      )}

      {unconfirmed && !compact && (
        <p className="mt-1 max-w-prose text-xs text-ink/60">
          {instruction.disagreesWith ? (
            <>
              The submitter entered these details from the invoice, and they are not the ones on file
              {instruction.disagreesWith.bsb || instruction.disagreesWith.accountNumber ? (
                <>
                  {" "}
                  (<span className="font-mono">{formatAccount(instruction.disagreesWith)}</span>)
                </>
              ) : null}
              . Confirm them before transferring.
            </>
          ) : (
            <>
              The submitter entered these details from the invoice. Nobody has confirmed them yet.
            </>
          )}{" "}
          {instruction.vendorId && (
            <Link
              href={`/vendors/${instruction.vendorId}`}
              prefetch={false}
              className="underline hover:text-gold-deep"
            >
              Confirm on the vendor page
            </Link>
          )}
        </p>
      )}

      {unconfirmed && compact && instruction.vendorId && (
        <Link
          href={`/vendors/${instruction.vendorId}`}
          prefetch={false}
          className="text-[11px] text-ink/60 underline hover:text-gold-deep"
        >
          Confirm
        </Link>
      )}

      {instruction.status === "superseded" && (
        <span className="text-xs text-ink/50">This account has since been replaced.</span>
      )}
    </div>
  );
}

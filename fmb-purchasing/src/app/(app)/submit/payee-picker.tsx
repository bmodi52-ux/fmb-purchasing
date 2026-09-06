"use client";

import { useEffect, useRef, useState } from "react";
import { searchPayeesAction } from "./actions";
import type { PayeeChoice, PayeeSuggestion } from "@/lib/payees";

/**
 * Who gets the money.
 *
 * The submitter is frequently not the payee — one coordinator forwards on
 * behalf of whoever actually stood at the till, and some invoices are paid to
 * the vendor directly. Until now that instruction lived in the covering email
 * ("Please pay Miqdad Bhai", "pay Taj Mart directly", a BSB and account number
 * typed into the message body), and once submissions come through the site
 * there is nowhere for it to go unless it is asked for here.
 *
 * Four states, in the order they actually occur: me, the vendor on the receipt,
 * someone already on file, someone new. "Me" is the default because it is the
 * common case, and because a default of nothing would mean most expenses
 * arriving with no payee at all.
 *
 * The vendor option covers the invoice nobody has paid yet — "pay Taj Mart
 * directly $5065.76 as per attached invoices" — which is not a reimbursement
 * at all and previously had to be entered as a stranger who happened to share
 * the vendor's name. It works for a vendor being entered for the first time
 * too: the expense matches or creates its vendor before the payee is resolved,
 * so there is always a vendor to attach to by then.
 */
export function PayeePicker({
  value,
  onChange,
  myName,
  vendorName,
  vendorHasPaymentDetails,
  extractedName,
  extractedBank,
}: {
  value: PayeeChoice | null;
  onChange: (choice: PayeeChoice | null) => void;
  myName: string;
  /** The vendor on this receipt, as currently entered. */
  vendorName: string;
  /** Whether that vendor already has bank details saved against it. */
  vendorHasPaymentDetails: boolean;
  /** A name read out of the covering email, if there was one. */
  extractedName?: string | null;
  extractedBank?: { accountName: string | null; bsb: string | null; accountNumber: string | null } | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PayeeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState(extractedName ?? "");
  const [bsb, setBsb] = useState(extractedBank?.bsb ?? "");
  const [accountNumber, setAccountNumber] = useState(extractedBank?.accountNumber ?? "");
  const [accountName, setAccountName] = useState(extractedBank?.accountName ?? "");
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [vendorBsb, setVendorBsb] = useState("");
  const [vendorAccountNumber, setVendorAccountNumber] = useState("");
  const [vendorAccountName, setVendorAccountName] = useState("");

  const mode: "me" | "vendor" | "existing" | "new" =
    value?.kind === "new"
      ? "new"
      : value?.kind === "vendor"
        ? "vendor"
        : value?.kind === "existing"
          ? "existing"
          : "me";

  function pushVendor(patch: Partial<Extract<PayeeChoice, { kind: "vendor" }>>) {
    onChange({
      kind: "vendor",
      bankAccountName: patch.bankAccountName ?? vendorAccountName,
      bsb: patch.bsb ?? vendorBsb,
      accountNumber: patch.accountNumber ?? vendorAccountNumber,
    });
  }

  // Debounced so a name typed at speed is one request, not eight.
  useEffect(() => {
    if (mode !== "existing" || !open) return;
    const timer = setTimeout(() => {
      searchPayeesAction(query).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, mode]);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function pushNew(patch: Partial<Extract<PayeeChoice, { kind: "new" }>>) {
    onChange({
      kind: "new",
      displayName: patch.displayName ?? newName,
      bankAccountName: patch.bankAccountName ?? accountName,
      bsb: patch.bsb ?? bsb,
      accountNumber: patch.accountNumber ?? accountNumber,
    });
  }

  return (
    <fieldset className="rounded-md border border-ink/15 bg-white/60 p-3">
      <legend className="px-1 text-sm text-ink/70">Who should be paid?</legend>

      <div className="flex flex-wrap gap-4 text-sm">
        <Radio
          name="payee-mode"
          checked={mode === "me"}
          onChange={() => onChange({ kind: "me" })}
          label={`Reimburse me (${myName})`}
        />
        <Radio
          name="payee-mode"
          checked={mode === "vendor"}
          onChange={() => pushVendor({})}
          disabled={!vendorName.trim()}
          label={vendorName.trim() ? `Pay the vendor (${vendorName.trim()})` : "Pay the vendor"}
        />
        <Radio
          name="payee-mode"
          checked={mode === "existing"}
          onChange={() => {
            setOpen(true);
            onChange({ kind: "existing", payeeId: "" });
          }}
          label="Someone else"
        />
        <Radio
          name="payee-mode"
          checked={mode === "new"}
          onChange={() => pushNew({})}
          label="Add a new payee"
        />
      </div>

      {extractedName && mode !== "new" && (
        <p className="mt-2 text-xs text-ink/55">
          The covering message says to pay <span className="font-medium text-ink/80">{extractedName}</span>.
        </p>
      )}

      {mode === "vendor" && (
        <div className="mt-3">
          {vendorHasPaymentDetails ? (
            // The numbers themselves stay server-side. 0027 put bank details
            // behind payments:mark_paid, and knowing an account is on file is
            // all a submitter needs in order not to type it again.
            <p className="rounded-md bg-palm/10 px-3 py-2 text-sm text-ink/75">
              Bank details for {vendorName.trim()} are already on file. The Treasurer will
              use them — nothing to enter here.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink/55">
                No bank details saved for this vendor yet. Add them from the invoice if you
                have them; they are needed once and reused from then on.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-ink/70">
                    Account name <span className="text-ink/40">(optional)</span>
                  </span>
                  <input
                    value={vendorAccountName}
                    onChange={(e) => {
                      setVendorAccountName(e.target.value);
                      pushVendor({ bankAccountName: e.target.value });
                    }}
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">BSB</span>
                  <input
                    value={vendorBsb}
                    inputMode="numeric"
                    onChange={(e) => {
                      setVendorBsb(e.target.value);
                      pushVendor({ bsb: e.target.value });
                    }}
                    placeholder="082112"
                    className="input font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Account number</span>
                  <input
                    value={vendorAccountNumber}
                    inputMode="numeric"
                    onChange={(e) => {
                      setVendorAccountNumber(e.target.value);
                      pushVendor({ accountNumber: e.target.value });
                    }}
                    className="input font-mono"
                  />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "existing" && (
        <div ref={boxRef} className="relative mt-3">
          <input
            value={chosenLabel ?? query}
            onChange={(e) => {
              setChosenLabel(null);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search people and vendors already paid…"
            className="input w-full text-sm"
            aria-label="Search payees"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-ink/15 bg-white shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ kind: "existing", payeeId: r.id });
                      setChosenLabel(r.displayName);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gold/10"
                  >
                    <span className="truncate text-ink">{r.displayName}</span>
                    <span className="shrink-0 text-xs text-ink/45">
                      {r.linkedTo === "member" ? "member" : r.linkedTo === "vendor" ? "vendor" : "external"}
                      {r.hasBankDetails ? " · bank details on file" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "new" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">Name</span>
            <input
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                pushNew({ displayName: e.target.value });
              }}
              placeholder="Person or business to pay"
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-ink/70">
              Account name <span className="text-ink/40">(optional)</span>
            </span>
            <input
              value={accountName}
              onChange={(e) => {
                setAccountName(e.target.value);
                pushNew({ bankAccountName: e.target.value });
              }}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">BSB</span>
            <input
              value={bsb}
              inputMode="numeric"
              onChange={(e) => {
                setBsb(e.target.value);
                pushNew({ bsb: e.target.value });
              }}
              placeholder="082112"
              className="input font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Account number</span>
            <input
              value={accountNumber}
              inputMode="numeric"
              onChange={(e) => {
                setAccountNumber(e.target.value);
                pushNew({ accountNumber: e.target.value });
              }}
              className="input font-mono"
            />
          </label>
          <p className="text-xs text-ink/45 sm:col-span-2">
            Bank details are needed once. They are visible only to whoever makes the payment.
          </p>
        </div>
      )}
    </fieldset>
  );
}

function Radio({
  name,
  checked,
  onChange,
  label,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  /** "Pay the vendor" means nothing until a vendor has been named. */
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      <span className="text-ink/80">{label}</span>
    </label>
  );
}

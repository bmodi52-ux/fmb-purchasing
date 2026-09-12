# Xero integration plan

Scratchpad #38. FMB already uses Xero. This is the plan for getting expenses from
this app into it without retyping — what is built, what is waiting on answers,
and the steps after.

## Built now: a file import

Accounting → Xero → **Download Xero bills file** makes a CSV in Xero's purchases
(bills) import template for any period:

- one draft bill per approved or paid expense, one row per line item
- `*AccountCode` from the category's account code (set on the same page)
- `*TaxType` from the line itself — `INPUT` (GST on expenses), `EXEMPTEXPENSES`
  (GST free), `CAPEXINPUT` and `EXEMPTCAPITAL` for capital purchases
- amounts GST inclusive, as receipts are: choose **Tax inclusive** when Xero asks
- the entry number (E-0012) leads the bill number, so re-importing is easy to spot

This works whichever way purchases reach Xero today, and needs no connection or
keys. It is the fallback even once the live connection exists.

## Waiting on answers

These decide the live connection's shape, so nothing further is built until
they are settled (recorded on the scratchpad, #38):

1. **The chart of accounts.** Export it from Xero (Accounting → Chart of
   accounts → Export) and the account codes can be filled in from it.
2. **How purchases reach Xero today.**
   - *Bills, then marked paid* → the app creates bills (`ACCPAY` invoices) when
     an expense is approved, and records the payment when it is paid.
   - *Spend money* → the app creates a spend-money transaction (`SPEND`) against
     the bank account when an expense is paid.
   - *Coded from the bank feed* → the app sends nothing to Xero's ledger; instead
     it gives Xero's bank rules what they need (payee, account, reference), or
     attaches receipts to the reconciled lines.
3. **Cash or accrual GST.** Accrual: an expense goes across when approved, dated
   by its receipt. Cash: when paid, dated by the payment.
4. **Who holds Xero admin access**, to approve the connection once.

## The live connection, once answered

1. **Connect.** A Xero app for FMB using OAuth 2.0 (authorisation code flow).
   An admin clicks Connect in App settings and approves it in Xero. Access tokens
   are short-lived and refreshed with a refresh token, which is stored encrypted
   and never sent to the browser. Scopes: `accounting.transactions`,
   `accounting.contacts`, `accounting.attachments`, `accounting.settings.read`.
   (Xero also sells a single-organisation "custom connection"; check current
   Xero pricing before choosing it.)
2. **Map.** Read Xero's accounts, tax rates and tracking categories into the app.
   Categories pick an account from a list rather than typing a code. Cost centres
   and events (#39) become a tracking category.
3. **Contacts.** Match each vendor to a Xero contact by ABN, then by name; create
   the contact in Xero when there is none. Members being reimbursed become
   contacts too, if bills are the answer to question 2.
4. **Send.** On approval (accrual) or payment (cash), create the bill or
   spend-money transaction, with each line's account, tax type and tracking, and
   attach the receipt files. Store Xero's id on the expense, so a retry updates
   rather than duplicates.
5. **Pay.** When a payment run is marked paid, record it in Xero against FMB's
   bank account, with the run's reference.
6. **Keep honest.** A queue of anything that failed to send, shown on System
   errors with a Retry. A reversal in the app voids the Xero transaction. Locked
   periods (#38) are not sent changes.

## Not planned

- Two-way sync of amounts from Xero back into the app. The receipt is the
  record here; Xero is where it is accounted for.
- Running payroll or BAS lodgement from the app. Xero does both.

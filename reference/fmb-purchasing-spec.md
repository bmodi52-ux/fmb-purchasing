# FMB Purchasing — Consolidated Spec

Domain: **www.fmbpurchasing.com.au**

## 1. Purpose

An internal admin/accounting web application for FMB (Faiz ul Mawaid il Burhaniyah) to manage
the full lifecycle of organizational expenses — submission, receipt data capture, approval,
reimbursement, and reporting. Covers **all FMB expense types** (kitchen/Thaali and beyond —
events, maintenance, other committees), not just kitchen operations. This is a separate system
from the independent Thaali RSVP tool — no integration between them.

---

## 2. Users, roles & permissions

**Known roles (not exhaustive):** FMB Head, Procurement Head, Treasurer, Joint Treasurer,
Logistics Head, Operations Head, Coordinator Head, Coordinators, Members, Developer (super user).

**This must be a configurable permissions system, not a hardcoded role list:**
- Admins can create/edit **teams** (e.g. "Purchasing Team") and assign members to them.
- Admins can define what each role/team can see and do, per page and per action (view, submit,
  approve, edit master data, manage users, etc.), from within the site itself.
- Default/minimal permission tier ("Member"): can only submit expenses and track the status of
  their own submissions. No visibility into, or navigation access to, any other page.

**Login:** manual username/password accounts for now. Architecture should allow swapping in
**ITS OneLogin (SAML)** later without a rebuild — not being worked on now.

---

## 3. Expense submission

- Entry point: upload a receipt photo or PDF, **or** submit with no receipt at all (receipt is
  never compulsory).
- Rebuilt natively into this site (not linked to the standalone FMB Data Entry prototype it's
  based on) — same AI-vision extraction approach, fine-tuned and extended per below.
- **Removed from the old prototype**: the personal local ledger, the "Export to Excel" button,
  and "Clear all entries." None of that carries over — hitting submit after verification sends
  the expense straight into the approval pipeline (§5) instead.
- **Kept from the old prototype**: the ABN lookup against the free ABR web service (auto-fills
  vendor name from an ABN).
- One receipt = one submission, expandable to show every line item.
- A submitted expense can be **edited or deleted by the submitter** at any point before a
  decision (approve/decline) is made. Once decided, it's locked.

### 3.1 AI extraction — what it must now do

Base extraction (from the prior prototype): vendor, ABN, date, invoice number, line items
(description, qty, unit price, line total), receipt total.

**New requirements on top of that:**

1. **Vendor matching** — first try to match the extracted vendor against the existing Vendors
   table. No match → create a new **provisional/pending vendor**.
2. **Item matching, scoped to vendor** — once a vendor is identified (matched or new), match
   line items only against that vendor's known items in the Pricelist. No match → create a new
   **provisional/pending item** under that vendor. (Simple by design — pricing and item framing
   legitimately vary by vendor.)
3. **Category** — each line item gets a category; a single receipt can span multiple categories.
4. **GST inference** — the model must infer, per line or per receipt (whichever the receipt
   itself makes inferable, e.g. an explicit GST line, "Total incl. GST," or a registered ABN),
   whether GST applies. Every receipt/line must resolve to: **Subtotal (excl. GST) → GST amount
   → Total (incl. GST)**. This matters for real accounting — FMB is GST-registered and claims
   GST back at year end, so this must be accurate, not cosmetic.
5. **Per-unit normalization** — for each line item, infer the canonical base unit and quantity
   from the printed description (e.g. "Tomato Sauce Carton — 3×4L" → 12L; "Chicken 10kg box" →
   10kg). Fully automatic — the submitter is never expected to enter this manually.
6. **Canonical item grouping** — the same underlying product bought from different vendors, or
   described differently, should roll up to one canonical item group for analytics purposes
   (e.g. all "chicken" variants), separate from the vendor-scoped pricelist matching in point 2.
   This grouping only feeds reporting/analytics — it does not affect vendor/item matching during
   submission.

### 3.2 Manual submission (no AI / no receipt)

- Vendor and item fields are **lookups against the Vendors/Pricelist tables**, not free text.
- If a vendor or item isn't found, the user can type a new one directly — this creates the same
  kind of provisional/pending entry as an AI-detected new vendor/item.

---

## 4. Pricelist & Vendors pages

- Two master-data pages: **Pricelist** (items) and **Vendors**.
- Each supports direct manual add by staff.
- **Provisional entries**: any new vendor/item surfaced via receipt extraction or manual typing
  on the submit form is added in a **pending** state — not selectable as a confirmed catalog
  entry until approved.
- **Approval of pending vendors/items** is done by a member of the (admin-defined) purchasing
  team — a separate track from expense approval. **Fully independent**: a pending item/vendor
  never blocks the expense it came from from moving through the normal approval flow, and vice
  versa.

---

## 5. Approval flow

```
Submit → Procurement Head review → Accounts (reimbursement)
```

- **Procurement Head** reviews each submitted expense. View: one line per receipt, expandable
  to show all line items/detail, with a link to the receipt image if one was provided.
  - **Approve** → moves to Accounts, with an optional comment.
  - **Decline** → terminal state. Submitter sees: *"Declined — please contact FMB Procurement
    Head"* plus the decliner's own comment (visible, not hidden).
- **Accounts** marks each receipt as **paid** once an offline bank transfer is completed, and
  can attach a **payment reference** and **payment date** per receipt. No on-site payment
  processing — this is a record-keeping step only.
- **Current model**: single Procurement Head approves everything (no thresholds/tiers yet).
  Should be built so a multi-approver / amount-threshold model can be added later without a
  rebuild.

---

## 6. Data pages, tables & customization

- A page listing **all expenses** and related data (status, category, vendor, amounts, GST
  breakdown, etc.).
- **Every page with tabular/columned data** must let each user:
  - Customize which columns are shown/hidden.
  - Have that preference **persist per-user** across sessions (saved server-side, tied to their
    account).

---

## 7. Notifications

- Email at each stage of an expense's life: **submission, approval/decline, reimbursement.**
- WhatsApp: nice-to-have, only if a genuinely free method exists — **deferred**, not part of v1.

---

## 8. Money & accounting rules

- Currency: **AUD** only.
- FMB is **GST-registered** and claims GST back annually — GST tracking must be accurate at the
  line/receipt level (see §3.1.4).
- **Fiscal year**: runs **Shawwal → Sha'ban** on the **Fatimi/Misri Hijri calendar** (not the
  Gregorian year). This affects "this year" / year-to-date calculations throughout the app, not
  just reports.

---

## 9. Per-unit cost tracking & analytics

- Every line item is normalized to a canonical base unit (kg, L, etc.) at extraction time,
  including deducing pack composition (e.g. a carton of 3×4L bottles = 12L) from the receipt
  text alone — no manual entry.
- Items are grouped into **canonical item groups** across vendors/spelling variants (e.g. all
  "chicken" purchases, regardless of vendor or exact wording) purely for analytics — this is
  separate from the vendor-scoped item matching used during submission (§3.1.2).
- Purpose: track price-per-unit trends over time (e.g. $/kg for chicken month over month) and
  compare cost across vendors.
- A safety net for mis-grouping (e.g. "Chkn Breast" vs "Chicken Breast Fillet" wrongly split
  into two groups) should exist — likely an admin/procurement-facing merge tool — but isn't
  fully designed yet.

---

## 10. Reporting

- Reports must be viewable in **both Gregorian and Hijri (Fatimi/Misri) calendars**, given the
  Hijri fiscal year.
- A verified, tested Gregorian↔Hijri conversion library already exists (built and cross-checked
  against the Dawoodi Bohra dawat's published calendar rules, and against 8 years of
  user-confirmed 1 Muharram/1 Ramadan dates) — to be reused directly rather than rebuilt.
- Reports must be **extractable/downloadable**, not just viewed on-screen (format TBD — likely
  Excel for detailed data, PDF for shareable summaries).
- Beyond per-unit analytics (§9), a full reporting page (spend by category, vendor, budget vs.
  actual, etc.) will be proposed once the core flow is working.

---

## 11. Design system

Derived from the FMB logo (colors sampled directly from the artwork, not estimated):

| Token | Value | Usage |
|---|---|---|
| Gold (primary) | `#D89C24` | Primary buttons, active nav state, key accents |
| Gold, deep | `#A97614` | Hover/pressed states |
| Maroon | `#4A160A` | Minor accent only — e.g. "Reimbursed" status, a category dot |
| Palm green | `#009C48` | Secondary status accent (e.g. "Approved") |
| Cream | `#FBF6EC` | Background |
| Ink | `#2B211C` | Primary text |

- Headings: **Fraunces** (serif). Body: **Inter**. Amounts/IDs/dates: **IBM Plex Mono**. Arabic
  script accents: **Amiri**.
- Layout: light, airy — sidebar (light gradient, not dark) + main content area, both on a cream
  base. Signature touch: a subtle palm-frond motif, echoing the crest, used sparingly as a
  divider — never overused.
- The receipt-reader rebuild and every other page must be restyled to match this system (the
  original FMB Data Entry prototype was in an unrelated teal/slate theme).

---

## 12. Proposed architecture

*(Recommendation — not yet committed to; domain is purchased, nothing else is set up.)*

| Piece | Role | Suggested tool |
|---|---|---|
| App | UI, forms, workflow logic | Next.js on **Vercel** |
| Database + Auth + File storage | All data and receipt files in one backend | **Supabase** (Postgres) |
| Email | Status notifications | **Resend** |
| Receipt reading | AI extraction | **Claude API**, called server-side (key never exposed client-side, unlike the original prototype) |

Estimated cost at current scale (20–30 users, 500–1,000 receipts/month): roughly **$0–50/month**,
mostly Claude API usage.

Alternatives considered: Firebase/Appwrite (Supabase substitutes — Firebase's NoSQL data model
is a worse fit for GST math/relational reporting), AWS Amplify (does everything under one
account but far more complex to run). No single platform cleanly covers hosting + relational
database + auth + storage + email at equal quality, so the three-piece stack above is the
practical choice.

---

## 13. Still owed by me (not yet delivered)

- A proposed expense category list (you asked me to propose one; hasn't been drafted yet).
- A proposed reporting page layout, beyond the per-unit analytics in §9.

## 14. Explicitly deferred / phase 2

- ITS OneLogin (SAML) integration — architecture should support it later; not built now.
- WhatsApp notifications — only if a free method exists; not in v1.
- Multi-tier/threshold-based procurement approval — current model is single approver.
- Item/vendor mis-grouping merge tooling for analytics — flagged as needed, not yet designed.

---

## 15. Assets on hand

- FMB logo (source of the design system in §11).
- `hijri.js` — verified Fatimi/Misri Hijri calendar conversion library, with test suite
  (`tests.mjs`, 15/15 passing) and a working demo calendar widget (`demo.html`).
- Prior receipt-reader prototype (`receipt_ledger.html`) — extraction schema and UI flow used as
  the starting reference for the rebuild described in §3.
- Two dashboard design mockups reflecting the current visual direction (§11).

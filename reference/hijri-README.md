# Misri Hijri Calendar — verified package

A self-contained, dependency-free JS library and demo widget for the
Dawoodi Bohra (Misri) tabular Hijri calendar, for use on the FMB website.
No external calendar site or API is required — dates are computed directly.

## Files

- **`hijri.js`** — core library. Exports:
  - `gregorianToHijri(date)` → `{ day, month, year }`
  - `formatHijri(hijriDate, { arabic })` → formatted string
  - `buildMonthGrid(gregYear, gregMonth)` → week-by-week grid with both
    calendars attached to every day cell
  - `toArabicNumeral(n)` → Arabic-Indic digit string
  - `HIJRI_MONTHS_EN`, `HIJRI_MONTHS_AR` — month name arrays
- **`demo.html`** — working month-view calendar built on `hijri.js`, with
  prev/next navigation and today-highlighting. Styling is meant as a
  starting point to restyle/integrate into the FMB site, not a fixed design.
- **`tests.mjs`** — verification suite. Run with `node tests.mjs`. Re-run
  this after any edit to `hijri.js` to confirm nothing broke.

## How the calendar works

The Misri calendar is a **fixed, calculated (tabular)** calendar, not
moon-sighting based, so it can be computed deterministically for any date:

- 12 months per year, alternating 30 days ("kamil") and 29 days ("naqis"),
  starting with a 30-day Muharram.
- Most years ("normal") have 354 days. "Kabisa" (leap) years have 355 —
  the extra day is added to the last month, Zilhijja.
- Kabisa years repeat on a fixed 30-year cycle. A year is kabisa if its
  position in the cycle (`year mod 30`, using 30 rather than 0) is one of:
  **2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29**.

## Verification history

This algorithm was built and corrected through several rounds of
cross-checking — not just trusted from a single source:

1. **First implementation used a smoothed/continuous approximation
   formula** (a common generic "Islamic calendar" formula). It was later
   found to drift by a day in some years — caught when the user reported
   1 Muharram 1448H should be 15 June 2026, not 16 June as originally
   computed.
2. **Rewritten using the exact discrete leap-year rule**, and cross-checked
   directly against the Dawoodi Bohra dawat's own published explanation at
   thedawoodibohras.com/the-misri-hijri-calendar — matched their leap-year
   rule and worked example (1431H kabisa, 1432H not) exactly.
3. **Epoch (day-zero alignment)** calibrated and confirmed against:
   - The original mumineencalendar.com calendar grid for Nov 2013
     (matched day-by-day).
   - The user-supplied correction (15 Jun 2026 = 1 Muharram 1448H).
   - A user-confirmed table of 1 Muharram and 1 Ramadan dates for
     1448H–1455H (8 consecutive years) — all confirmed correct by the user
     against their own reference.
4. **Internal consistency checks**: several traditional calendar-pattern
   claims (e.g. "4th Rajab, 1st Ramadan, and Eid al-Adha fall on the same
   weekday") were tested computationally and confirmed to hold exactly
   every year, as expected from the fixed month-length structure.

All of the above are encoded as automated checks in `tests.mjs`.

### Known open item

One traditional claim — that the weekday/date pattern of "year 1" repeats
exactly in "year 8" of a cycle — did **not** reconcile exactly under this
algorithm (days between corresponding 1 Muharram dates were consistently
2–3 days short of a multiple of 7, for every cycle-start position tested).
This wasn't resolved and is left as an open question rather than forced to
fit — worth another look if it becomes relevant.

## Usage

```html
<script type="module">
  import { gregorianToHijri, formatHijri, buildMonthGrid } from "./hijri.js";

  const today = gregorianToHijri(new Date());
  console.log(formatHijri(today)); // e.g. "11 Safar al-Muzaffar 1448H"
</script>
```

See `demo.html` for a full working example (month grid, navigation,
today-highlighting).

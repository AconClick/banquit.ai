# Open Questions and Proposed Defaults

> **Status (2026-10-01):** Awin Pavan accepted the proposed defaults below for advances, cancellation and tax-inclusive packages. They are built as **Property Settings** (one set per property, changeable in Master) and **Rate & Tax Mapping**. The questions stay open for clients who need a different policy.

The original requirements document does not cover the topics below. Each section gives a **proposed default** so development can start, and the **questions** that need an answer from the business. Every number here should be a per-property setting, not hard-coded.

## 1. Advances and deposits

**Proposed default**

- A booking moves from Provisional to Confirmed when the guest pays an advance of at least **25% of the proforma total**.
- A user with the "confirm without advance" permission can confirm with no advance, giving a reason (useful for regular corporate clients).
- **[Proposed]** A second instalment, bringing the total paid to **75%**, is due **7 days** before the function. The diary's Reminders box flags unpaid instalments.
- Advances are receipts with their own number series, linked to the reservation, and are applied to the final bill at settlement.

**Questions**

1. Is the advance a percentage of the proforma, a fixed amount per booking, or per pax?
2. Are instalment schedules needed, or only one advance?
3. Should a reservation be blocked from going In Function if the full amount is not yet paid?

## 2. Cancellation charges

**Proposed default:** a slab based on how many days before the function the booking is cancelled, applied to the **proforma total**.

| Days before function | Charge |
|---|---|
| More than 30 | 0% (advance fully refundable) |
| 15 to 30 | 25% |
| 7 to 14 | 50% |
| Fewer than 7 | 100% |

- The charge is taken from the advances first. Any excess advance is refunded; any shortfall is raised as a cancellation bill.
- A manager can waive or reduce the charge with a reason.
- Enquiries, Waitlisted and lapsed Provisionals (Lost) carry no charge.

**Questions**

1. Is the charge on the proforma total, on the advance only, or a fixed amount?
2. Does the hotel retain the advance by default (common practice) rather than refund it?
3. Is tax charged on cancellation charges?
4. Does a hotel-initiated cancellation (e.g. hall under repair) need a different flow, with a full refund?

## 3. Amendments

**Proposed default**

- Any change to a Provisional or Confirmed booking creates a new revision with an Amendment Reason (see [reservation-stages.md](reservation-stages.md#35-amendment-on-provisional-or-confirmed)).
- Before the guarantee cut-off (72 hours), reservations staff can amend freely.
- After the cut-off: pax can only go up; menu changes, date / hall / time changes and pax reductions need a manager role.
- **[Proposed]** Moving a Confirmed booking to a new date is an amendment, not a cancel and rebook, so the advance carries over with no cancellation charge.

**Questions**

1. Is there a charge for changing the date or hall?
2. How many days before the function should the menu be frozen?

## 4. Tax-inclusive packages

The document says some packages are "All Inclusive of Taxes", for example ₹950 per pax including tax.

**Proposed default:** the package has a flag **Rate includes tax**. When set, the system back-calculates the taxable value so the printed total equals the agreed price.

```
Inclusive rate R, fixed per-pax taxes F (sum), percentage taxes p (sum, as a fraction)

Taxable value per pax = (R − F) / (1 + p)
Tax per pax           = R − Taxable value per pax
```

Example with a single 5% tax and no fixed taxes: R = 950, so taxable value = 950 / 1.05 = 904.76 and tax = 45.24. For 100 billable pax the bill shows taxable 90,476.19 + tax 4,523.81 = 95,000.00.

The rates above are only for illustration; actual rates come from the Tax Master entries valid on the function date.

**Questions**

1. If the tax rate changes between booking and function, does the guest still pay the agreed inclusive price (hotel absorbs the difference)? The proposed default is yes.
2. Are discounts on an inclusive package applied before or after the back-calculation? The proposed default is to discount the inclusive rate, then back-calculate.
3. Should tax-inclusive be allowed for Ala-carte and Services lines too, or only Packages?

## 5. Other gaps noted, not covered here

- **Rate & Tax Mapping** and **Map Taxes**: still empty. Billing needs them to know which taxes apply to each item, A-Type or extra charge.
- **Hall hire and liquor licence**: fixed per booking, per hour, or per pax? Is the licence charged per event or recovered from the guest at cost?
- **Discount** limits per role.
- **Roles access rights**, Settlement Setup, Master Settings, Print Setup, Series Setup: listed in the document but not described.
- **Reports** and the scope of the **AI bot**.

## Proposed master settings

The defaults across these documents would live in **Master Settings**, per property:

| Setting | Proposed default |
|---|---|
| Provisional option period | 7 days |
| Latest option date | Function date − 3 days |
| Action when option lapses | Remind, then move to Lost at end of day |
| Guarantee / menu cut-off | 72 hours before start |
| Actual pax overdue after | 24 hours after end |
| Setup / cleanup buffer | 0 minutes (per hall override) |
| Advance to confirm | 25% of proforma |
| Second instalment | 75% total, 7 days before |
| Cancellation slab | See section 2 |
| Bill total rounding | Nearest whole currency unit |
| Bill number series reset | Each financial year |

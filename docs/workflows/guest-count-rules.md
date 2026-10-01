# Guest Count Rules (Pax)

The original document defines two mandatory fields, **Min Pax** (guaranteed, used for billing) and **Max Pax**, but then describes Max Pax as "the Actual Count of Guest once the Function Gets Over". A maximum and an actual count are different things, so this spec uses three fields.

## 1. Fields

| Field | Replaces | When entered | Mandatory | Used for |
|---|---|---|---|---|
| **Guaranteed pax** | "Min Pax" | At booking (every status) | Yes | Minimum billable count; proforma; advance |
| **Expected Max pax** | (new) | At booking (every status) | Yes | Kitchen production, seating, staffing, hall capacity warnings |
| **Actual pax** | "Max Pax" as described in the doc | After the function (Function Completed) | Yes, before billing | Final billing |

## 2. Validation

- Guaranteed ≥ 1.
- Expected Max ≥ Guaranteed.
- Guaranteed ≤ hall Capacity (covers). Blocks saving unless the user has the "override capacity" permission.
- Expected Max > hall Capacity shows a warning only.
- Actual ≥ 0. If Actual > Expected Max, or Actual > hall Capacity, show a warning and ask for a remark; do not block.

## 3. The billing rule

For anything billed **per pax** (packages, and any per-pax hall or service charge):

```
Billable pax = max(Guaranteed pax, Actual pax)
Line amount  = Billable pax × package rate
```

Ala-carte items are always billed on the quantities actually ordered, never on pax. Services are billed on their own quantity (for example 1 projector, 2 dance floors).

### Examples

| Guaranteed | Expected Max | Actual | Billable | Why |
|---|---|---|---|---|
| 100 | 120 | 80 | **100** | Fewer than guaranteed came. Bill the guarantee (the doc's own example). |
| 100 | 120 | 110 | **110** | More than guaranteed came. Bill actual. |
| 100 | 120 | 130 | **130** | More than Expected Max came. Bill actual, with a warning and remark. |
| 100 | 100 | 100 | **100** | Exact. |

## 4. Changing the guarantee

- Before the **guarantee cut-off** (**[Proposed default]** 72 hours before start), Guaranteed pax can go up or down. Each change is an amendment with a reason.
- After the cut-off, Guaranteed pax can only go **up**. Lowering it needs a manager role and an Amendment Reason.
- The cut-off is a per-property setting.

## 5. Several packages in one booking

A booking can have more than one package, for example 60 guests on "Buffet Lunch Veg" and 40 on "Buffet Lunch Non-Veg".

**[Proposed default]** Each package line carries its own Guaranteed and Actual count, and the max rule applies **per line**. The booking-level Guaranteed and Actual are the sums of the lines. This avoids a guest who guaranteed 60 veg + 40 non-veg being billed oddly if 30 veg + 70 non-veg turn up.

Example: Veg G=60, A=30, so billable 60. Non-Veg G=40, A=70, so billable 70. Total billable 130, although 100 guests came. This is the strict reading of the rule; see the open question below.

## 6. Open questions

1. **Per-line vs. booking-level max.** The per-line rule above can bill more pax than attended when guests switch packages. Alternative: apply the max at booking level and split the billable count across lines in proportion to actuals. Which does the hotel want?
2. **Children / drivers / staff meals.** Are children counted at a reduced rate, or as a separate package line? Are vendor staff or drivers counted?
3. **Upper tolerance.** Some venues charge a different rate above Expected Max, or cap the rate at guaranteed + x%. Is this needed?

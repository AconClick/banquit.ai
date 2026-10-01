# BanquetFlow documentation

Functional specs that fill the gaps in the original BanquetFlow requirements document.

| Document | What it covers |
|---|---|
| [Product scope](product-scope.md) | Serving every segment, from small venues to luxury chains, and what that means for the design |
| [Reservation stages](workflows/reservation-stages.md) | Booking statuses (Enquiry, Provisional, Waitlisted, Confirmed, ...), transitions, amendments, cancellation |
| [Billing stages](workflows/billing-stages.md) | From proforma and advance to final bill and settlement, built from PAS (Packages, Ala-carte, Services) |
| [Guest count rules](workflows/guest-count-rules.md) | Guaranteed, Expected Max and Actual pax, and the "bill the higher of Guaranteed and Actual" rule |
| [Sign-up and login](workflows/login-and-tenancy.md) | Tenant sub-domains, the `entp` master user, Domain → User Id → Password → Activity login, security rules |
| [Open questions](workflows/open-questions.md) | Advances, cancellation charges, amendments, tax-inclusive packages, with proposed defaults |
| [Security review](security-review.md) | Findings from the pre-go-live review, what was fixed, what is left |
| [Going live on AWS](ops/go-live.md) | Step-by-step checklist from an empty AWS account to the first release |
| [Backup and restore](ops/backup-and-restore.md) | MongoDB Atlas backups, off-site copy, restore steps and the restore drill |
| [Monitoring](ops/monitoring.md) | Health checks, logs, alarms and what to check when one fires |

Anything marked **[Proposed default]** is not in the original document and needs confirming by the business.

Assumed stack: Angular, NestJS, MongoDB, AWS, multi-tenant by sub-domain.

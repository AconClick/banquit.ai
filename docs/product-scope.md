# Product Scope: From Small Hotels to Luxury Chains

Banquet.ai must work equally well for every kind of banqueting business, from a single restaurant with one party hall to high-end and luxury hotel groups (Marriott and Rosewood are two examples among many). This is a product requirement confirmed by Awin Pavan on 2026-10-01. Every feature should be designed so that it is **simple by default and deep when switched on**.

## 1. Who the product is for

| Segment | Example | Typical setup | What matters most |
|---|---|---|---|
| **Restaurant / small venue** | A restaurant with one banquet hall | 1 property, 1–3 halls, 2–5 users | Quick setup, low price, simple diary and bill, works on a phone |
| **Independent hotel** | A 100-room city hotel | 1 property, 3–10 halls, 5–25 users | Packages, advances, GST billing, function sheets |
| **Regional chain / group** | A group with 10 hotels across states | Several companies and properties, 50–300 users | Central reporting, shared menus and packages, role control per property |
| **Luxury / international chain** | Marriott, Rosewood, and similar | Many brands, hundreds of properties, many countries, thousands of users | Brand standards, multi-currency and multi-tax, single sign-on, integrations with their existing systems, audit and security reviews |

## 2. What this means for the design

### Organisation structure

- The structure must scale from one level to many. **[Proposed]** Tenant → (optional) Brand / Region → Company → Property → Hall.
- A small venue never sees Brand, Region or Company screens: they are created automatically with default values and hidden until switched on.
- Masters (menus, packages, taxes, services) can be defined at **group level and inherited** by properties, with property-level overrides. Chains need brand-standard packages; small venues just create their own.

### Simple mode and full mode

- **[Proposed]** Each tenant chooses a **feature level** in Master Settings. Advanced features (approval steps, bill review, instalment advances, multi-currency, waitlists, amendments with revisions) are switched on as needed.
- A small venue can go from sign-up to first booking in under an hour, using a setup wizard with sensible defaults.

### Money and tax

- **Multi-currency:** each property has its own currency (already in Property Setup). Group reports convert to a reporting currency.
- **Multi-country tax:** the Tax Master and Rate & Tax Mapping must not assume Indian GST. They must support other countries' taxes, service charges and compound taxes, with validity dates.
- **Multi-language** screens and printouts (bills, function sheets, proformas). English first.
- Date, time and number formats per property.

### Login and security for large clients

- **Single sign-on (SSO)** with the chain's own identity system (SAML or OpenID Connect, e.g. Microsoft Entra ID, Okta), as well as the normal user id and password.
- Custom domains and OTP for Master access are already decided (see [login-and-tenancy.md](workflows/login-and-tenancy.md)).
- Detailed audit logs, exportable for the client's security team.
- **[Proposed]** Data stored in the client's chosen region where the law requires it (data residency).

### Integrations

Large hotels already run other systems. **[Proposed]** Banquet.ai should offer a public API and, over time, connectors to:

- **Property Management Systems (PMS)** such as Oracle OPERA, so banquet charges can post to a guest or group folio.
- **Point of Sale (POS)** systems, for ala-carte orders during functions.
- **Accounting / ERP**, for invoices and receipts.
- **CRM and sales tools**, for leads that become enquiries.
- **Payment gateways**, for advances and online payment links.

### Scale and reliability

- The system must stay fast for a single tenant with hundreds of properties and many thousands of bookings a year. Every query is limited to one tenant and, where possible, one property.
- **[Proposed]** Uptime target of 99.9%, daily backups, and point-in-time restore.
- Tenant data is fully isolated (see the security rules in the login document).

### Pricing tiers

**[Proposed]** Feature levels line up with plans, for example:

| Plan | For | Includes |
|---|---|---|
| Starter | Restaurants, small venues | 1 property, diary, packages, billing |
| Professional | Independent hotels | Advances, amendments, approvals, reports |
| Group | Chains | Multiple properties, group masters, central reports |
| Enterprise | Luxury / international chains | SSO, integrations, multi-country tax, data residency, dedicated support |

## 3. Rules for everyone building Banquet.ai

1. Never hard-code anything a different-sized client would want differently. Make it a setting with a sensible default.
2. Never assume India-only rules (GST, INR, DLT) in core logic. Keep them as configuration for Indian properties.
3. Every new screen must work for a one-hall venue without extra clicks, and for a 500-property chain without slowing down.

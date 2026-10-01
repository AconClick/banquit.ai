/** Merging and checking the GST part of Billing Setup. */
import { DEFAULT_GST, GST_ROLES, GST_STATES, gstSetupProblems, type GstRole, type GstSetup, type SacCodes } from './gst.js';

export type GstSetupInput = Partial<Omit<GstSetup, 'sac' | 'taxRoles'>> & { sac?: Partial<SacCodes>; taxRoles?: Record<string, GstRole | ''> };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Merges a change into the property's GST setup. propertyTaxIds: the taxes set up for the property. */
export function mergeGst(current: GstSetup, input: GstSetupInput | undefined, propertyTaxIds: string[], problems: string[]): GstSetup {
  const next: GstSetup = { ...DEFAULT_GST, ...current, sac: { ...DEFAULT_GST.sac, ...current.sac }, taxRoles: { ...current.taxRoles } };
  if (!input) return next;
  if (input.enabled !== undefined) next.enabled = input.enabled === true;
  if (input.eInvoice !== undefined) next.eInvoice = input.eInvoice === true;
  const gstin = text(input.gstin, 15);
  if (gstin !== undefined) next.gstin = gstin.toUpperCase();
  for (const [k, max] of [['legalName', 100], ['tradeName', 100], ['address1', 100], ['address2', 100], ['location', 50], ['pincode', 6]] as const) {
    const v = text(input[k], max);
    if (v !== undefined) next[k] = v;
  }
  if (next.gstin.length >= 2 && GST_STATES[next.gstin.slice(0, 2)]) next.stateCode = next.gstin.slice(0, 2);
  if (input.sac) {
    for (const k of Object.keys(DEFAULT_GST.sac) as (keyof SacCodes)[]) {
      const v = text(input.sac[k], 8);
      if (v !== undefined) next.sac[k] = v;
    }
  }
  if (input.taxRoles) {
    for (const [id, role] of Object.entries(input.taxRoles)) {
      if (!role) { delete next.taxRoles[id]; continue; }
      if (!propertyTaxIds.includes(id)) problems.push('GST: choose roles only for taxes set up for this property.');
      else if (!GST_ROLES.includes(role)) problems.push('GST: choose CGST, SGST, IGST, GST or cess for each tax.');
      else next.taxRoles[id] = role;
    }
  }
  problems.push(...gstSetupProblems(next));
  if (next.eInvoice && !next.enabled) problems.push('GST: turn on the GST invoice format before e-invoicing.');
  return next;
}

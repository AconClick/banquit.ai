/**
 * Print Setup: how a property's proforma, bill and credit note look on paper. Pure defaults and
 * validation; stored on the property's billing setup.
 */

export interface PrintSetup {
  /** A small PNG, JPEG or WebP as a data URL (the screen shrinks it before upload). Empty for none. */
  logo: string;
  /** Printed in the header instead of the tenant name, e.g. the company's registered name. */
  legalName: string;
  /** Address, phone, email: one entry per line under the name. */
  headerLines: string;
  /** Registration shown in the header, e.g. "GSTIN 32ABCDE1234F1Z5" or "VAT No 300000000000003". */
  registration: string;
  billTitle: string;
  proformaTitle: string;
  creditNoteTitle: string;
  /** Printed under the totals of the proforma only (validity, advance terms). */
  proformaNote: string;
  /** Bank details for transfers. */
  bankDetails: string;
  terms: string;
  footer: string;
  signatureLabel: string;
  showDiscountColumn: boolean;
  showTaxColumn: boolean;
  paperSize: 'A4' | 'Letter';
}

export const DEFAULT_PRINT: PrintSetup = {
  logo: '',
  legalName: '',
  headerLines: '',
  registration: '',
  billTitle: 'Tax invoice',
  proformaTitle: 'Proforma invoice',
  creditNoteTitle: 'Credit note',
  proformaNote: 'This is an estimate on guaranteed pax, not a tax invoice. The final bill uses the higher of guaranteed and actual guests, and the taxes in force on the function date.',
  bankDetails: '',
  terms: '',
  footer: '',
  signatureLabel: 'Authorised signatory',
  showDiscountColumn: true,
  showTaxColumn: true,
  paperSize: 'A4',
};

/** About 64 KB of image: plenty for a logo shrunk to 600 × 200, and well inside the request limit. */
export const LOGO_MAX_CHARS = 90_000;

const TEXTS: [keyof PrintSetup, string, number][] = [
  ['legalName', 'Name on documents', 120],
  ['headerLines', 'Header lines', 600],
  ['registration', 'Registration', 80],
  ['billTitle', 'Bill title', 40],
  ['proformaTitle', 'Proforma title', 40],
  ['creditNoteTitle', 'Credit note title', 40],
  ['proformaNote', 'Proforma note', 600],
  ['bankDetails', 'Bank details', 600],
  ['terms', 'Terms and conditions', 2000],
  ['footer', 'Footer', 300],
  ['signatureLabel', 'Signature label', 60],
];

/** Merges a change into the current print setup, collecting problems in words. */
export function mergePrint(current: PrintSetup, input: Partial<PrintSetup> | undefined, problems: string[]): PrintSetup {
  const next: PrintSetup = { ...current };
  if (!input) return next;
  for (const [key, label, max] of TEXTS) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') { problems.push(`${label} must be text.`); continue; }
    const t = v.trim();
    if (t.length > max) problems.push(`${label}: keep it to ${max} characters.`);
    else (next[key] as string) = t;
  }
  for (const key of ['billTitle', 'proformaTitle', 'creditNoteTitle', 'signatureLabel'] as const) {
    if (!next[key]) next[key] = DEFAULT_PRINT[key];
  }
  if (input.logo !== undefined) {
    if (input.logo === '' || input.logo === null) next.logo = '';
    else if (typeof input.logo !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.logo)) problems.push('The logo must be a PNG, JPEG or WebP image.');
    else if (input.logo.length > LOGO_MAX_CHARS) problems.push('The logo is too large. Use a smaller image (under about 60 KB).');
    else next.logo = input.logo;
  }
  for (const key of ['showDiscountColumn', 'showTaxColumn'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') problems.push('Column choices must be yes or no.');
    else next[key] = input[key];
  }
  if (input.paperSize !== undefined) {
    if (input.paperSize !== 'A4' && input.paperSize !== 'Letter') problems.push('Choose A4 or Letter paper.');
    else next.paperSize = input.paperSize;
  }
  return next;
}

/**
 * Master Data Set from the requirements document, described as data so that the backend
 * (validation, storage) and the web app (lists and forms) share one definition.
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'enum'
  /** One record of another master. */
  | 'ref'
  /** Several records of another master. */
  | 'refs'
  /** Package menu rules: per sub-group, a min / max pick from a list of items. */
  | 'packageGroups';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** text: max length. */
  maxLength?: number;
  /** text: must match, e.g. currency codes. */
  pattern?: string;
  patternHint?: string;
  /** text: stored in capitals. */
  uppercase?: boolean;
  /** text: must be a time zone name such as Asia/Kolkata. */
  timeZone?: boolean;
  /** number: lowest and highest allowed values, and whether decimals are allowed. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** enum options as value → label. */
  options?: Record<string, string>;
  /** ref / refs: the master kind referred to. */
  refKind?: string;
  /** Shown in the list table. */
  list?: boolean;
  /** Value used when the field is left empty. */
  default?: unknown;
  hint?: string;
}

export interface MasterDef {
  kind: string;
  /** Plural, for the menu and page title. */
  label: string;
  /** Singular, for buttons and messages. */
  singular: string;
  group: 'Organisation' | 'Event' | 'Money & tax' | 'Menu' | 'Reasons & lists';
  /** The field shown when another master refers to a record of this one. */
  display: string;
  /** Field that must be unique within the tenant (case-insensitive). */
  unique: string;
  fields: FieldDef[];
}

const code = (label = 'Code'): FieldDef => ({ key: 'code', label, type: 'text', required: true, maxLength: 20, list: true });
const description = (label = 'Description'): FieldDef => ({
  key: 'description', label, type: 'text', required: true, maxLength: 120, list: true,
});
const place: FieldDef[] = [
  { key: 'city', label: 'City', type: 'text', required: true, maxLength: 80, list: true },
  { key: 'state', label: 'State', type: 'text', required: true, maxLength: 80, list: true },
  { key: 'country', label: 'Country', type: 'text', required: true, maxLength: 80, list: true },
];

/** Items shared by the whole group unless limited to some properties. */
const onlyAt: FieldDef = {
  key: 'propertyIds', label: 'Only at these properties', type: 'refs', refKind: 'property', default: [],
  hint: 'Leave all unticked to offer it at every property. Prices and taxes per property are set in Rate & Tax Mapping.',
};

/** A master that is just one line of text, e.g. Seating Style or Cancellation Reason. */
const simple = (kind: string, label: string, singular: string, group: MasterDef['group']): MasterDef => ({
  kind, label, singular, group, display: 'description', unique: 'description', fields: [description()],
});

export const MASTERS: MasterDef[] = [
  {
    kind: 'company', label: 'Companies', singular: 'Company', group: 'Organisation',
    display: 'name', unique: 'name',
    fields: [{ key: 'name', label: 'Company name', type: 'text', required: true, maxLength: 120, list: true }, ...place],
  },
  {
    kind: 'property', label: 'Properties', singular: 'Property', group: 'Organisation',
    display: 'name', unique: 'name',
    fields: [
      { key: 'name', label: 'Property name', type: 'text', required: true, maxLength: 120, list: true },
      { key: 'companyId', label: 'Company', type: 'ref', refKind: 'company', required: true, list: true },
      ...place,
      {
        key: 'currency', label: 'Currency', type: 'text', required: true, pattern: '^[A-Z]{3}$',
        patternHint: 'a 3-letter currency code such as INR, USD or AED', uppercase: true, list: true, default: 'INR',
      },
      {
        key: 'timeZone', label: 'Time zone', type: 'text', required: true, maxLength: 60, timeZone: true, default: 'Asia/Kolkata',
        hint: 'Where the property is, e.g. Asia/Kolkata, Asia/Dubai or Europe/London. Sets "today" for payments, receipts and the financial year.',
      },
    ],
  },
  {
    kind: 'hall', label: 'Halls / Venues', singular: 'Hall', group: 'Organisation',
    display: 'description', unique: 'description',
    fields: [
      description('Hall name'),
      { key: 'propertyId', label: 'Property', type: 'ref', refKind: 'property', required: true, list: true },
      { key: 'capacity', label: 'Capacity (covers)', type: 'number', required: true, min: 1, integer: true, list: true },
      { key: 'areaSqFt', label: 'Total area (sq ft)', type: 'number', required: true, min: 0, list: true },
      {
        key: 'bufferMinutes', label: 'Setup / cleanup buffer (minutes)', type: 'number', min: 0, max: 1440,
        integer: true, default: 0, hint: 'Gap kept free between two bookings in this hall.',
      },
    ],
  },
  simple('functionType', 'Function / Event Types', 'Function Type', 'Event'),
  simple('seatingStyle', 'Seating Styles', 'Seating Style', 'Event'),
  {
    kind: 'tax', label: 'Taxes', singular: 'Tax', group: 'Money & tax',
    display: 'description', unique: 'description',
    fields: [
      description('Tax description'),
      { key: 'taxType', label: 'Tax type', type: 'enum', required: true, options: { percentage: 'Percentage', fixed: 'Fixed rate' }, list: true },
      { key: 'rate', label: 'Tax rate', type: 'number', required: true, min: 0, list: true, hint: 'Percent for percentage taxes, an amount for fixed-rate taxes.' },
      { key: 'validFrom', label: 'Valid from', type: 'date', required: true, list: true },
      { key: 'validTill', label: 'Valid till', type: 'date', list: true, hint: 'Leave empty if it has no end date.' },
      { key: 'propertyIds', label: 'Properties', type: 'refs', refKind: 'property', required: true },
    ],
  },
  {
    kind: 'incomeExpenseHead', label: 'Income / Expense Heads', singular: 'Income / Expense Head', group: 'Money & tax',
    display: 'description', unique: 'code',
    fields: [code('Inc / Exp code'), description('Inc / Exp description')],
  },
  {
    kind: 'mainGroup', label: 'Main Groups', singular: 'Main Group', group: 'Menu',
    display: 'description', unique: 'code',
    fields: [code('Group code'), description()],
  },
  {
    kind: 'subGroup', label: 'Sub-Groups', singular: 'Sub-Group', group: 'Menu',
    display: 'description', unique: 'code',
    fields: [code('Sub-group code'), description(), { key: 'mainGroupId', label: 'Main group', type: 'ref', refKind: 'mainGroup', required: true, list: true }],
  },
  {
    kind: 'unit', label: 'Units', singular: 'Unit', group: 'Menu',
    display: 'description', unique: 'description',
    fields: [description(), { key: 'shortDescription', label: 'Short description', type: 'text', required: true, maxLength: 10, list: true }],
  },
  {
    kind: 'menuItem', label: 'Menu Items', singular: 'Menu Item', group: 'Menu',
    display: 'description', unique: 'code',
    fields: [
      code('Menu code'),
      description('Menu description'),
      { key: 'subGroupId', label: 'Sub-group', type: 'ref', refKind: 'subGroup', required: true, list: true },
      { key: 'unitId', label: 'Unit', type: 'ref', refKind: 'unit', required: true },
      { key: 'defaultRate', label: 'Default rate', type: 'number', required: true, min: 0, list: true },
      { key: 'aType', label: 'A-Type', type: 'enum', required: true, options: { package: 'Package', alacarte: 'Ala Carte', services: 'Services' }, list: true },
      { key: 'incomeExpenseHeadId', label: 'Inc / Exp head', type: 'ref', refKind: 'incomeExpenseHead', required: true },
      { key: 'fixedCostPercent', label: 'Fixed cost %', type: 'number', min: 0, max: 100, default: 0 },
      onlyAt,
    ],
  },
  {
    kind: 'modifier', label: 'Modifiers', singular: 'Modifier', group: 'Menu',
    display: 'description', unique: 'code',
    fields: [
      code('Modifier code'),
      description(),
      { key: 'unitId', label: 'Unit', type: 'ref', refKind: 'unit', required: true, list: true },
      { key: 'rate', label: 'Rate', type: 'number', required: true, min: 0, list: true },
      { key: 'incomeExpenseHeadId', label: 'Inc / Exp head', type: 'ref', refKind: 'incomeExpenseHead', required: true },
      onlyAt,
    ],
  },
  {
    kind: 'package', label: 'Packages', singular: 'Package', group: 'Menu',
    display: 'description', unique: 'code',
    fields: [
      code('Package code'),
      description('Package name'),
      { key: 'ratePerPax', label: 'Rate per pax', type: 'number', required: true, min: 0, list: true },
      { key: 'taxInclusive', label: 'Rate includes tax', type: 'boolean', default: false, list: true },
      { key: 'propertyIds', label: 'Properties', type: 'refs', refKind: 'property', required: true },
      { key: 'incomeExpenseHeadId', label: 'Inc / Exp head', type: 'ref', refKind: 'incomeExpenseHead', required: true },
      {
        key: 'groups', label: 'Menu selection rules', type: 'packageGroups', required: true,
        hint: 'For each sub-group, the items the guest can choose from and how many they must pick.',
      },
    ],
  },
  simple('vendor', 'Vendors', 'Vendor', 'Reasons & lists'),
  simple('billingInstruction', 'Billing Instructions', 'Billing Instruction', 'Reasons & lists'),
  simple('cancellationReason', 'Cancellation Reasons', 'Cancellation Reason', 'Reasons & lists'),
  simple('amendmentReason', 'Amendment Reasons', 'Amendment Reason', 'Reasons & lists'),
  simple('hallBlockReason', 'Hall Block Reasons', 'Hall Block Reason', 'Reasons & lists'),
];

export const MASTER_BY_KIND = new Map(MASTERS.map((m) => [m.kind, m]));

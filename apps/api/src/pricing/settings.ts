/**
 * Business rules each property can change in Property Settings. The defaults are the proposed
 * answers in docs/workflows/open-questions.md, accepted by the client on 2026-10-01.
 */
export interface CancellationSlab {
  /** Applies when the booking is cancelled at least this many days before the function. */
  fromDays: number;
  /** Share of the proforma total charged. */
  percent: number;
}

export type TaxGroup = 'package' | 'alacarte' | 'services';

export interface PropertySettingsValues {
  /** Provisional bookings: the default option date is this many days from today... */
  optionDays: number;
  /** ...but no later than this many days before the function. */
  optionBeforeFunctionDays: number;
  /** Menu and guarantee are frozen this many hours before the function. */
  guaranteeCutoffHours: number;
  /** Advance needed to confirm, as a percentage of the proforma total. 0 turns the rule off. */
  advancePercent: number;
  /** Total paid expected by the second instalment, as a percentage of the proforma. 0 turns it off. */
  secondInstalmentPercent: number;
  secondInstalmentDaysBefore: number;
  cancellationSlabs: CancellationSlab[];
  /** Round the bill total to a whole currency unit, with a round-off line. */
  roundTotal: boolean;
  /** Taxes applied by default to each A-Type, unless Rate & Tax Mapping says otherwise. */
  defaultTaxIds: Record<TaxGroup, string[]>;
}

export const DEFAULT_SETTINGS: PropertySettingsValues = {
  optionDays: 7,
  optionBeforeFunctionDays: 3,
  guaranteeCutoffHours: 72,
  advancePercent: 25,
  secondInstalmentPercent: 75,
  secondInstalmentDaysBefore: 7,
  cancellationSlabs: [
    { fromDays: 31, percent: 0 },
    { fromDays: 15, percent: 25 },
    { fromDays: 7, percent: 50 },
    { fromDays: 0, percent: 100 },
  ],
  roundTotal: true,
  defaultTaxIds: { package: [], alacarte: [], services: [] },
};

export const withDefaults = (saved: Partial<PropertySettingsValues> | undefined): PropertySettingsValues => ({
  ...DEFAULT_SETTINGS,
  ...saved,
  defaultTaxIds: { ...DEFAULT_SETTINGS.defaultTaxIds, ...saved?.defaultTaxIds },
});

/** Returns the problems with a settings object, or an empty list. */
export function settingsProblems(v: PropertySettingsValues): string[] {
  const problems: string[] = [];
  const whole = (n: unknown, min: number, max: number, label: string) => {
    if (!Number.isInteger(n) || (n as number) < min || (n as number) > max) problems.push(`${label} must be a whole number from ${min} to ${max}.`);
  };
  const pct = (n: unknown, label: string) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) problems.push(`${label} must be a percentage from 0 to 100.`);
  };
  whole(v.optionDays, 0, 365, 'Option period');
  whole(v.optionBeforeFunctionDays, 0, 365, 'Latest option date');
  whole(v.guaranteeCutoffHours, 0, 720, 'Guarantee cut-off');
  pct(v.advancePercent, 'Advance to confirm');
  pct(v.secondInstalmentPercent, 'Second instalment');
  whole(v.secondInstalmentDaysBefore, 0, 365, 'Second instalment due');
  if (typeof v.roundTotal !== 'boolean') problems.push('Round the total must be yes or no.');
  if (!Array.isArray(v.cancellationSlabs) || v.cancellationSlabs.length === 0) {
    problems.push('Add at least one cancellation slab.');
  } else {
    v.cancellationSlabs.forEach((s, i) => {
      whole(s?.fromDays, 0, 3650, `Cancellation slab ${i + 1}: days before`);
      pct(s?.percent, `Cancellation slab ${i + 1}: charge`);
    });
    const days = v.cancellationSlabs.map((s) => s?.fromDays);
    if (new Set(days).size !== days.length) problems.push('Two cancellation slabs start at the same number of days.');
    if (!days.includes(0)) problems.push('One cancellation slab must start at 0 days, for late cancellations.');
  }
  for (const g of ['package', 'alacarte', 'services'] as TaxGroup[]) {
    const ids = v.defaultTaxIds?.[g];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) problems.push(`Default taxes for ${g} must be a list.`);
  }
  return problems;
}

/** The slab for a cancellation made daysBefore days ahead of the function. */
export function slabFor(slabs: CancellationSlab[], daysBefore: number): CancellationSlab {
  const sorted = [...slabs].sort((a, b) => b.fromDays - a.fromDays);
  return sorted.find((s) => daysBefore >= s.fromDays) ?? sorted[sorted.length - 1];
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MastersService } from '../masters/masters.service.js';
import { currencyDecimals } from '../pricing/money.js';
import { Counter } from '../reservations/reservation.schema.js';
import { BillingSetup, SERIES_DOCUMENTS, type Series, type SeriesDocument } from './billing-setup.schema.js';
import { DEFAULT_GST, GST_STATES, type GstSetup } from './gst.js';
import { mergeGst, type GstSetupInput } from './gst-setup.js';
import { DEFAULT_PRINT, mergePrint, type PrintSetup } from './print-setup.js';
import { DEFAULT_FY_START_MONTH, DEFAULT_SERIES, SERIES_LABELS, counterName, expandPrefix, financialYear, formatNumber, GST_NUMBER_MAX, seriesProblems } from './series.js';

export interface BillingSetupValues {
  fyStartMonth: number;
  series: Record<SeriesDocument, Series>;
  print: PrintSetup;
  gst: GstSetup;
}

export interface BillingSetupInput {
  fyStartMonth?: number;
  series?: Partial<Record<SeriesDocument, Series>>;
  print?: Partial<PrintSetup>;
  gst?: GstSetupInput;
  /** Start the current year's series at this number (moving from another system). Never lower than the next number. */
  nextNumbers?: Partial<Record<SeriesDocument, number>>;
}

const defaults = (): BillingSetupValues => ({
  fyStartMonth: DEFAULT_FY_START_MONTH,
  series: { bill: { ...DEFAULT_SERIES.bill }, creditNote: { ...DEFAULT_SERIES.creditNote } },
  print: { ...DEFAULT_PRINT },
  gst: { ...DEFAULT_GST, sac: { ...DEFAULT_GST.sac }, taxRoles: {} },
});

/** Per-property billing setup: Series Setup, Print Setup and GST. */
@Injectable()
export class BillingSetupService {
  constructor(
    @InjectModel(BillingSetup.name) private readonly setups: Model<BillingSetup>,
    @InjectModel(Counter.name) private readonly counters: Model<Counter>,
    private readonly masters: MastersService,
  ) {}

  async values(tenantId: Types.ObjectId, propertyId: string): Promise<BillingSetupValues> {
    const saved = await this.setups.findOne({ tenantId, propertyId }).lean();
    const d = defaults();
    if (!saved) return d;
    return {
      fyStartMonth: saved.fyStartMonth ?? d.fyStartMonth,
      series: Object.fromEntries(SERIES_DOCUMENTS.map((k) => [k, { ...d.series[k], ...saved.series?.[k] }])) as Record<SeriesDocument, Series>,
      print: { ...d.print, ...saved.print },
      gst: { ...d.gst, ...saved.gst, sac: { ...d.gst.sac, ...saved.gst?.sac }, taxRoles: { ...saved.gst?.taxRoles } },
    };
  }

  /** The property's currency and its decimals (3 for KWD, BHD, OMR). */
  async money(tenantId: Types.ObjectId, propertyId: string) {
    const property = await this.masters.get(tenantId, 'property', propertyId).catch(() => null);
    const currency = String(property?.values.currency ?? 'INR');
    return { currency, decimals: currencyDecimals(currency) };
  }

  /** The setup screen: saved values, and what the next numbers will be today. */
  async view(tenantId: Types.ObjectId, propertyId: string) {
    await this.property(tenantId, propertyId);
    const values = await this.values(tenantId, propertyId);
    const today = await this.masters.propertyToday(tenantId, propertyId);
    const fy = financialYear(today, values.fyStartMonth);
    const next = {} as Record<SeriesDocument, { number: string; seq: number }>;
    for (const doc of SERIES_DOCUMENTS) {
      const seq = (await this.current(tenantId, doc, propertyId, values.series[doc], fy)) + 1;
      next[doc] = { seq, number: formatNumber(values.series[doc], fy, seq) };
    }
    return { propertyId, ...values, financialYear: fy, next, ...(await this.money(tenantId, propertyId)), gstStates: GST_STATES };
  }

  async save(tenantId: Types.ObjectId, propertyId: string, input: BillingSetupInput) {
    await this.property(tenantId, propertyId);
    const current = await this.values(tenantId, propertyId);
    const problems: string[] = [];
    const fyStartMonth = input.fyStartMonth ?? current.fyStartMonth;
    if (!Number.isInteger(fyStartMonth) || fyStartMonth < 1 || fyStartMonth > 12) problems.push('Choose the month the financial year starts.');
    const series = {} as Record<SeriesDocument, Series>;
    for (const doc of SERIES_DOCUMENTS) {
      const s = { ...current.series[doc], ...input.series?.[doc] };
      if (typeof s.prefix === 'string') s.prefix = s.prefix.trim();
      problems.push(...seriesProblems(SERIES_LABELS[doc], s));
      series[doc] = { prefix: s.prefix, digits: s.digits, resetYearly: s.resetYearly };
    }
    const print = mergePrint(current.print, input.print, problems);
    const taxes = await this.masters.list(tenantId, 'tax', true);
    const propertyTaxIds = taxes.filter((t) => (t.values.propertyIds as string[] | undefined)?.includes(propertyId)).map((t) => t.id as string);
    const gst = mergeGst(current.gst, input.gst, propertyTaxIds, problems);
    if (expandPrefix(series.bill.prefix, '2026-27') === expandPrefix(series.creditNote.prefix, '2026-27')) {
      problems.push('Bills and credit notes need different prefixes.');
    }
    if (gst.enabled) {
      for (const doc of SERIES_DOCUMENTS) {
        const sample = formatNumber(series[doc], '2026-27', 1);
        if (sample.length > GST_NUMBER_MAX) problems.push(`${SERIES_LABELS[doc]}: a GST invoice number is at most ${GST_NUMBER_MAX} characters, and ${sample} is ${sample.length}. Shorten the prefix or use {FYSHORT}.`);
      }
    }
    if (problems.length) throw new BadRequestException(problems);

    // A new starting number applies to this financial year's series, and can only move it forward.
    const fy = financialYear(await this.masters.propertyToday(tenantId, propertyId), fyStartMonth);
    const starts: [SeriesDocument, number][] = [];
    for (const doc of SERIES_DOCUMENTS) {
      const n = input.nextNumbers?.[doc];
      if (n === undefined || n === null) continue;
      const used = await this.current(tenantId, doc, propertyId, series[doc], fy);
      if (!Number.isInteger(n) || n < 1 || n > 10 ** series[doc].digits - 1) problems.push(`${SERIES_LABELS[doc]}: the next number must be a whole number that fits in ${series[doc].digits} digits.`);
      else if (n <= used) problems.push(`${SERIES_LABELS[doc]}: numbers up to ${used} are already used this year, so the next is at least ${used + 1}.`);
      else starts.push([doc, n]);
    }
    if (problems.length) throw new BadRequestException(problems);

    await this.setups.findOneAndUpdate({ tenantId, propertyId }, { $set: { fyStartMonth, series, print, gst } }, { upsert: true });
    for (const [doc, n] of starts) {
      await this.counters.findOneAndUpdate(
        { tenantId, name: counterName(doc, propertyId, series[doc], fy) }, { $max: { seq: n - 1 } }, { upsert: true },
      );
    }
    return this.view(tenantId, propertyId);
  }

  async gst(tenantId: Types.ObjectId, propertyId: string) {
    return (await this.values(tenantId, propertyId)).gst;
  }

  /** How the property's documents are printed. */
  async print(tenantId: Types.ObjectId, propertyId: string) {
    return (await this.values(tenantId, propertyId)).print;
  }

  /** Takes the next number in the property's series for a document dated today at the property. */
  async take(tenantId: Types.ObjectId, propertyId: string, doc: SeriesDocument) {
    const { fyStartMonth, series } = await this.values(tenantId, propertyId);
    const fy = financialYear(await this.masters.propertyToday(tenantId, propertyId), fyStartMonth);
    const c = await this.counters.findOneAndUpdate(
      { tenantId, name: counterName(doc, propertyId, series[doc], fy) }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' },
    );
    return { number: formatNumber(series[doc], fy, c!.seq), financialYear: fy };
  }

  private async current(tenantId: Types.ObjectId, doc: SeriesDocument, propertyId: string, series: Series, fy: string) {
    const c = await this.counters.findOne({ tenantId, name: counterName(doc, propertyId, series, fy) }).lean();
    return c?.seq ?? 0;
  }

  private async property(tenantId: Types.ObjectId, propertyId: string) {
    const p = await this.masters.get(tenantId, 'property', propertyId).catch(() => null);
    if (!p) throw new NotFoundException('Property not found.');
    return p;
  }
}

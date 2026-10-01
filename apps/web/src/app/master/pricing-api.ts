import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PackageGroup } from './masters-store';

export type TaxGroup = 'package' | 'alacarte' | 'services';
export type PricedKind = 'package' | 'menuItem' | 'modifier';

export interface PropertySettings {
  optionDays: number;
  optionBeforeFunctionDays: number;
  guaranteeCutoffHours: number;
  advancePercent: number;
  secondInstalmentPercent: number;
  secondInstalmentDaysBefore: number;
  cancellationSlabs: { fromDays: number; percent: number }[];
  roundTotal: boolean;
  defaultTaxIds: Record<TaxGroup, string[]>;
}

export interface PricedItem {
  kind: PricedKind;
  id: string;
  code: string;
  name: string;
  aType: TaxGroup;
  unit: string | null;
  offered: boolean;
  groupRate: number;
  rate: number;
  groupTaxInclusive: boolean;
  taxInclusive: boolean;
  taxIds: string[] | null;
  overridden: boolean;
  groups?: PackageGroup[];
}

export interface RateInput {
  offered: boolean;
  rate: number | null;
  taxInclusive: boolean | null;
  taxIds: string[] | null;
}

@Injectable({ providedIn: 'root' })
export class PricingApi {
  private readonly http = inject(HttpClient);

  settings = (propertyId: string) => firstValueFrom(this.http.get<PropertySettings>(`/api/properties/${propertyId}/settings`));
  saveSettings = (propertyId: string, s: PropertySettings) =>
    firstValueFrom(this.http.put<PropertySettings>(`/api/properties/${propertyId}/settings`, s));
  rates = (propertyId: string) => firstValueFrom(this.http.get<PricedItem[]>(`/api/properties/${propertyId}/rates`));
  saveRate = (propertyId: string, kind: PricedKind, itemId: string, input: RateInput) =>
    firstValueFrom(this.http.put<PricedItem>(`/api/properties/${propertyId}/rates/${kind}/${itemId}`, input));
}

export const TAX_GROUP_LABELS: Record<TaxGroup, string> = { package: 'Packages', alacarte: 'Ala carte', services: 'Services' };

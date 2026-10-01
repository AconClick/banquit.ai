import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'enum' | 'ref' | 'refs' | 'packageGroups';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  options?: Record<string, string>;
  refKind?: string;
  list?: boolean;
  default?: unknown;
  hint?: string;
  patternHint?: string;
}

export interface MasterDef {
  kind: string;
  label: string;
  singular: string;
  group: string;
  display: string;
  unique: string;
  fields: FieldDef[];
}

export interface MasterRecord {
  id: string;
  active: boolean;
  [key: string]: unknown;
}

export interface PackageGroup {
  subGroupId: string;
  min: number;
  max: number;
  itemIds: string[];
}

/** Master definitions (loaded once) and record lists (reloaded when a page asks). */
@Injectable({ providedIn: 'root' })
export class MastersStore {
  private readonly http = inject(HttpClient);
  readonly definitions = signal<MasterDef[]>([]);
  private loading?: Promise<MasterDef[]>;

  async defs(): Promise<MasterDef[]> {
    if (this.definitions().length) return this.definitions();
    this.loading ??= firstValueFrom(this.http.get<MasterDef[]>('/api/masters')).then((defs) => {
      this.definitions.set(defs);
      return defs;
    });
    try {
      return await this.loading;
    } catch (err) {
      this.loading = undefined;
      throw err;
    }
  }

  list(kind: string, includeInactive = false) {
    return firstValueFrom(
      this.http.get<MasterRecord[]>(`/api/masters/${kind}`, { params: includeInactive ? { includeInactive: 'true' } : {} }),
    );
  }

  create(kind: string, values: Record<string, unknown>) {
    return firstValueFrom(this.http.post<MasterRecord>(`/api/masters/${kind}`, values));
  }

  update(kind: string, id: string, values: Record<string, unknown>) {
    return firstValueFrom(this.http.put<MasterRecord>(`/api/masters/${kind}/${id}`, values));
  }

  setActive(kind: string, id: string, active: boolean) {
    return firstValueFrom(this.http.post<MasterRecord>(`/api/masters/${kind}/${id}/active`, { active }));
  }
}

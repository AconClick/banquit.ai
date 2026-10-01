import { DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { AdminApi, Plan } from './admin-api';

const blank = (): Plan => ({ code: '', name: '', currency: 'INR', monthlyPrice: 0, yearlyPrice: 0, maxProperties: 0, maxUsers: 0, active: true, notes: '' });

/** The subscription plans Banquet.ai sells. Limits of 0 mean no limit. */
@Component({
  selector: 'app-admin-plans',
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="page-head"><h1>Plans</h1><button class="primary" (click)="edit(null)">New plan</button></div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (editing(); as p) {
      <section class="card form">
        <h2>{{ isNew() ? 'New plan' : 'Edit ' + p.code }}</h2>
        <form (ngSubmit)="save()">
          <div class="row">
            <label>Code <input name="code" [(ngModel)]="p.code" [disabled]="!isNew()" required maxlength="20" placeholder="PRO" /></label>
            <label>Name <input name="name" [(ngModel)]="p.name" required maxlength="80" /></label>
            <label>Currency <input name="currency" [(ngModel)]="p.currency" maxlength="3" size="4" /></label>
          </div>
          <div class="row">
            <label>Monthly price <input name="monthly" type="number" min="0" step="0.01" [(ngModel)]="p.monthlyPrice" /></label>
            <label>Yearly price <input name="yearly" type="number" min="0" step="0.01" [(ngModel)]="p.yearlyPrice" /></label>
          </div>
          <div class="row">
            <label>Max properties (0 = no limit) <input name="maxProperties" type="number" min="0" step="1" [(ngModel)]="p.maxProperties" /></label>
            <label>Max users (0 = no limit) <input name="maxUsers" type="number" min="0" step="1" [(ngModel)]="p.maxUsers" /></label>
          </div>
          <label>Notes <input name="notes" [(ngModel)]="p.notes" maxlength="500" /></label>
          <label class="check"><input type="checkbox" name="active" [(ngModel)]="p.active" /> Offered to new clients</label>
          <div class="actions">
            <button type="button" class="link" (click)="editing.set(null)">Cancel</button>
            <button class="primary" [disabled]="busy() || !p.code || !p.name">Save plan</button>
          </div>
        </form>
      </section>
    }
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Code</th><th>Name</th><th class="right">Monthly</th><th class="right">Yearly</th><th>Limits</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          @for (p of plans(); track p.code) {
            <tr [class.inactive]="!p.active">
              <td>{{ p.code }}</td>
              <td>{{ p.name }}@if (!p.active) { <span class="pill">Not offered</span> }</td>
              <td class="right nowrap">{{ p.currency }} {{ p.monthlyPrice | number: '1.0-2' }}</td>
              <td class="right nowrap">{{ p.currency }} {{ p.yearlyPrice | number: '1.0-2' }}</td>
              <td>{{ p.maxProperties || 'Any' }} properties, {{ p.maxUsers || 'any' }} users</td>
              <td>{{ p.notes }}</td>
              <td class="right"><button class="link" (click)="edit(p)">Edit</button></td>
            </tr>
          } @empty { <tr><td colspan="7" class="muted">No plans yet. Add one before approving clients.</td></tr> }
        </tbody>
      </table>
    </div>
  `,
})
export class AdminPlans implements OnInit {
  private readonly api = inject(AdminApi);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly editing = signal<Plan | null>(null);
  protected readonly isNew = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    try {
      this.plans.set(await this.api.plans());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected edit(p: Plan | null) {
    this.isNew.set(!p);
    this.editing.set(p ? { ...p } : blank());
  }

  protected save() {
    const p = this.editing();
    if (!p) return;
    this.busy.set(true);
    this.error.set(null);
    const { code, ...rest } = p;
    const input = { ...rest, monthlyPrice: Number(p.monthlyPrice), yearlyPrice: Number(p.yearlyPrice), maxProperties: Number(p.maxProperties), maxUsers: Number(p.maxUsers) };
    (this.isNew() ? this.api.createPlan({ code, ...input }) : this.api.updatePlan(code, input))
      .then(async () => {
        this.editing.set(null);
        this.plans.set(await this.api.plans());
      })
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }
}

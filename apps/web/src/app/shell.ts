import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from './core/api.interceptor';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ACTIVITY_LABELS } from './core/models';
import { SessionService } from './core/session.service';
import { TenantService } from './core/tenant.service';
import { MastersStore } from './master/masters-store';

/** Page frame for both panels: tenant name, user, switch panel and logout; a side menu in Master. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, DatePipe],
  template: `
    @if (session.support(); as sup) {
      <div class="support-bar" role="status">
        <strong>Banquet.ai Support session</strong>
        <span class="pill">{{ sup.mode === 'edit' ? 'Edit mode' : 'Read-only' }}</span>
        <span>Ends {{ sup.endsAt | date: 'h:mm a' }}</span>
        <span class="muted reason">Reason: {{ sup.reason }}</span>
        <span class="spacer"></span>
        @if (sup.mode === 'read') {
          @if (editing()) {
            <form class="edit" (ngSubmit)="editMode()">
              <input name="editReason" [(ngModel)]="editReason" placeholder="What will you change?" aria-label="What will you change?" maxlength="500" />
              <button class="primary" [disabled]="busy() || !editReason">Switch</button>
              <button type="button" class="link" (click)="editing.set(false)">Cancel</button>
            </form>
          } @else {
            <button (click)="editing.set(true)">Switch to edit mode</button>
          }
        }
        <button (click)="logout()">End session</button>
        @if (supportError(); as e) { <span class="error">{{ e }}</span> }
      </div>
    }
    <header class="topbar">
      <div class="brand">Banquet<span>.ai</span></div>
      <span class="muted tenant">{{ tenants.tenant()?.name }}</span>
      @if (session.activity() !== 'master') {
        <nav>
          <a routerLink="/operations" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Reservation Diary</a>
          <a routerLink="/operations/reports" routerLinkActive="active">Reports</a>
          <a routerLink="/operations/billing" routerLinkActive="active">Bills</a>
        </nav>
      }
      <span class="spacer"></span>
      <span class="pill">{{ labels[session.activity() ?? 'operations'] }}</span>
      @if (session.activities().length > 1) {
        <button class="link" (click)="switchPanel()">Switch panel</button>
      }
      <span class="muted">{{ session.user()?.firstName }} ({{ session.user()?.userId }})</span>
      @if (!session.support()) {
        <button class="link" (click)="logout()">Log out</button>
      }
    </header>
    <div class="layout" [class.with-side]="session.activity() === 'master'">
      @if (session.activity() === 'master') {
        <nav class="side" aria-label="Master setup">
          <h3>Access</h3>
          <a routerLink="/master/users" routerLinkActive="active">Users</a>
          <a routerLink="/master/roles" routerLinkActive="active">Roles</a>
          @for (g of menu(); track g.group) {
            <h3>{{ g.group }}</h3>
            @for (m of g.items; track m.kind) {
              <a [routerLink]="['/master/data', m.kind]" routerLinkActive="active">{{ m.label }}</a>
            }
          }
          <h3>Per property</h3>
          <a routerLink="/master/rates" routerLinkActive="active">Rate &amp; Tax Mapping</a>
          <a routerLink="/master/property-settings" routerLinkActive="active">Property Settings</a>
          @if (!session.support()) {
            <h3>Security</h3>
            <a routerLink="/master/support-access" routerLinkActive="active">Support Access</a>
          }
        </nav>
      }
      <main class="content"><router-outlet /></main>
    </div>
  `,
  styles: `
    .layout.with-side { display: grid; grid-template-columns: 220px 1fr; }
    .side { border-right: 1px solid var(--border); padding: 1rem 0.75rem; background: var(--surface); min-height: calc(100vh - 52px); }
    .side h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 1rem 0.5rem 0.3rem; }
    .side h3:first-child { margin-top: 0; }
    .side a { display: block; padding: 0.35rem 0.5rem; border-radius: 6px; color: var(--text); text-decoration: none; font-size: 0.9rem; }
    .side a.active { background: var(--info-bg); color: var(--primary); }
    .content { min-width: 0; }
    .support-bar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding: 0.5rem 16px; background: var(--warn-bg); border-bottom: 2px solid var(--warn); font-size: 0.9rem; }
    .support-bar .reason { max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .support-bar .edit { display: flex; gap: 0.4rem; align-items: center; }
    .support-bar input { padding: 0.35rem 0.5rem; min-width: 16rem; }
    .support-bar button { padding: 0.3rem 0.7rem; }
    .support-bar .error { color: var(--danger); width: 100%; }
    @media (max-width: 760px) {
      .layout.with-side { grid-template-columns: 1fr; }
      .side { min-height: 0; border-right: none; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 0.25rem; }
      .side h3 { width: 100%; margin: 0.5rem 0.5rem 0; }
    }
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly tenants = inject(TenantService);
  private readonly masters = inject(MastersStore);
  private readonly router = inject(Router);
  protected readonly labels = ACTIVITY_LABELS;
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly supportError = signal<string | null>(null);
  protected editReason = '';

  protected readonly menu = computed(() => {
    const groups = new Map<string, { kind: string; label: string }[]>();
    for (const d of this.masters.definitions()) {
      if (!groups.has(d.group)) groups.set(d.group, []);
      groups.get(d.group)!.push({ kind: d.kind, label: d.label });
    }
    return [...groups].map(([group, items]) => ({ group, items }));
  });

  constructor() {
    if (!this.tenants.tenant()) void this.tenants.load();
    if (this.session.activity() === 'master') this.masters.defs().catch(() => undefined);
  }

  protected async switchPanel() {
    if (this.session.support()) {
      const next = this.session.activity() === 'master' ? 'operations' : 'master';
      await this.session.switchSupportPanel(next);
      await this.router.navigate([`/${next}`]);
      return;
    }
    // Keep the login, drop the panel: the login page then shows the panel choice.
    const user = this.session.user();
    if (!user) return;
    this.session.apply({
      token: this.session.token()!,
      user,
      activity: null,
      activities: this.session.activities(),
      mustChangePassword: false,
    });
    await this.router.navigate(['/login']);
  }

  protected editMode() {
    this.busy.set(true);
    this.supportError.set(null);
    this.session.supportEditMode(this.editReason)
      .then(() => {
        this.editing.set(false);
        this.editReason = '';
      })
      .catch((err) => this.supportError.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  protected async logout() {
    await this.session.logout();
    await this.router.navigate(['/login']);
  }
}

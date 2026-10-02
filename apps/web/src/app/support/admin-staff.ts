import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { AdminApi, StaffMember } from './admin-api';
import { SupportApi, SupportUser } from './support-api';

type Role = SupportUser['role'];

/** Banquet.ai's own support staff: who can log in to the console and what they may do. */
@Component({
  selector: 'app-admin-staff',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head"><h1>Staff</h1></div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (notice(); as n) { <p class="alert ok" role="status">{{ n }}</p> }
    <section class="card form">
      <h2>Add a staff member</h2>
      <p class="muted">They get an email with a temporary password and log in with a code sent to their mobile (or email if none).</p>
      <form (ngSubmit)="add()">
        <div class="row">
          <label>Name <input name="name" [(ngModel)]="name" required maxlength="120" /></label>
          <label>Email <input name="email" type="email" [(ngModel)]="email" required /></label>
        </div>
        <div class="row">
          <label>Mobile <input name="mobile" [(ngModel)]="mobile" maxlength="20" placeholder="+91…" /></label>
          <label>Role
            <select name="role" [(ngModel)]="role">
              @for (r of roles; track r.value) { <option [value]="r.value">{{ r.label }}</option> }
            </select>
          </label>
        </div>
        <div class="actions"><button class="primary" [disabled]="busy() || !name || !email">Add</button></div>
      </form>
    </section>
    <p class="muted">Agents enter clients' accounts with a reason. Managers can also use the emergency override. Admins also manage clients, plans and staff.</p>
    <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>Name</th><th>Email and mobile</th><th>Role</th><th>Last seen</th><th></th></tr></thead>
        <tbody>
          @for (s of staff(); track s.id) {
            <tr [class.inactive]="!s.active">
              <td>{{ s.name }}@if (!s.active) { <span class="pill">Disabled</span> }@if (s.mustChangePassword && s.active) { <span class="pill">Not logged in yet</span> }</td>
              <td>{{ s.email }}<br /><small class="muted">{{ s.mobile }}</small></td>
              <td>
                <select [ngModel]="s.role" (ngModelChange)="setRole(s, $event)" [disabled]="busy() || s.id === me()" [attr.aria-label]="'Role of ' + s.name">
                  @for (r of roles; track r.value) { <option [value]="r.value">{{ r.label }}</option> }
                </select>
              </td>
              <td class="nowrap">{{ s.lastSeenAt ? (s.lastSeenAt | date: 'd MMM, h:mm a') : 'Never' }}</td>
              <td class="right nowrap">
                @if (s.id !== me()) {
                  @if (s.active) {
                    <button class="link" (click)="resetPassword(s)" [disabled]="busy()">Reset password</button>
                    <button class="link" (click)="setActive(s, false)" [disabled]="busy()">Disable</button>
                  } @else {
                    <button class="link" (click)="setActive(s, true)" [disabled]="busy()">Enable</button>
                  }
                } @else { <small class="muted">You</small> }
              </td>
            </tr>
          } @empty { <tr><td colspan="5" class="muted">Loading…</td></tr> }
        </tbody>
      </table>
    </div>
  `,
  styles: `td button + button { margin-left: 0.5rem; }`,
})
export class AdminStaff implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly support = inject(SupportApi);
  protected readonly staff = signal<StaffMember[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly me = () => this.support.user()?.id;
  protected readonly roles: { value: Role; label: string }[] = [
    { value: 'agent', label: 'Support agent' }, { value: 'manager', label: 'Support manager' }, { value: 'admin', label: 'Admin' },
  ];

  protected name = '';
  protected email = '';
  protected mobile = '';
  protected role: Role = 'agent';

  ngOnInit() {
    void this.reload();
  }

  private async reload() {
    try {
      this.staff.set(await this.api.staff());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private run(work: () => Promise<unknown>, done: string) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    work()
      .then(async () => {
        this.notice.set(done);
        await this.reload();
      })
      .catch(async (err) => {
        this.error.set(errorMessage(err));
        await this.reload();
      })
      .finally(() => this.busy.set(false));
  }

  protected add() {
    const name = this.name.trim();
    this.run(async () => {
      await this.api.addStaff({ name, email: this.email.trim(), mobile: this.mobile.trim() || undefined, role: this.role });
      this.name = this.email = this.mobile = '';
      this.role = 'agent';
    }, `${name} added and emailed a temporary password.`);
  }

  protected setRole(s: StaffMember, role: Role) {
    this.run(() => this.api.updateStaff(s.id, { role }), `${s.name} is now ${this.roles.find((r) => r.value === role)?.label.toLowerCase()}.`);
  }

  protected setActive(s: StaffMember, active: boolean) {
    if (!active && !confirm(`Disable ${s.name}? They are logged out and any support session they have open ends.`)) return;
    this.run(() => this.api.updateStaff(s.id, { active }), `${s.name} ${active ? 'enabled' : 'disabled'}.`);
  }

  protected resetPassword(s: StaffMember) {
    if (!confirm(`Email ${s.name} a new temporary password? Their current password stops working.`)) return;
    this.run(() => this.api.resetStaffPassword(s.id), `${s.name} has been emailed a temporary password.`);
  }
}

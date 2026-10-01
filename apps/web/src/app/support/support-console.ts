import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { Activity, SupportSessionInfo } from '../core/models';
import { TenantService } from '../core/tenant.service';
import { ClientAccount, SupportApi } from './support-api';

type Step = 'loading' | 'credentials' | 'otp' | 'change' | 'home';

/**
 * Banquet.ai support console (login-and-tenancy.md section 6): support staff log in here with
 * password and OTP, give a reason, and enter a client's account in a new tab.
 */
@Component({
  selector: 'app-support-console',
  imports: [FormsModule, DatePipe],
  template: `
    @if (step() !== 'home') {
      <main class="auth-page">
        <section class="card auth-card">
          <header class="auth-head">
            <div class="brand">Banquet<span>.ai</span></div>
            <p class="muted">Support console</p>
          </header>
          @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
          @switch (step()) {
            @case ('loading') { <p class="muted">Loading…</p> }
            @case ('credentials') {
              <form (ngSubmit)="submitLogin()">
                <label>Email <input name="email" type="email" [(ngModel)]="email" required autocomplete="username" autofocus /></label>
                <label>Password <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" /></label>
                <button class="primary" [disabled]="busy() || !email || !password">Log in</button>
              </form>
            }
            @case ('otp') {
              <form (ngSubmit)="submitOtp()">
                <p>We sent a code to your {{ sentTo() }}.</p>
                <label>Code <input name="otp" [(ngModel)]="otp" required inputmode="numeric" autocomplete="one-time-code" autofocus /></label>
                <button class="primary" [disabled]="busy() || !otp">Verify</button>
              </form>
            }
            @case ('change') {
              <form (ngSubmit)="submitChange()">
                <p>Please choose your own password. Use at least 8 characters with letters and digits.</p>
                <label>New password <input name="new" type="password" [(ngModel)]="newPassword" required autocomplete="new-password" autofocus /></label>
                <label>Confirm new password <input name="confirm" type="password" [(ngModel)]="confirmPassword" required autocomplete="new-password" /></label>
                <button class="primary" [disabled]="busy() || !newPassword || !confirmPassword">Save password</button>
              </form>
            }
          }
        </section>
      </main>
    } @else {
      <header class="topbar">
        <div class="brand">Banquet<span>.ai</span></div>
        <span class="muted">Support console</span>
        <span class="spacer"></span>
        <span class="muted">{{ api.user()?.name }} ({{ api.user()?.role === 'manager' ? 'Support manager' : 'Support agent' }})</span>
        <button class="link" (click)="logout()">Log out</button>
      </header>
      <main class="content">
        @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
        @if (notice(); as n) { <p class="alert ok" role="status">{{ n }}</p> }

        <section class="card form">
          <h2>Enter a client's account</h2>
          <p class="muted hint">The client is told who entered and why. You can look but not change anything until you switch to edit mode inside, with a second reason. Sessions end after 4 hours.</p>
          <form (ngSubmit)="submitRequest()">
            <label>Client domain
              <input name="client" [(ngModel)]="client" (ngModelChange)="search($event)" list="clients" required autocomplete="off" placeholder="Type a domain or hotel name" />
            </label>
            <datalist id="clients">
              @for (c of clients(); track c.subdomain) { <option [value]="c.subdomain">{{ c.name }}</option> }
            </datalist>
            @if (chosen(); as c) {
              <p class="muted hint">{{ c.name }}: {{ c.supportAccess === 'ask' ? 'asks to approve each visit.' : 'support may enter.' }}</p>
            }
            <label>Reason <input name="reason" [(ngModel)]="reason" required maxlength="500" placeholder="What you need to check or fix" /></label>
            <label>Ticket (optional) <input name="ticket" [(ngModel)]="ticket" maxlength="50" /></label>
            @if (api.user()?.role === 'manager' && chosen()?.supportAccess === 'ask') {
              <label class="check"><input type="checkbox" name="emergency" [(ngModel)]="emergency" /> Emergency override: enter without waiting for approval (the client is told)</label>
            }
            <div class="actions"><button class="primary" [disabled]="busy() || !client || !reason">{{ chosen()?.supportAccess === 'ask' && !emergency ? 'Ask to enter' : 'Start session' }}</button></div>
          </form>
        </section>

        <div class="page-head"><h2>My sessions</h2><button class="link" (click)="refresh()">Refresh</button></div>
        <div class="table-wrap">
          <table class="grid">
            <thead><tr><th>Client</th><th>Reason</th><th>Status</th><th>Ends</th><th></th></tr></thead>
            <tbody>
              @for (s of sessions(); track s.id) {
                <tr [class.inactive]="s.status === 'ended' || s.status === 'denied'">
                  <td>{{ s.tenant?.name }}<br /><small class="muted">{{ s.tenant?.subdomain }}</small></td>
                  <td>{{ s.reason }}@if (s.ticket) { <small class="muted"> ({{ s.ticket }})</small> }</td>
                  <td>{{ statusLabel(s) }}@if (s.emergency) { <span class="pill warn">Emergency</span> }</td>
                  <td class="nowrap">{{ s.status === 'active' ? (s.endsAt | date: 'd MMM, h:mm a') : '' }}</td>
                  <td class="nowrap right">
                    @if (s.status === 'active') {
                      <button (click)="enter(s, 'operations')" [disabled]="busy()">Enter Operations</button>
                      <button (click)="enter(s, 'master')" [disabled]="busy()">Enter Master</button>
                    }
                    @if (s.status === 'active' || s.status === 'pending') {
                      <button class="link" (click)="end(s)" [disabled]="busy()">End</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="muted">No sessions yet.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </main>
    }
  `,
  styles: `
    .hint { font-size: 0.85rem; margin: -0.4rem 0 0.9rem; }
    td button + button { margin-left: 0.4rem; }
    .page-head { margin-top: 1.5rem; }
  `,
})
export class SupportConsole implements OnInit {
  protected readonly api = inject(SupportApi);
  private readonly tenants = inject(TenantService);

  protected readonly step = signal<Step>('loading');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly sentTo = signal('');
  protected readonly clients = signal<ClientAccount[]>([]);
  protected readonly sessions = signal<SupportSessionInfo[]>([]);
  private readonly typed = signal('');
  protected readonly chosen = computed(() => this.clients().find((c) => c.subdomain === this.typed().trim().toLowerCase()) ?? null);

  protected email = '';
  protected password = '';
  protected otp = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected client = '';
  protected reason = '';
  protected ticket = '';
  protected emergency = false;
  private otpToken = '';
  private currentPassword = '';

  async ngOnInit() {
    if (!this.api.hasToken()) return this.step.set('credentials');
    try {
      const user = await this.api.me();
      await this.afterLogin(user.mustChangePassword);
    } catch {
      this.api.forget();
      this.step.set('credentials');
    }
  }

  private run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  protected submitLogin() {
    this.run(async () => {
      const res = await this.api.login(this.email.trim(), this.password);
      this.otpToken = res.otpToken;
      this.sentTo.set(res.sentTo === 'mobile' ? 'mobile' : 'email');
      this.currentPassword = this.password;
      this.password = '';
      this.step.set('otp');
    });
  }

  protected submitOtp() {
    this.run(async () => {
      const user = await this.api.verifyOtp(this.otpToken, this.otp.trim());
      this.otp = '';
      await this.afterLogin(user.mustChangePassword);
    });
  }

  protected submitChange() {
    this.run(async () => {
      if (this.newPassword !== this.confirmPassword) throw new Error('The two passwords do not match.');
      await this.api.changePassword(this.currentPassword, this.newPassword);
      this.newPassword = this.confirmPassword = this.currentPassword = '';
      await this.afterLogin(false);
    });
  }

  private async afterLogin(mustChange: boolean) {
    if (mustChange) {
      if (!this.currentPassword) {
        // Reloaded before choosing a password: log in again so the current password is known.
        this.api.forget();
        return this.step.set('credentials');
      }
      return this.step.set('change');
    }
    this.step.set('home');
    await Promise.all([this.refresh(), this.search('')]);
  }

  protected async search(q: string) {
    this.typed.set(q ?? '');
    try {
      this.clients.set(await this.api.clients(q ?? ''));
    } catch {
      // The list is only a convenience; a typed domain still works.
    }
  }

  protected async refresh() {
    this.sessions.set(await this.api.sessions());
  }

  protected submitRequest() {
    this.run(async () => {
      const s = await this.api.request({
        subdomain: this.client.trim().toLowerCase(), reason: this.reason, ticket: this.ticket, emergency: this.emergency && this.chosen()?.supportAccess === 'ask',
      });
      this.notice.set(s.status === 'pending'
        ? `Asked ${s.tenant?.name} to approve. You will get an email when they answer.`
        : `Session started at ${s.tenant?.name}. The client has been told.`);
      this.client = this.reason = this.ticket = '';
      this.emergency = false;
      this.typed.set('');
      await this.refresh();
    });
  }

  /** Opens the client's app in a new tab with this session. The console stays signed in here. */
  protected enter(s: SupportSessionInfo, activity: Activity) {
    const tab = window.open('', '_blank');
    this.run(async () => {
      try {
        const res = await this.api.enter(s.id, activity);
        const local = this.tenants.mode === 'local';
        if (local) this.tenants.remember(res.subdomain);
        const base = local ? window.location.origin : `https://${res.loginHost}`;
        const url = `${base}/support-enter#token=${encodeURIComponent(res.token)}`;
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  }

  protected end(s: SupportSessionInfo) {
    this.run(async () => {
      await this.api.end(s.id);
      await this.refresh();
    });
  }

  protected statusLabel(s: SupportSessionInfo) {
    return { pending: 'Waiting for the client', denied: 'Declined', active: s.mode === 'edit' ? 'Active (edit mode)' : 'Active (read-only)', ended: 'Ended' }[s.status];
  }

  protected logout() {
    this.run(async () => {
      await this.api.logout();
      this.step.set('credentials');
    });
  }
}

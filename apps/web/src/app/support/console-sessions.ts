import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { Activity, SupportSessionInfo } from '../core/models';
import { TenantService } from '../core/tenant.service';
import { ClientAccount, SupportApi } from './support-api';

/** Support sessions: ask to enter a client's account with a reason, then enter it in a new tab. */
@Component({
  selector: 'app-console-sessions',
  imports: [FormsModule, DatePipe],
  template: `
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
        @if (api.user()?.role !== 'agent' && chosen()?.supportAccess === 'ask') {
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
  `,
  styles: `
    .hint { font-size: 0.85rem; margin: -0.4rem 0 0.9rem; }
    td button + button { margin-left: 0.4rem; }
    .page-head { margin-top: 1.5rem; }
  `,
})
export class ConsoleSessions implements OnInit {
  protected readonly api = inject(SupportApi);
  private readonly tenants = inject(TenantService);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly clients = signal<ClientAccount[]>([]);
  protected readonly sessions = signal<SupportSessionInfo[]>([]);
  private readonly typed = signal('');
  protected readonly chosen = computed(() => this.clients().find((c) => c.subdomain === this.typed().trim().toLowerCase()) ?? null);

  protected client = '';
  protected reason = '';
  protected ticket = '';
  protected emergency = false;

  ngOnInit() {
    void Promise.all([this.refresh(), this.search('')]);
  }

  private run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
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
    try {
      this.sessions.set(await this.api.sessions());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
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
}

import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.interceptor';
import { SupportSessionInfo } from '../core/models';

/**
 * Opened from the link in a "Banquet.ai support asks to enter" email. Shows the request and lets
 * the client approve or decline without logging in. Opening the page changes nothing.
 */
@Component({
  selector: 'app-support-approval',
  imports: [DatePipe],
  template: `
    <main class="auth-page">
      <section class="card auth-card">
        <header class="auth-head">
          <div class="brand">Banquet<span>.ai</span></div>
          <p class="muted">Support access request</p>
        </header>
        @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
        @if (done(); as d) {
          <p class="alert ok" role="status">
            @if (d.status === 'active') {
              Approved. {{ d.supportName }} can enter your account until {{ d.endsAt | date: 'd MMM, h:mm a' }}. You can see what they do in Master › Support Access.
            } @else {
              Declined. {{ d.supportName }} cannot enter your account for this request.
            }
          </p>
        } @else if (request(); as r) {
          <p><strong>{{ r.supportName }}</strong> from Banquet.ai support asks to enter <strong>{{ r.tenant?.name }}</strong>.</p>
          <dl>
            <dt>Reason</dt><dd>{{ r.reason }}</dd>
            @if (r.ticket) { <dt>Ticket</dt><dd>{{ r.ticket }}</dd> }
            <dt>Asked</dt><dd>{{ r.requestedAt | date: 'd MMM, h:mm a' }}</dd>
          </dl>
          <p class="muted hint">If you approve, they can look for up to 4 hours. To change anything they must give a second reason, and every change is listed in Master › Support Access.</p>
          <div class="buttons">
            <button class="primary" (click)="answer(true)" [disabled]="busy()">Approve</button>
            <button (click)="answer(false)" [disabled]="busy()">Decline</button>
          </div>
        } @else if (!error()) {
          <p class="muted">Loading…</p>
        }
      </section>
    </main>
  `,
  styles: `
    dl { display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 0.8rem; margin: 0 0 1rem; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .hint { font-size: 0.85rem; }
    .buttons { display: flex; gap: 0.5rem; }
    .buttons button { flex: 1; }
  `,
})
export class SupportApproval implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly request = signal<SupportSessionInfo | null>(null);
  protected readonly done = signal<SupportSessionInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private token = '';

  async ngOnInit() {
    this.token = new URLSearchParams(window.location.search).get('token') ?? '';
    // Keep the link out of the address bar and history once it is read.
    history.replaceState(null, '', window.location.pathname);
    if (!this.token) return this.error.set('This link is incomplete. Open Master › Support Access instead.');
    try {
      this.request.set(await firstValueFrom(this.http.get<SupportSessionInfo>('/api/support-approval', { params: { token: this.token } })));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected async answer(approve: boolean) {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.done.set(await firstValueFrom(this.http.post<SupportSessionInfo>('/api/support-approval', { token: this.token, approve })));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

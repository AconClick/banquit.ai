import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.interceptor';
import { SupportSessionInfo } from '../core/models';

interface AccessLog {
  supportAccess: 'allowed' | 'ask';
  sessions: SupportSessionInfo[];
}

/** Whether Banquet.ai support may enter, requests waiting for approval, and every visit with what was changed. */
@Component({
  selector: 'app-support-access-page',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head"><h1>Support Access</h1></div>
    @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> }
    @if (log(); as l) {
      <section class="card form">
        <h2>When Banquet.ai support needs to enter</h2>
        <label class="choice"><input type="radio" name="access" value="allowed" [ngModel]="l.supportAccess" (ngModelChange)="setAccess($event)" [disabled]="busy()" />
          <span><strong>Allowed</strong><small class="muted">Support may enter with a reason. You get an email each time.</small></span></label>
        <label class="choice"><input type="radio" name="access" value="ask" [ngModel]="l.supportAccess" (ngModelChange)="setAccess($event)" [disabled]="busy()" />
          <span><strong>Ask me each time</strong><small class="muted">Support waits for your approval here. A Banquet.ai manager can still enter in an emergency, and you are told.</small></span></label>
        <p class="muted hint">Support can only look until they switch to edit mode with a second reason. Every change they make is listed below. Sessions end after 4 hours.</p>
      </section>

      @if (pending().length) {
        <h2>Waiting for your approval</h2>
        <div class="table-wrap pending">
          <table class="grid">
            <thead><tr><th>Asked</th><th>Support person</th><th>Reason</th><th></th></tr></thead>
            <tbody>
              @for (s of pending(); track s.id) {
                <tr>
                  <td class="nowrap">{{ s.requestedAt | date: 'd MMM, h:mm a' }}</td>
                  <td>{{ s.supportName }}</td>
                  <td>{{ s.reason }}@if (s.ticket) { <small class="muted"> (ticket {{ s.ticket }})</small> }</td>
                  <td class="nowrap right">
                    <button class="primary" (click)="decide(s, true)" [disabled]="busy()">Approve</button>
                    <button (click)="decide(s, false)" [disabled]="busy()">Decline</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <h2>Support visits</h2>
      <div class="table-wrap">
        <table class="grid">
          <thead><tr><th>Started</th><th>Support person</th><th>Reason</th><th>Status</th><th>Changes</th></tr></thead>
          <tbody>
            @for (s of visits(); track s.id) {
              <tr>
                <td class="nowrap">{{ (s.startedAt ?? s.requestedAt) | date: 'd MMM, h:mm a' }}</td>
                <td>{{ s.supportName }}@if (s.emergency) { <span class="pill warn">Emergency</span> }</td>
                <td>{{ s.reason }}@if (s.ticket) { <small class="muted"> (ticket {{ s.ticket }})</small> }</td>
                <td>{{ statusLabel(s) }}@if (s.decidedBy) { <br /><small class="muted">{{ s.status === 'denied' ? 'Declined' : 'Approved' }} by {{ s.decidedBy }}</small> }</td>
                <td>
                  @if (s.actions.length) {
                    <details>
                      <summary>{{ s.actions.length }} {{ s.actions.length === 1 ? 'entry' : 'entries' }}</summary>
                      <ul>
                        @for (a of s.actions; track $index) {
                          <li><span class="muted">{{ a.at | date: 'h:mm a' }}</span> {{ describe(a) }}</li>
                        }
                      </ul>
                    </details>
                  } @else { <span class="muted">Looked only</span> }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="muted">Banquet.ai support has not entered your account.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .hint { font-size: 0.85rem; margin: 0.5rem 0 0; }
    h2 { margin-top: 1.5rem; }
    .card h2 { margin-top: 0; }
    .pending { border-color: var(--warn); }
    td button + button { margin-left: 0.4rem; }
    details ul { margin: 0.4rem 0 0; padding-left: 1rem; font-size: 0.85rem; }
  `,
})
export class SupportAccessPage implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly log = signal<AccessLog | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = computed(() => this.log()?.sessions.filter((s) => s.status === 'pending') ?? []);
  protected readonly visits = computed(() => this.log()?.sessions.filter((s) => s.status !== 'pending') ?? []);

  ngOnInit() {
    this.run(async () => this.log.set(await firstValueFrom(this.http.get<AccessLog>('/api/support-access'))));
  }

  protected setAccess(supportAccess: 'allowed' | 'ask') {
    this.run(async () => this.log.set(await firstValueFrom(this.http.put<AccessLog>('/api/support-access', { supportAccess }))));
  }

  protected decide(s: SupportSessionInfo, approve: boolean) {
    this.run(async () => {
      await firstValueFrom(this.http.post(`/api/support-access/${s.id}/${approve ? 'approve' : 'deny'}`, {}));
      this.log.set(await firstValueFrom(this.http.get<AccessLog>('/api/support-access')));
    });
  }

  protected statusLabel(s: SupportSessionInfo) {
    return { pending: 'Waiting', denied: 'Declined', active: 'In your account now', ended: 'Ended' }[s.status];
  }

  /** Plain words for a logged request, e.g. "POST /api/masters/company" → "Saved: masters / company". */
  protected describe(a: { method: string; path: string }) {
    if (a.method === 'EDIT MODE') return `Switched to edit mode: ${a.path}`;
    const verb = { POST: 'Saved', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Removed' }[a.method] ?? a.method;
    const where = a.path.replace(/^\/api\//, '').split('/').filter((p) => !/^[0-9a-f]{24}$/.test(p)).join(' / ');
    return `${verb}: ${where}`;
  }

  private run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }
}

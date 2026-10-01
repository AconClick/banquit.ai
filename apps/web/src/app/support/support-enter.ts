import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.interceptor';
import { Activity, SupportSessionInfo, User } from '../core/models';
import { SessionService } from '../core/session.service';

/** Landing page in the client's app when support enters from the console (token in the URL fragment). */
@Component({
  selector: 'app-support-enter',
  template: `
    <main class="auth-page">
      <section class="card auth-card">
        <div class="brand">Banquet<span>.ai</span></div>
        @if (error(); as e) { <p class="alert error" role="alert">{{ e }}</p> } @else { <p class="muted">Opening the support session…</p> }
      </section>
    </main>
  `,
})
export class SupportEnter implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // The token must not stay in the address bar or the history.
    history.replaceState(null, '', window.location.pathname);
    if (!token) return this.error.set('This link has no support session. Enter again from the support console.');
    try {
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      const [me, support] = await Promise.all([
        firstValueFrom(this.http.get<{ user: User; activity: Activity; activities: Activity[] }>('/api/auth/me', { headers })),
        firstValueFrom(this.http.get<SupportSessionInfo>('/api/support-session', { headers })),
      ]);
      this.session.apply({ token, user: me.user, activity: me.activity, activities: me.activities, mustChangePassword: false, support });
      await this.router.navigate([`/${me.activity}`], { replaceUrl: true });
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

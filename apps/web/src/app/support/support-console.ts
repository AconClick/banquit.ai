import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { errorMessage } from '../core/api.interceptor';
import { SupportApi } from './support-api';

type Step = 'loading' | 'credentials' | 'otp' | 'change' | 'home';

/**
 * The Banquet.ai console (login-and-tenancy.md section 6). Staff log in with password and code;
 * everyone can enter clients' accounts with a reason, and admins also manage clients, plans,
 * payments, domains and support staff.
 */
@Component({
  selector: 'app-support-console',
  imports: [FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (step() !== 'home') {
      <main class="auth-page">
        <section class="card auth-card">
          <header class="auth-head">
            <div class="brand">Banquet<span>.ai</span></div>
            <p class="muted">Banquet.ai console</p>
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
        <span class="muted">Console</span>
        <nav aria-label="Console">
          <a routerLink="/support" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Support sessions</a>
          @if (api.user()?.role === 'admin') {
            <a routerLink="/support/admin" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Overview</a>
            <a routerLink="/support/admin/clients" routerLinkActive="active">Clients</a>
            <a routerLink="/support/admin/plans" routerLinkActive="active">Plans</a>
            <a routerLink="/support/admin/staff" routerLinkActive="active">Staff</a>
          }
        </nav>
        <span class="spacer"></span>
        <span class="muted">{{ api.user()?.name }} ({{ roleLabel() }})</span>
        <button class="link" (click)="logout()">Log out</button>
      </header>
      <main class="content"><router-outlet /></main>
    }
  `,
})
export class SupportConsole implements OnInit {
  protected readonly api = inject(SupportApi);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>('loading');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal('');

  protected email = '';
  protected password = '';
  protected otp = '';
  protected newPassword = '';
  protected confirmPassword = '';
  private otpToken = '';
  private currentPassword = '';

  async ngOnInit() {
    const user = await this.api.me();
    if (!user) return this.step.set('credentials');
    this.afterLogin(user.mustChangePassword);
  }

  protected roleLabel() {
    return { agent: 'Support agent', manager: 'Support manager', admin: 'Admin' }[this.api.user()?.role ?? 'agent'];
  }

  private run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
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
      this.afterLogin(user.mustChangePassword);
    });
  }

  protected submitChange() {
    this.run(async () => {
      if (this.newPassword !== this.confirmPassword) throw new Error('The two passwords do not match.');
      await this.api.changePassword(this.currentPassword, this.newPassword);
      this.newPassword = this.confirmPassword = this.currentPassword = '';
      this.afterLogin(false);
    });
  }

  private afterLogin(mustChange: boolean) {
    if (mustChange) {
      if (!this.currentPassword) {
        // Reloaded before choosing a password: log in again so the current password is known.
        void this.api.logout();
        return this.step.set('credentials');
      }
      return this.step.set('change');
    }
    this.step.set('home');
  }

  protected logout() {
    this.run(async () => {
      await this.api.logout();
      this.step.set('credentials');
      await this.router.navigate(['/support']);
    });
  }
}

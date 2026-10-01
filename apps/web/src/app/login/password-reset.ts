import { HttpClient } from '@angular/common/http';
import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.interceptor';

/** "Forgot password" (no token) and "set a new password" from the emailed link (with token). */
@Component({
  selector: 'app-password-reset',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-page">
      <section class="card auth-card">
        <header class="auth-head"><div class="brand">Banquet<span>.ai</span></div></header>
        @if (error(); as e) {
          <p class="alert error" role="alert">{{ e }}</p>
        }
        @if (done(); as message) {
          <p class="alert">{{ message }}</p>
        } @else if (token()) {
          <form (ngSubmit)="reset()">
            <p>Choose a new password. Use at least 8 characters with letters and digits.</p>
            <label>New password <input name="p" type="password" [(ngModel)]="password" required autocomplete="new-password" /></label>
            <label>Confirm <input name="c" type="password" [(ngModel)]="confirm" required autocomplete="new-password" /></label>
            <button class="primary" [disabled]="busy() || !password">Save password</button>
          </form>
        } @else {
          <form (ngSubmit)="request()">
            <p>Enter your user id. We will email you a link to reset your password.</p>
            <label>User Id <input name="u" [(ngModel)]="userId" required autocomplete="username" /></label>
            <button class="primary" [disabled]="busy() || !userId">Send link</button>
          </form>
        }
        <p class="links"><a routerLink="/login">Back to login</a></p>
      </section>
    </main>
  `,
})
export class PasswordReset {
  private readonly http = inject(HttpClient);
  readonly token = input<string>();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected userId = '';
  protected password = '';
  protected confirm = '';

  protected request() {
    this.submit(async () => {
      await firstValueFrom(this.http.post('/api/auth/forgot-password', { userId: this.userId }));
      this.done.set('If this user exists, a reset link has been emailed. It is valid for 30 minutes.');
    });
  }

  protected reset() {
    if (this.password !== this.confirm) return this.error.set('The passwords do not match.');
    this.submit(async () => {
      await firstValueFrom(this.http.post('/api/auth/reset-password', { token: this.token(), newPassword: this.password }));
      this.done.set('Your password has been changed. You can log in now.');
    });
  }

  private submit(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }
}

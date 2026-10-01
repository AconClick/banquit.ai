import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Activity, SessionResponse, User } from './models';

const KEY = 'banquet.session';

interface Stored {
  token: string;
  user: User;
  activity: Activity | null;
  activities: Activity[];
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly state = signal<Stored | null>(this.restore());

  readonly user = computed(() => this.state()?.user ?? null);
  readonly activity = computed(() => this.state()?.activity ?? null);
  readonly activities = computed(() => this.state()?.activities ?? []);
  readonly loggedIn = computed(() => !!this.state());
  /** Shown on the login page after the server ends a session (signed in elsewhere, idle, expired). */
  readonly notice = signal<string | null>(null);

  token(): string | null {
    return this.state()?.token ?? null;
  }

  apply(res: SessionResponse) {
    this.save({ token: res.token, user: res.user, activity: res.activity, activities: res.activities });
  }

  async login(userId: string, password: string) {
    const res = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/login', { userId, password }));
    this.apply(res);
    return res;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const res = await firstValueFrom(
      this.http.post<SessionResponse>('/api/auth/change-password', { currentPassword, newPassword }),
    );
    this.apply(res);
    return res;
  }

  /** Operations opens at once; Master answers { otpRequired: true } and an OTP is sent. */
  async chooseActivity(activity: Activity) {
    const res = await firstValueFrom(
      this.http.post<(SessionResponse & { otpRequired: false }) | { otpRequired: true; sentTo: string }>(
        '/api/auth/activity',
        { activity },
      ),
    );
    if (!res.otpRequired) this.apply(res);
    return res;
  }

  async verifyOtp(code: string) {
    const res = await firstValueFrom(this.http.post<SessionResponse>('/api/auth/otp/verify', { code }));
    this.apply(res);
    return res;
  }

  async logout() {
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
    } finally {
      this.clear();
    }
  }

  clear(notice?: string) {
    this.save(null);
    if (notice) this.notice.set(notice);
  }

  private save(value: Stored | null) {
    this.state.set(value);
    try {
      if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
      else sessionStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: the session lives only in memory.
    }
  }

  private restore(): Stored | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      return null;
    }
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Activity, SessionResponse, SupportSessionInfo, User } from './models';

const KEY = 'banquet.session';

/** What the page remembers about the login. The session token itself is in an httpOnly cookie. */
interface Stored {
  user: User;
  activity: Activity | null;
  activities: Activity[];
  support?: SupportSessionInfo;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly state = signal<Stored | null>(this.restore());

  readonly user = computed(() => this.state()?.user ?? null);
  readonly activity = computed(() => this.state()?.activity ?? null);
  readonly activities = computed(() => this.state()?.activities ?? []);
  readonly loggedIn = computed(() => !!this.state());
  /** Set while Banquet.ai support is inside this account. */
  readonly support = computed(() => this.state()?.support ?? null);
  /** Shown on the login page after the server ends a session (signed in elsewhere, idle, expired). */
  readonly notice = signal<string | null>(null);

  apply(res: SessionResponse) {
    this.save({ user: res.user, activity: res.activity, activities: res.activities, support: res.support });
  }

  /** Keeps the support session details (mode, end time) up to date in the banner. */
  setSupport(support: SupportSessionInfo) {
    const current = this.state();
    if (current) this.save({ ...current, support });
  }

  /** Support sessions switch panel without a new login or OTP; the session stays the same. */
  async switchSupportPanel(activity: Activity) {
    this.apply(await firstValueFrom(this.http.post<SessionResponse>('/api/support-session/activity', { activity })));
  }

  async supportEditMode(reason: string) {
    this.setSupport(await firstValueFrom(this.http.post<SupportSessionInfo>('/api/support-session/edit-mode', { reason })));
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

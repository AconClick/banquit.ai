import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Activity, SessionResponse, SupportSessionInfo } from '../core/models';

const KEY = 'banquet.supportConsole';

export interface SupportUser {
  id: string;
  email: string;
  name: string;
  mobile: string;
  role: 'agent' | 'manager';
  active: boolean;
  mustChangePassword: boolean;
}

export interface ClientAccount {
  subdomain: string;
  name: string;
  supportAccess: 'allowed' | 'ask';
}

export interface EnterResponse extends SessionResponse {
  /** Handed to the client's address in the link, which swaps it for its own session cookie. */
  token: string;
  subdomain: string;
  loginHost: string;
}

/** The Banquet.ai support console's own login. It is separate from every client's users and sessions. */
@Injectable({ providedIn: 'root' })
export class SupportApi {
  private readonly http = inject(HttpClient);
  readonly user = signal<SupportUser | null>(null);
  private token = this.restore();

  hasToken() {
    return !!this.token;
  }

  async login(email: string, password: string) {
    return firstValueFrom(this.http.post<{ otpToken: string; sentTo: 'mobile' | 'email' }>('/api/support/login', { email, password }));
  }

  async verifyOtp(otpToken: string, code: string) {
    const res = await firstValueFrom(this.http.post<{ token: string; user: SupportUser }>('/api/support/otp/verify', { otpToken, code }));
    this.store(res.token);
    this.user.set(res.user);
    return res.user;
  }

  async me() {
    const user = await this.get<SupportUser>('me');
    this.user.set(user);
    return user;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    this.user.set(await this.post<SupportUser>('change-password', { currentPassword, newPassword }));
  }

  async logout() {
    try {
      await this.post('logout', {});
    } finally {
      this.forget();
    }
  }

  forget() {
    this.store(null);
    this.user.set(null);
  }

  clients(q: string) {
    return this.get<ClientAccount[]>(`tenants?q=${encodeURIComponent(q)}`);
  }

  sessions() {
    return this.get<SupportSessionInfo[]>('sessions');
  }

  request(input: { subdomain: string; reason: string; ticket: string; emergency: boolean }) {
    return this.post<SupportSessionInfo>('sessions', input);
  }

  enter(id: string, activity: Activity) {
    return this.post<EnterResponse>(`sessions/${id}/enter`, { activity });
  }

  end(id: string) {
    return this.post<SupportSessionInfo>(`sessions/${id}/end`, {});
  }

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`/api/support/${path}`, { headers: this.headers() }));
  }

  private post<T>(path: string, body: object) {
    return firstValueFrom(this.http.post<T>(`/api/support/${path}`, body, { headers: this.headers() }));
  }

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${this.token ?? ''}` });
  }

  private store(token: string | null) {
    this.token = token;
    try {
      if (token) sessionStorage.setItem(KEY, token);
      else sessionStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: the console login lives only in memory.
    }
  }

  private restore(): string | null {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
}

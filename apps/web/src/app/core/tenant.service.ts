import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TenantInfo } from './models';

const DOMAIN_KEY = 'banquet.domain';

/**
 * Which client account (tenant) this browser is talking to.
 *
 * - On a tenant address (prime.banquet.ai or a client's own domain) the server knows the tenant from the host.
 * - On the common address (app.banquet.ai) the user types the Domain and is redirected to the tenant address.
 * - On localhost (development) the typed Domain is kept and sent in the X-Tenant header.
 */
@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  readonly tenant = signal<TenantInfo | null>(null);
  private readonly hostname = window.location.hostname;

  readonly mode: 'host' | 'common' | 'local' =
    this.hostname === 'localhost' || this.hostname === '127.0.0.1'
      ? 'local'
      : this.hostname.startsWith('app.')
        ? 'common'
        : 'host';

  /** The domain to send in the X-Tenant header, only on localhost. */
  headerDomain(): string | null {
    return this.mode === 'local' ? this.storedDomain() : null;
  }

  storedDomain(): string | null {
    try {
      return localStorage.getItem(DOMAIN_KEY);
    } catch {
      return null;
    }
  }

  /** Loads the tenant for this address. Returns null when the user still has to type a Domain. */
  async load(): Promise<TenantInfo | null> {
    if (this.mode !== 'host' && !this.headerDomain()) return null;
    try {
      const info = await firstValueFrom(this.http.get<TenantInfo>('/api/tenants/current'));
      this.tenant.set(info);
      return info;
    } catch {
      this.tenant.set(null);
      return null;
    }
  }

  /** Domain step: checks the domain, then remembers it (local) or redirects the browser (common URL). */
  async choose(domain: string): Promise<TenantInfo> {
    const res = await firstValueFrom(
      this.http.post<TenantInfo & { loginHost: string }>('/api/tenants/resolve', { domain }),
    );
    if (!res.active) throw new Error(res.message ?? 'This account is not active.');
    try {
      localStorage.setItem(DOMAIN_KEY, res.subdomain);
    } catch {
      // Private browsing: the domain is simply asked for again next time.
    }
    if (this.mode === 'common') {
      window.location.href = `https://${res.loginHost}/login`;
    }
    this.tenant.set(res);
    return res;
  }

  /** Remembers the domain without the Domain step (used when support enters on localhost). */
  remember(subdomain: string) {
    try {
      localStorage.setItem(DOMAIN_KEY, subdomain);
    } catch {
      // ignore
    }
  }

  forget() {
    try {
      localStorage.removeItem(DOMAIN_KEY);
    } catch {
      // ignore
    }
    this.tenant.set(null);
  }
}

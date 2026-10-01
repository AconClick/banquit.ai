import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { apiInterceptor } from '../core/api.interceptor';
import { Login } from './login';

/** Lets the component's async start-up finish, then renders. */
async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()],
    });
  });

  it('asks for the Domain first on a shared address', async () => {
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Domain');
  });

  it('sends the remembered domain as X-Tenant and shows the tenant name', async () => {
    localStorage.setItem('banquet.domain', 'prime');
    const fixture = TestBed.createComponent(Login);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const req = http.expectOne('/api/tenants/current');
    expect(req.request.headers.get('X-Tenant')).toBe('prime');
    req.flush({ subdomain: 'prime', name: 'Hotel Prime Residency', active: true, message: null });
    await settle(fixture);
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Hotel Prime Residency');
    expect(text).toContain('User Id');
  });
});

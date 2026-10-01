import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { apiInterceptor } from '../../core/api.interceptor';
import { Reports } from './reports';

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

const forecast = (from: string) => ({
  from, to: from, propertyId: 'p1', properties: [{ id: 'p1', name: 'Prime Residency' }], dates: [from],
  halls: [{ hallId: 'h1', hallName: 'Roof Top Hall', propertyId: 'p1', capacity: 150, days: [{ date: from, state: 'confirmed', heldHours: 4, bookings: ['R-000001'] }] }],
  days: [{ date: from, functions: 1, guaranteedPax: 100, expectedMaxPax: 120, tentativePax: 0, hallsAvailable: 0, hallsTotal: 1 }],
  menus: { available: false, message: 'Menu and resource demand will appear once booking details are recorded.' },
});

describe('Reports', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [Reports],
      providers: [provideRouter([]), provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting()],
    });
  });

  it('opens on the forecast for the only property and switches to other reports', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/masters/property').flush([{ id: 'p1', active: true, name: 'Prime Residency' }]);
    await settle(fixture);

    const req = http.expectOne((r) => r.url === '/api/reports/forecast');
    expect(req.request.params.get('propertyId')).toBe('p1');
    const from = req.request.params.get('from')!;
    req.flush(forecast(from));
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Roof Top Hall');
    expect(el.querySelector('td.c-confirmed')?.textContent).toContain('4 h');
    expect(el.textContent).toContain('Menu and resource demand');

    // Other reports default to this month.
    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent?.includes('Bookings by status'))!.click();
    const status = http.expectOne((r) => r.url === '/api/reports/bookings-by-status');
    expect(status.request.params.get('from')!.endsWith('-01')).toBe(true);
    status.flush({
      from, to: from, propertyId: 'p1', properties: [],
      rows: [{ status: 'confirmed', bookings: 2, guaranteedPax: 150, expectedMaxPax: 180 }], total: { bookings: 2, guaranteedPax: 150, expectedMaxPax: 180 },
    });
    await settle(fixture);
    expect(el.textContent).toContain('Confirmed');
    expect(el.querySelector('tfoot')?.textContent).toContain('150');
    http.verify();
  });
});

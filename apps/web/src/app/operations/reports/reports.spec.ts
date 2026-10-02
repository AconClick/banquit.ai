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
  demand: {
    packages: [{ packageId: 'k1', name: 'Buffet Lunch Non Veg', bookings: 1, pax: 100, provisionalPax: 0 }],
    dishes: [{ itemId: 'm1', name: 'Chicken Tikka', pax: 100, provisionalPax: 0 }],
    extras: [{ itemId: 'm2', name: 'DJ Console', aType: 'services', qty: 1, provisionalQty: 0 }],
  },
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
    expect(el.textContent).toContain('Buffet Lunch Non Veg');
    expect(el.textContent).toContain('Chicken Tikka');
    expect(el.textContent).toContain('DJ Console');

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

  it('shows revenue from final bills on the Revenue tab', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/masters/property').flush([{ id: 'p1', active: true, name: 'Prime Residency' }]);
    await settle(fixture);
    const req = http.expectOne((r) => r.url === '/api/reports/forecast');
    req.flush(forecast(req.request.params.get('from')!));
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;

    [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent?.includes('Revenue'))!.click();
    const sum = { bills: 1, amount: 112000, discount: 0, taxable: 112000, taxTotal: 0, roundOff: 0, total: 112000, collected: 80000, credited: 2000, balance: 30000,
      creditNotes: { notes: 1, taxable: 2000, taxTotal: 0, total: 2000 }, net: { taxable: 110000, taxTotal: 0, total: 110000 } };
    http.expectOne((r) => r.url === '/api/reports/revenue').flush({
      from: '2030-07-01', to: '2030-07-31', propertyId: 'p1', properties: [], currency: 'INR', mixedCurrencies: false, total: sum,
      byProperty: [{ propertyId: 'p1', currency: 'INR', ...sum }],
      byAType: [{ key: 'package', label: 'Packages', taxable: 104500, tax: 0, total: 104500, creditedTaxable: 2000, creditedTax: 0, credited: 2000, netTaxable: 102500, netTax: 0, net: 102500 }],
      bySource: [{ key: 'package', label: 'Packages', taxable: 104500, tax: 0, total: 104500, creditedTaxable: 2000, creditedTax: 0, credited: 2000, netTaxable: 102500, netTax: 0, net: 102500 }],
      taxes: [], billCount: 1, billLimit: 500,
      bills: [{ id: 'b1', number: 'B/2030-31/000001', propertyId: 'p1', currency: 'INR', reservationId: 'r1', reservationNumber: 'R-000001',
        hostName: 'Menon Family', functionDate: '2030-07-01', status: 'partiallySettled', total: 112000, collected: 80000, credited: 2000, balance: 30000 }],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Revenue before tax (INR)');
    expect(el.textContent).toContain('B/2030-31/000001');
    expect(el.textContent).toContain('Part paid');
    expect(el.textContent).toContain('Credit notes (1)');
    expect(el.textContent).toContain('Net of credit notes');
    expect(el.textContent).toContain('110,000.00');
    expect(el.querySelector('a[href="/operations/billing/b1"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Showing the first');

    // With nothing billed there is no currency, so the label has no empty brackets.
    fixture.componentInstance['load']();
    http.expectOne((r) => r.url === '/api/reports/revenue').flush({
      from: '2030-07-01', to: '2030-07-31', propertyId: 'p1', properties: [], currency: null, mixedCurrencies: false,
      total: { ...sum, bills: 0, amount: 0, taxable: 0, total: 0, collected: 0, credited: 0, balance: 0, creditNotes: { notes: 0, taxable: 0, taxTotal: 0, total: 0 }, net: { taxable: 0, taxTotal: 0, total: 0 } },
      byProperty: [], byAType: [], bySource: [], taxes: [], billCount: 0, billLimit: 500, bills: [],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Revenue before tax');
    expect(el.textContent).not.toContain('()');
    http.verify();
  });

  it('says when the bill list is cut short, and keeps function sheets to 62 days', async () => {
    const fixture = TestBed.createComponent(Reports);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/masters/property').flush([{ id: 'p1', active: true, name: 'Prime Residency' }]);
    await settle(fixture);
    const req = http.expectOne((r) => r.url === '/api/reports/forecast');
    req.flush(forecast(req.request.params.get('from')!));
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const tab = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find((b) => b.textContent?.includes(label))!.click();

    tab('Revenue');
    const sum = { bills: 900, amount: 9e6, discount: 0, taxable: 9e6, taxTotal: 0, roundOff: 0, total: 9e6, collected: 0, credited: 0, balance: 9e6,
      creditNotes: { notes: 0, taxable: 0, taxTotal: 0, total: 0 }, net: { taxable: 9e6, taxTotal: 0, total: 9e6 } };
    const bill = (i: number) => ({ id: `b${i}`, number: `B/${i}`, propertyId: 'p1', currency: 'INR', reservationId: `r${i}`, reservationNumber: `R-${i}`,
      hostName: 'Host', functionDate: '2030-07-01', status: 'finalised', total: 10000, collected: 0, credited: 0, balance: 10000 });
    http.expectOne((r) => r.url === '/api/reports/revenue').flush({
      from: '2030-01-01', to: '2030-12-31', propertyId: 'p1', properties: [], currency: 'INR', mixedCurrencies: false, total: sum,
      byProperty: [{ propertyId: 'p1', currency: 'INR', ...sum }], byAType: [], bySource: [], taxes: [],
      billCount: 900, billLimit: 500, bills: Array.from({ length: 500 }, (_, i) => bill(i)),
    });
    await settle(fixture);
    expect(el.textContent).toContain('Showing the first 500 of 900 bills');

    tab('Function sheets');
    const sheets = http.expectOne((r) => r.url === '/api/reports/function-sheets');
    sheets.flush({ from: '', to: '', propertyId: 'p1', properties: [], rows: [] });
    await settle(fixture);
    fixture.componentInstance['setRange']('2030-01-01', '2030-12-31');
    const year = http.expectOne((r) => r.url === '/api/reports/function-sheets');
    expect(year.request.params.get('to')).toBe('2030-03-03');
    year.flush({ from: '2030-01-01', to: '2030-03-03', propertyId: 'p1', properties: [], rows: [] });
    http.verify();
  });
});

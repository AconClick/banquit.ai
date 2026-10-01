import { Component, inject } from '@angular/core';
import { SessionService } from '../core/session.service';

@Component({
  selector: 'app-operations-home',
  template: `
    <h1>Operations</h1>
    <section class="card">
      <p>Welcome, {{ session.user()?.firstName }}.</p>
      <p class="muted">The Reservation Diary, bookings and billing will appear here.</p>
    </section>
  `,
})
export class OperationsHome {
  protected readonly session = inject(SessionService);
}

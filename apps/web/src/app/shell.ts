import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ACTIVITY_LABELS } from './core/models';
import { SessionService } from './core/session.service';
import { TenantService } from './core/tenant.service';

/** Page frame for both panels: tenant name, panel menu, user, switch panel and logout. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="brand">Banquet<span>.ai</span></div>
      <span class="muted tenant">{{ tenants.tenant()?.name }}</span>
      <nav>
        @if (session.activity() === 'master') {
          <a routerLink="/master/users" routerLinkActive="active">Users</a>
          <a routerLink="/master/roles" routerLinkActive="active">Roles</a>
        } @else {
          <a routerLink="/operations" routerLinkActive="active">Dashboard</a>
        }
      </nav>
      <span class="spacer"></span>
      <span class="pill">{{ labels[session.activity() ?? 'operations'] }}</span>
      @if (session.activities().length > 1) {
        <button class="link" (click)="switchPanel()">Switch panel</button>
      }
      <span class="muted">{{ session.user()?.firstName }} ({{ session.user()?.userId }})</span>
      <button class="link" (click)="logout()">Log out</button>
    </header>
    <main class="content"><router-outlet /></main>
  `,
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly tenants = inject(TenantService);
  private readonly router = inject(Router);
  protected readonly labels = ACTIVITY_LABELS;

  constructor() {
    if (!this.tenants.tenant()) void this.tenants.load();
  }

  protected async switchPanel() {
    // Keep the login, drop the panel: the login page then shows the panel choice.
    const user = this.session.user();
    if (!user) return;
    this.session.apply({
      token: this.session.token()!,
      user,
      activity: null,
      activities: this.session.activities(),
      mustChangePassword: false,
    });
    await this.router.navigate(['/login']);
  }

  protected async logout() {
    await this.session.logout();
    await this.router.navigate(['/login']);
  }
}

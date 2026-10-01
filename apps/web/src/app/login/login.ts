import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.interceptor';
import { ACTIVITY_LABELS, Activity } from '../core/models';
import { SessionService } from '../core/session.service';
import { TenantService } from '../core/tenant.service';

type Step = 'loading' | 'domain' | 'credentials' | 'change' | 'activity' | 'otp';

/** Domain → User Id → Password → (change password) → Activity → (OTP for Master). */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
})
export class Login implements OnInit {
  protected readonly session = inject(SessionService);
  protected readonly tenants = inject(TenantService);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>('loading');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly otpSentTo = signal('');
  protected readonly labels = ACTIVITY_LABELS;

  protected domain = this.tenants.storedDomain() ?? '';
  protected userId = '';
  protected password = '';
  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected activity: Activity = 'operations';
  protected otp = '';

  async ngOnInit() {
    const tenant = await this.tenants.load();
    if (!tenant) return this.step.set('domain');
    if (!tenant.active) {
      this.error.set(tenant.message);
      return this.step.set(this.tenants.mode === 'host' ? 'credentials' : 'domain');
    }
    const user = this.session.user();
    if (!user) return this.step.set('credentials');
    if (this.session.activity()) return this.open(this.session.activity()!);
    this.step.set(user.mustChangePassword ? 'change' : 'activity');
  }

  protected run(work: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.session.notice.set(null);
    work()
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  protected submitDomain() {
    this.run(async () => {
      await this.tenants.choose(this.domain.trim().toLowerCase());
      this.step.set('credentials');
    });
  }

  protected changeDomain() {
    this.session.clear();
    this.tenants.forget();
    this.step.set('domain');
  }

  protected submitCredentials() {
    this.run(async () => {
      const res = await this.session.login(this.userId, this.password);
      this.currentPassword = this.password;
      this.password = '';
      if (res.mustChangePassword) return this.step.set('change');
      this.afterLogin();
    });
  }

  protected submitChange() {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('The new passwords do not match.');
      return;
    }
    this.run(async () => {
      await this.session.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = this.newPassword = this.confirmPassword = '';
      this.afterLogin();
    });
  }

  /** One panel: open it straight away. Several: Operations is pre-selected. */
  private afterLogin() {
    const activities = this.session.activities();
    if (activities.length === 0) {
      this.session.clear();
      this.error.set('Your role has no access yet. Please contact your administrator.');
      this.step.set('credentials');
      return;
    }
    this.activity = activities.includes('operations') ? 'operations' : activities[0];
    if (activities.length === 1) this.submitActivity();
    else this.step.set('activity');
  }

  protected submitActivity() {
    this.run(async () => {
      const res = await this.session.chooseActivity(this.activity);
      if (res.otpRequired) {
        this.otpSentTo.set(res.sentTo);
        this.otp = '';
        return this.step.set('otp');
      }
      await this.open(this.activity);
    });
  }

  protected submitOtp() {
    this.run(async () => {
      await this.session.verifyOtp(this.otp);
      await this.open('master');
    });
  }

  protected async open(activity: Activity) {
    await this.router.navigate([activity === 'master' ? '/master' : '/operations']);
  }
}

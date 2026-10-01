import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { Role, User } from '../core/models';
import { SessionService } from '../core/session.service';
import { MasterApi, UserInput } from './master-api';

const KIND_LABELS: Record<User['kind'], string> = {
  entp: 'Master (entp)',
  implementation: 'Implementation',
  standard: '',
};

/** User Management: name, user id, email, mobile, role. New users get an emailed password. */
@Component({
  selector: 'app-users-page',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <h1>Users</h1>
      <button class="primary" (click)="edit(null)">New user</button>
    </div>
    @if (error(); as e) {
      <p class="alert error" role="alert">{{ e }}</p>
    }
    @if (notice(); as n) {
      <p class="alert">{{ n }}</p>
    }

    @if (editing()) {
      <form class="card form" (ngSubmit)="save()">
        <h2>{{ editingUser ? 'Edit ' + editingUser.userId : 'New user' }}</h2>
        <div class="row">
          <label>First name <input name="firstName" [(ngModel)]="form.firstName" required maxlength="60" /></label>
          <label>Last name <input name="lastName" [(ngModel)]="form.lastName" maxlength="60" /></label>
        </div>
        @if (!editingUser) {
          <label>User Id <input name="userId" [(ngModel)]="form.userId" required maxlength="30" autocomplete="off" /></label>
        }
        <div class="row">
          <label>Email <input name="email" type="email" [(ngModel)]="form.email" required /></label>
          <label>Mobile <input name="mobile" [(ngModel)]="form.mobile" maxlength="20" placeholder="+91…" /></label>
        </div>
        @if (!editingUser || editingUser.kind === 'standard') {
          <label>Role
            <select name="roleId" [(ngModel)]="form.roleId" required>
              <option value="" disabled>Choose a role</option>
              @for (r of assignableRoles(); track r.id) {
                <option [value]="r.id">{{ r.name }}</option>
              }
            </select>
          </label>
        }
        @if (!editingUser) {
          <p class="muted">A password is generated and emailed to the user. They must change it when they first log in.</p>
        }
        <div class="actions">
          <button type="button" (click)="editing.set(false)">Cancel</button>
          <button class="primary" [disabled]="busy()">Save</button>
        </div>
      </form>
    }

    <div class="table-wrap"><table class="grid">
      <thead>
        <tr><th>User Id</th><th>Name</th><th>Email</th><th>Mobile</th><th>Role</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        @for (u of users(); track u.id) {
          <tr [class.inactive]="!u.active">
            <td>{{ u.userId }}</td>
            <td>{{ u.firstName }} {{ u.lastName }}</td>
            <td>{{ u.email }}</td>
            <td>{{ u.mobile }}</td>
            <td>{{ roleName(u.roleId) }} @if (kindLabels[u.kind]) { <span class="pill">{{ kindLabels[u.kind] }}</span> }</td>
            <td>
              {{ u.active ? 'Active' : 'Disabled' }}
              @if (u.locked) { <span class="pill warn">Locked</span> }
            </td>
            <td class="right nowrap">
              <button class="link" (click)="edit(u)">Edit</button>
              @if (u.locked) { <button class="link" (click)="unlock(u)">Unlock</button> }
              @if (u.kind !== 'entp' && u.id !== session.user()?.id) {
                <button class="link" (click)="toggleActive(u)">{{ u.active ? 'Disable' : 'Enable' }}</button>
              }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="7" class="muted">No users yet.</td></tr>
        }
      </tbody>
    </table></div>
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(MasterApi);
  protected readonly session = inject(SessionService);
  protected readonly users = signal<User[]>([]);
  protected readonly roles = signal<Role[]>([]);
  /** Built-in roles belong to entp and implementation users only. */
  protected readonly assignableRoles = computed(() => this.roles().filter((r) => !r.builtIn));
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly kindLabels = KIND_LABELS;
  protected editingUser: User | null = null;
  protected form: UserInput = this.blank();

  async ngOnInit() {
    await this.refresh();
  }

  protected roleName(id: string) {
    return this.roles().find((r) => r.id === id)?.name ?? '';
  }

  protected edit(user: User | null) {
    this.editingUser = user;
    this.form = user
      ? { userId: user.userId, firstName: user.firstName, lastName: user.lastName, email: user.email, mobile: user.mobile, roleId: user.roleId }
      : this.blank();
    this.error.set(null);
    this.notice.set(null);
    this.editing.set(true);
  }

  protected save() {
    this.act(async () => {
      if (this.editingUser) {
        const { userId: _, ...changes } = this.form;
        if (this.editingUser.kind !== 'standard') delete (changes as Partial<UserInput>).roleId;
        await this.api.updateUser(this.editingUser.id, changes);
      } else {
        const created = await this.api.createUser(this.form);
        this.notice.set(`User ${created.userId} created. Their password has been emailed to ${created.email}.`);
      }
      this.editing.set(false);
    });
  }

  protected toggleActive(user: User) {
    this.act(() => this.api.setActive(user.id, !user.active));
  }

  protected unlock(user: User) {
    this.act(() => this.api.unlock(user.id));
  }

  private act(work: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set(null);
    work()
      .then(() => this.refresh())
      .catch((err) => this.error.set(errorMessage(err)))
      .finally(() => this.busy.set(false));
  }

  private async refresh() {
    try {
      const [users, roles] = await Promise.all([this.api.users(), this.api.roles()]);
      this.users.set(users);
      this.roles.set(roles);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private blank(): UserInput {
    return { userId: '', firstName: '', lastName: '', email: '', mobile: '', roleId: '' };
  }
}

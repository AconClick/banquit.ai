import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/api.interceptor';
import { ACTIVITY_LABELS, Activity, Role } from '../core/models';
import { MasterApi, PERMISSION_LABELS, PermissionCatalogue } from './master-api';

/** Roles Setup: a role is a name plus the access rights it grants, grouped by panel. */
@Component({
  selector: 'app-roles-page',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <h1>Roles</h1>
      <button class="primary" (click)="edit(null)">New role</button>
    </div>
    @if (error(); as e) {
      <p class="alert error" role="alert">{{ e }}</p>
    }

    @if (editing()) {
      <form class="card form" (ngSubmit)="save()">
        <h2>{{ editingId ? 'Edit role' : 'New role' }}</h2>
        <label>Role name <input name="name" [(ngModel)]="name" required maxlength="60" /></label>
        @for (group of groups(); track group.activity) {
          <fieldset>
            <legend>{{ activityLabels[group.activity] }} panel</legend>
            @for (p of group.permissions; track p) {
              <label class="check">
                <input type="checkbox" [checked]="selected.has(p)" (change)="toggle(p)" />
                {{ permissionLabels[p] ?? p }}
              </label>
            }
          </fieldset>
        }
        <div class="actions">
          <button type="button" (click)="editing.set(false)">Cancel</button>
          <button class="primary" [disabled]="busy() || !name.trim()">Save</button>
        </div>
      </form>
    }

    <div class="table-wrap"><table class="grid">
      <thead><tr><th>Role</th><th>Access</th><th></th></tr></thead>
      <tbody>
        @for (r of roles(); track r.id) {
          <tr>
            <td>{{ r.name }} @if (r.builtIn) { <span class="pill">Built-in</span> }</td>
            <td class="muted">{{ describe(r) }}</td>
            <td class="right">
              @if (!r.builtIn) { <button class="link" (click)="edit(r)">Edit</button> }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="3" class="muted">No roles yet.</td></tr>
        }
      </tbody>
    </table></div>
  `,
})
export class RolesPage implements OnInit {
  private readonly api = inject(MasterApi);
  protected readonly roles = signal<Role[]>([]);
  protected readonly groups = signal<{ activity: Activity; permissions: string[] }[]>([]);
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly permissionLabels = PERMISSION_LABELS;
  protected readonly activityLabels = ACTIVITY_LABELS;
  protected editingId: string | null = null;
  protected name = '';
  protected selected = new Set<string>();

  async ngOnInit() {
    try {
      const [roles, catalogue] = await Promise.all([this.api.roles(), this.api.permissions()]);
      this.roles.set(roles);
      this.groups.set(this.toGroups(catalogue));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected edit(role: Role | null) {
    this.editingId = role?.id ?? null;
    this.name = role?.name ?? '';
    this.selected = new Set(role?.permissions ?? []);
    this.error.set(null);
    this.editing.set(true);
  }

  protected toggle(p: string) {
    if (this.selected.has(p)) this.selected.delete(p);
    else this.selected.add(p);
  }

  protected async save() {
    this.busy.set(true);
    this.error.set(null);
    try {
      const permissions = [...this.selected];
      if (this.editingId) await this.api.updateRole(this.editingId, this.name, permissions);
      else await this.api.createRole(this.name, permissions);
      this.roles.set(await this.api.roles());
      this.editing.set(false);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected describe(role: Role) {
    if (role.builtIn) return 'Full access to Master and Operations';
    return role.permissions.map((p) => PERMISSION_LABELS[p] ?? p).join(', ') || 'No access';
  }

  private toGroups(catalogue: PermissionCatalogue) {
    return (Object.keys(catalogue) as Activity[]).map((activity) => ({ activity, permissions: catalogue[activity] }));
  }
}

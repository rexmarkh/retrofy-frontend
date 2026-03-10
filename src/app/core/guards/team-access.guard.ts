import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { OrganizationQuery } from '../../organization/state/organization.query';
import { OrganizationService } from '../../organization/state/organization.service';
import { map, switchMap, take, filter, Observable, from, of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class TeamAccessGuard implements CanActivate {
  constructor(
    private organizationQuery: OrganizationQuery,
    private organizationService: OrganizationService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    // 1. If we have organizations already, just check membership
    if (this.organizationQuery.getValue().organizations.length > 0) {
      return this.checkTeamMembership();
    }

    // 2. Otherwise load them first
    return from(this.organizationService.loadOrganizationsFromSupabase()).pipe(
      switchMap(() => this.checkTeamMembership())
    );
  }

  private checkTeamMembership(): Observable<boolean | UrlTree> {
    return this.organizationQuery.isUserInAnyTeam$.pipe(
      take(1),
      map(isMember => {
        if (isMember) {
          return true;
        } else {
          // Redirect to organization page if not in any team
          console.warn('[TeamAccessGuard] User not part of any team. Redirecting to organization.');
          return this.router.createUrlTree(['/organization']);
        }
      })
    );
  }
}

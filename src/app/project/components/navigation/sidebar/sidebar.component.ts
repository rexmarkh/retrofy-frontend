import { Component, Input, OnInit } from '@angular/core';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { JProject } from '@trungk18/interface/project';
import { SideBarLink } from '@trungk18/interface/ui-model/nav-link';
import { SideBarLinks } from '@trungk18/project/config/sidebar';
import { ProjectQuery } from '@trungk18/project/state/project/project.query';
import { OrganizationQuery } from '@trungk18/organization/state/organization.query';
import { slugify } from '@trungk18/core/utils/slug.utils';

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
    standalone: false
})
@UntilDestroy()
export class SidebarComponent implements OnInit {
  @Input() expanded: boolean;

  get sidebarWidth(): number {
    return this.expanded ? 240 : 15;
  }

  project: JProject;
  sideBarLinks: SideBarLink[];

  constructor(
    private _projectQuery: ProjectQuery,
    private _organizationQuery: OrganizationQuery
  ) {
    this._projectQuery.all$.pipe(untilDestroyed(this)).subscribe((project) => {
      this.project = project;
    });
  }

  ngOnInit(): void {
    this._organizationQuery.currentTeam$.pipe(untilDestroyed(this)).subscribe(team => {
      this.sideBarLinks = SideBarLinks.map(link => {
        if (link.url === 'retrospective') {
          return new SideBarLink(
            link.name,
            link.icon,
            team ? `retrospective/${slugify(team.name)}` : 'retrospective'
          );
        }
        return link;
      });
    });
  }
}

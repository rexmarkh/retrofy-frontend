import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// NG-ZORRO imports
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzBreadCrumbModule } from 'ng-zorro-antd/breadcrumb';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';

// Components
import { TeamCardComponent } from '../../components/team-card/team-card.component';

// Services and Models
import { OrganizationService } from '../../state/organization.service';
import { OrganizationQuery } from '../../state/organization.query';
import { Organization, Team, OrganizationMember } from '../../interfaces/organization.interface';

@Component({
  selector: 'app-organization-details',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzLayoutModule,
    NzCardModule,
    NzButtonModule,
    NzIconModule,
    NzGridModule,
    NzEmptyModule,
    NzBreadCrumbModule,
    NzTagModule,
    NzTableModule,
    NzAvatarModule,
    NzModalModule,
    NzFormModule,
    NzInputModule,
    TeamCardComponent
  ],
  templateUrl: './organization-details.component.html',
  styleUrls: ['./organization-details.component.scss']
})
export class OrganizationDetailsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  organization: Organization | null = null;
  teams: Team[] = [];
  members: OrganizationMember[] = [];
  
  // Jira Integration
  isJiraLinkModalVisible = false;
  isConnecting = false;
  isDisconnecting = false;
  
  // Invite Member Modal
  isInviteMemberModalVisible = false;
  inviteEmail = '';
  isInviting = false;

  jiraConfig = {
    siteUrl: '',
    email: '',
    apiToken: ''
  };
  
  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private organizationService: OrganizationService,
    private organizationQuery: OrganizationQuery,
    private message: NzMessageService
  ) {}

  ngOnInit() {
    // Get organization ID from route
    this.route.params
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const orgId = params['orgId'];
        this.loadOrganizationDetails(orgId);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadOrganizationDetails(orgId: string) {
    // Subscribe to organization
    this.organizationQuery.organizations$
      .pipe(takeUntil(this.destroy$))
      .subscribe(organizations => {
        this.organization = organizations.find(org => org.id === orgId) || null;
      });

    // Subscribe to teams for this organization
    this.organizationQuery.getTeamsByOrganization(orgId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(teams => {
        this.teams = [...teams].sort((a, b) => {
          if ((b.boardCount || 0) !== (a.boardCount || 0)) {
            return (b.boardCount || 0) - (a.boardCount || 0);
          }
          if ((b.memberCount || 0) !== (a.memberCount || 0)) {
            return (b.memberCount || 0) - (a.memberCount || 0);
          }
          if (a.isMember !== b.isMember) {
            return a.isMember ? -1 : 1;
          }
          return 0;
        });
      });

    // Subscribe to members for this organization
    this.organizationQuery.getMembersByOrganization(orgId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(members => {
        this.members = members;
      });
  }

  goBack() {
    this.router.navigate(['/organization']);
  }

  showCreateTeamModal() {
    // Implementation for creating team modal
    console.log('Create team modal');
  }

  showInviteMemberModal() {
    if (!this.organization) return;
    this.isInviteMemberModalVisible = true;
    this.inviteEmail = '';
  }

  cancelInviteMember() {
    this.isInviteMemberModalVisible = false;
    this.inviteEmail = '';
    this.isInviting = false;
  }

  async inviteMember() {
    if (!this.inviteEmail.trim() || !this.organization) return;

    this.isInviting = true;
    const result = await this.organizationService.inviteMember(
      this.inviteEmail.trim(),
      this.organization.id,
      this.organization.name
    );

    this.isInviting = false;
    if (result.success) {
      this.message.success(`Invitation sent to ${this.inviteEmail}`);
      this.cancelInviteMember();
    } else {
      this.message.error('Failed to send invitation. Please try again.');
    }
  }

  onTeamClick(team: Team) {
    if (this.organization) {
      this.router.navigate(['/project/retrospective']);
    } else {
      // Fallback to old route structure (optional, but good to ensure redirect here as well)
      this.router.navigate(['/project/retrospective']);
    }
  }

  onTeamSettings(team: Team) {
    console.log('Team settings:', team);
  }

  onTeamDelete(team: Team) {
    console.log('Delete team:', team);
  }

  trackByTeamId(index: number, team: Team): string {
    return team.id;
  }

  // Helper method to get orgId from current organization's Jira integration
  private getOrgIdFromCurrentOrganization(): string | null {
    if (!this.organization) return null;
    
    // If Jira integration exists, extract orgId from site URL
    if (this.organization.jiraIntegration?.siteUrl) {
      const siteUrlMatch = this.organization.jiraIntegration.siteUrl.match(/https:\/\/(.+)\.atlassian\.net/);
      if (siteUrlMatch && siteUrlMatch[1]) {
        return siteUrlMatch[1];
      }
    }
    
    // Fallback to organization name as orgId
    return this.organization.name.toLowerCase();
  }

  trackByMemberId(index: number, member: OrganizationMember): string {
    return member.id;
  }

  getRoleColor(role: string): string {
    switch (role) {
      case 'owner': return 'purple';
      case 'admin': return 'blue';
      case 'member': return 'green';
      default: return 'default';
    }
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'active': return 'green';
      case 'pending': return 'orange';
      case 'suspended': return 'red';
      default: return 'default';
    }
  }

  // Jira Integration Methods
  showLinkJiraModal() {
    this.isJiraLinkModalVisible = true;
    this.resetJiraConfig();
  }

  cancelJiraLink() {
    this.isJiraLinkModalVisible = false;
    this.resetJiraConfig();
  }

  resetJiraConfig() {
    this.jiraConfig = {
      siteUrl: '',
      email: '',
      apiToken: ''
    };
  }

  async connectJira() {
    console.log('connectJira called with:', this.jiraConfig);
    console.log('organization:', this.organization);
    
    if (!this.jiraConfig.siteUrl?.trim() || !this.organization) {
      console.log('Validation failed - siteUrl:', this.jiraConfig.siteUrl, 'organization:', this.organization);
      return;
    }

    this.isConnecting = true;
    
    try {
      // Extract organization ID from Jira URL
      const orgId = this.extractOrgIdFromJiraUrl(this.jiraConfig.siteUrl);
      console.log('Extracted orgId:', orgId);
      
      // Build the OAuth URL for your backend
      const baseUrl = 'https://cjoigydcgkkmlikacmtt.supabase.co/functions/v1/jira/auth';
      const params = new URLSearchParams({
        orgId: orgId,
        site: orgId
      });
      const oauthUrl = `${baseUrl}?${params.toString()}`;
      
      console.log('Redirecting to OAuth URL:', oauthUrl);
      
      // Redirect to your backend OAuth flow
      window.location.href = oauthUrl;
      
    } catch (error) {
      console.error('Failed to initiate Jira connection:', error);
      this.isConnecting = false;
    }
  }

  private extractOrgIdFromJiraUrl(url: string): string {
    // Extract organization ID from Jira URL
    // e.g., https://mycompany.atlassian.net -> mycompany
    try {
      const match = url.match(/https?:\/\/([^.]+)\.atlassian\.net/);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async disconnectJira() {
    if (!this.organization) {
      return;
    }

    this.isDisconnecting = true;
    
    try {
      // Simulate API call to disconnect Jira
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update organization to remove Jira integration
      const jiraIntegration = {
        isConnected: false,
        siteUrl: '',
        connectedAt: ''
      };
      
      // Update the organization in the service
      this.organizationService.updateOrganization(this.organization.id, { jiraIntegration });
      
      // Update the local organization object to reflect the changes immediately
      this.organization = {
        ...this.organization,
        jiraIntegration
      };
      
      console.log('Jira disconnected successfully!');
      this.resetJiraConfig();
    } catch (error) {
      console.error('Failed to disconnect Jira:', error);
    } finally {
      this.isDisconnecting = false;
    }
  }
}
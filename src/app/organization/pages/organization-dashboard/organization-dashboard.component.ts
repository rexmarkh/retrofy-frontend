import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';

import { OrganizationService } from '../../state/organization.service';
import { OrganizationQuery } from '../../state/organization.query';
import { AuthQuery } from '../../../project/auth/auth.query';
import { Organization, Team, OrganizationMember, OrganizationSettings, TeamSettings, MemberStatus } from '../../interfaces/organization.interface';
import { TeamCardComponent } from '../../components/team-card/team-card.component';
import { JiraControlModule } from '../../../jira-control/jira-control.module';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TextFieldModule,
    NzLayoutModule,
    NzCardModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
    NzEmptyModule,
    NzGridModule,
    NzTabsModule,
    NzSelectModule,
    NzSwitchModule,
    NzFormModule,
    NzTagModule,
    NzAvatarModule,
    NzGridModule,
    NzSkeletonModule,
    TeamCardComponent,
    JiraControlModule
  ],
  templateUrl: './organization-dashboard.component.html',
  styleUrls: ['./organization-dashboard.component.scss']
})
export class OrganizationDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  isLoading$ = this.organizationQuery.loading$;
  organizations: Organization[] = [];
  teams: Team[] = [];
  members: OrganizationMember[] = [];
  currentOrganization: Organization | null = null;

  activeMembersCount(): number {
    return this.members.filter(m => m.status === MemberStatus.ACTIVE).length;
  }
  
  isCreateTeamModalVisible = false;
  
  // Jira Integration Modal
  isJiraLinkModalVisible = false;
  isConnecting = false;
  isDisconnecting = false;
  showApiToken = false;
  selectedOrgForJira: Organization | null = null;
  
  jiraConfig = {
    siteUrl: '',
    email: '',
    apiToken: ''
  };
  
  newTeamName = '';
  newTeamDescription = '';

  isCreateOrgModalVisible = false;
  newOrgName = '';
  newOrgDescription = '';

  // Team Edit Modal
  isEditTeamModalVisible = false;
  editingTeam: Team | null = null;
  editTeamName = '';
  editTeamDescription = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private organizationService: OrganizationService,
    private organizationQuery: OrganizationQuery,
    private authQuery: AuthQuery,
    private message: NzMessageService
  ) {}

  ngOnInit() {
    // Fetch data from Supabase into local store
    this.organizationService.loadOrganizationsFromSupabase();

    // Subscribe to organizations
    this.organizationQuery.organizations$
      .pipe(takeUntil(this.destroy$))
      .subscribe(organizations => {
        this.organizations = organizations;
        
        // Auto-select first/only organization
        if (organizations.length > 0 && !this.currentOrganization) {
          this.setCurrentOrganization(organizations[0]);
        }
      });

    // Subscribe to current organization
    this.organizationQuery.currentOrganization$
      .pipe(takeUntil(this.destroy$))
      .subscribe(org => {
        this.currentOrganization = org;
        
        // Load teams and members when org changes
        if (org) {
          this.loadTeamsAndMembers(org.id);
        }
      });

    // Check for OAuth callback parameters
    this.handleOAuthCallback();
  }
  
  private autoCreateOrganization() {
    const user = this.authQuery.getValue();
    if (user) {
      const orgName = `${user.name}'s Organization`;
      const orgDescription = 'Your organization workspace';
      this.organizationService.createOrganization(orgName, orgDescription);
    }
  }
  
  private setCurrentOrganization(org: Organization) {
    this.currentOrganization = org;
    this.organizationService.setCurrentOrganization(org.id);
  }
  
  private loadTeamsAndMembers(orgId: string) {
    // Subscribe to teams for this organization
    this.organizationQuery.getTeamsByOrganization(orgId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(teams => {
        this.teams = teams;
      });

    // Subscribe to members for this organization  
    this.organizationQuery.getMembersByOrganization(orgId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(members => {
        // Deduplicate by userId – a user can appear multiple times if they belong
        // to multiple teams within the same org.
        const seen = new Map<string, OrganizationMember>();
        members.forEach(m => { if (!seen.has(m.userId)) seen.set(m.userId, m); });
        this.members = Array.from(seen.values());
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Handle OAuth callback from Jira integration
  private handleOAuthCallback() {
    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const orgId = params['orgId'];
        const site = params['site'];
        
        if (orgId && site) {
          console.log('OAuth callback detected:', { orgId, site });
          
          try {
            this.createOrganizationFromJiraCallback(orgId, site);
            
            // Clear the URL parameters after processing
            this.cleanUrlAfterCallback();
          } catch (error) {
            console.error('Error processing OAuth callback:', error);
            this.message.error('Failed to process Jira integration. Please try again.');
            this.cleanUrlAfterCallback();
          }
        }
      });
  }

  // Create organization from Jira OAuth callback
  private createOrganizationFromJiraCallback(orgId: string, site: string) {
    console.log('Creating organization from Jira callback:', { orgId, site });
    
    // Validate inputs
    if (!orgId || !site) {
      throw new Error('Invalid OAuth callback parameters');
    }
    
    // Check if organization with this name already exists
    const existingOrg = this.organizations.find(org => 
      org.name.toLowerCase() === orgId.toLowerCase()
    );
    
    if (existingOrg) {
      console.log('Organization already exists, updating with Jira integration');
      
      // Update existing organization with Jira integration
      const jiraIntegration = {
        isConnected: true,
        siteUrl: `https://${site}.atlassian.net`,
        connectedAt: new Date().toISOString()
      };
      
      this.organizationService.updateOrganization(existingOrg.id, { jiraIntegration });
      this.message.success(`Jira integration successfully connected to ${existingOrg.name}!`);
      return;
    }
    
    // Create new organization with Jira integration
    const orgName = this.capitalizeFirstLetter(orgId);
    const orgDescription = `Organization integrated with Jira site: ${site}.atlassian.net`;
    
    const jiraIntegration = {
      isConnected: true,
      siteUrl: `https://${site}.atlassian.net`,
      connectedAt: new Date().toISOString()
    };
    
    try {
      // First create the organization
      const newOrganization = this.organizationService.createOrganization(
        orgName,
        orgDescription
      );
      
      // Then update it with Jira integration
      this.organizationService.updateOrganization(newOrganization.id, { jiraIntegration });
      
      this.message.success(`Organization "${orgName}" created and linked to Jira successfully!`);
      console.log('Organization created successfully with Jira integration!');
    } catch (error) {
      console.error('Error creating organization:', error);
      throw new Error('Failed to create organization with Jira integration');
    }
  }

  private capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Clean URL by removing OAuth callback parameters  
  private cleanUrlAfterCallback() {
    this.router.navigate(['/organization'], { replaceUrl: true });
  }

  // Helper method to get orgId from current organization's Jira integration
  private getOrgIdFromCurrentOrganization(): string | null {
    if (!this.currentOrganization) return null;
    
    // If Jira integration exists, extract orgId from site URL
    if (this.currentOrganization.jiraIntegration?.siteUrl) {
      const siteUrlMatch = this.currentOrganization.jiraIntegration.siteUrl.match(/https:\/\/(.+)\.atlassian\.net/);
      if (siteUrlMatch && siteUrlMatch[1]) {
        return siteUrlMatch[1];
      }
    }
    
    // Fallback to organization name as orgId
    return this.currentOrganization.name.toLowerCase();
  }

  // Organization Management
  showCreateOrgModal() {
    this.isCreateOrgModalVisible = true;
    this.newOrgName = '';
    this.newOrgDescription = '';
  }

  cancelCreateOrg() {
    this.isCreateOrgModalVisible = false;
    this.newOrgName = '';
    this.newOrgDescription = '';
  }

  async createOrganization() {
    if (this.newOrgName.trim()) {
      const org = await this.organizationService.createOrganizationSupabase(
        this.newOrgName.trim(),
        this.newOrgDescription.trim()
      );
      if (org) {
        this.cancelCreateOrg();
        this.message.success(`Organization "${org.name}" created successfully!`);
      } else {
        this.message.error('Failed to create organization. Please try again.');
      }
    }
  }

  showInviteMemberModal() {
    // TODO: Implement invite member modal
    console.log('Invite member modal');
  }

  deleteOrganization(organization: Organization) {
    if (confirm(`Are you sure you want to delete "${organization.name}"? This action cannot be undone.`)) {
      this.organizationService.deleteOrganization(organization.id);
    }
  }

  // Team Management
  showCreateTeamModal() {
    if (!this.currentOrganization) {
      return;
    }
    this.isCreateTeamModalVisible = true;
    this.newTeamName = '';
    this.newTeamDescription = '';
  }

  async createTeam() {
    if (this.newTeamName.trim() && this.currentOrganization) {
      const team = await this.organizationService.createTeamSupabase(
        this.newTeamName.trim(),
        this.newTeamDescription.trim(),
        this.currentOrganization.id
      );
      
      if (team) {
        this.cancelCreateTeam();
        this.message.success(`Team "${team.name}" created successfully!`);
        this.router.navigate(['/project/retrospective']);
      } else {
        this.message.error('Failed to create team. Please try again.');
      }
    }
  }

  cancelCreateTeam() {
    this.isCreateTeamModalVisible = false;
    this.newTeamName = '';
    this.newTeamDescription = '';
  }

  openTeamManagement(team: Team) {
    if (this.currentOrganization) {
      // Store the clicked team globally so Retro board views can scope down.
      this.organizationService.setCurrentTeam(team.id);

      // Direct navigation to Retrospective board as per new onboarding flow
      this.router.navigate(['/project/retrospective']);
    }
  }

  showTeamSettings(team: Team) {
    this.editingTeam = team;
    this.editTeamName = team.name;
    this.editTeamDescription = team.description || '';
    this.isEditTeamModalVisible = true;
  }

  cancelEditTeam() {
    this.isEditTeamModalVisible = false;
    this.editingTeam = null;
  }

  async editTeam() {
    if (!this.editingTeam || !this.editTeamName.trim()) return;

    const success = await this.organizationService.updateTeamSupabase(this.editingTeam.id, {
      name: this.editTeamName,
      description: this.editTeamDescription
    });

    if (success) {
      this.message.success('Team updated successfully');
      this.cancelEditTeam();
    } else {
      this.message.error('Failed to update team');
    }
  }

  async deleteTeam(team: Team) {
    if (confirm(`Are you sure you want to delete "${team.name}"? This action cannot be undone.`)) {
      const success = await this.organizationService.deleteTeamSupabase(team.id);
      if (success) {
        this.message.success('Team deleted successfully');
      } else {
        this.message.error('Failed to delete team');
      }
    }
  }

  // Utility methods
  trackByOrgId(index: number, org: Organization): string {
    return org.id;
  }

  trackByTeamId(index: number, team: Team): string {
    return team.id;
  }
  
  trackByMemberId(index: number, member: OrganizationMember): string {
    return member.id;
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
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

  loadSampleData() {
    this.organizationService.loadSampleData();
  }

  // Jira Integration Methods
  showLinkJiraModal() {
    this.isJiraLinkModalVisible = true;
    this.selectedOrgForJira = this.currentOrganization;
    this.resetJiraConfig();
  }

  cancelJiraLink() {
    this.isJiraLinkModalVisible = false;
    this.selectedOrgForJira = null;
    this.resetJiraConfig();
  }

  resetJiraConfig() {
    this.jiraConfig = {
      siteUrl: '',
      email: '',
      apiToken: ''
    };
    this.showApiToken = false;
  }

  isJiraConfigValid(): boolean {
    return this.jiraConfig.siteUrl.trim() !== '';
  }

  async connectJira() {
    if (!this.isJiraConfigValid()) {
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
    if (!this.selectedOrgForJira) {
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
      this.organizationService.updateOrganization(this.selectedOrgForJira.id, { jiraIntegration });
      
      console.log('Jira disconnected successfully!');
      this.resetJiraConfig();
    } catch (error) {
      console.error('Failed to disconnect Jira:', error);
    } finally {
      this.isDisconnecting = false;
    }
  }

  getOrgInitials(org: Organization): string {
    return org.name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}
import { Injectable } from '@angular/core';
import { OrganizationStore } from './organization.store';
import { Organization, Team, OrganizationMember, TeamMember, OrganizationInvite, TeamInvite, OrganizationRole, TeamRole, MemberStatus, InviteStatus, OrganizationSettings, TeamSettings, Project } from '../interfaces/organization.interface';
import { AuthQuery } from '../../project/auth/auth.query';
import { SupabaseService } from '../../core/services/supabase.service';

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  constructor(
    private store: OrganizationStore,
    private authQuery: AuthQuery,
    private supabaseService: SupabaseService
  ) {}

  async loadOrganizationsFromSupabase() {
    this.store.setLoading(true);
    try {
      const { data: { user } } = await this.supabaseService.client.auth.getUser();
      const currentUserId = user?.id;

      if (!currentUserId) {
        throw new Error('User not authenticated');
      }

      // Step 1: Use relational queries as per Supabase select() documentation
      // Use !inner to filter organizations based on the user's membership
      const { data: orgsData, error: orgsError } = await this.supabaseService.client
        .from('organisations')
        .select(`
          *,
          teams (*, retro_boards(count)),
          memberships!inner (*)
        `)
        .eq('memberships.user_id', currentUserId);

      if (orgsError) throw orgsError;

      let allTeams: any[] = [];
      let allMembers: OrganizationMember[] = [];

      const mappedOrgs: Organization[] = (orgsData || []).map(org => {
        // Collect teams to be used in the teams array
        if (org.teams && Array.isArray(org.teams)) {
          allTeams = [...allTeams, ...org.teams.map((t: any) => ({ ...t, memberships: org.memberships?.filter((m: any) => m.team_id === t.id) || [] }))];
        }

        // Collect members
        if (org.memberships && Array.isArray(org.memberships)) {
          const orgMembers: OrganizationMember[] = org.memberships.map((m: any) => {
            const isCurrentUser = m.user_id === currentUserId;
            const userDetails = isCurrentUser ? {
              id: user.id,
              name: user.user_metadata?.name || user.email?.split('@')[0] || 'Me',
              email: user.email || '',
              avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.avatarUrl
            } : {
              id: m.user_id,
              name: 'User ' + m.user_id.substring(0, 5),
              email: `user_${m.user_id.substring(0, 5)}@example.com`,
              avatarUrl: undefined
            };

            return {
              id: m.id || `${m.org_id}_${m.user_id}`,
              userId: m.user_id,
              organizationId: m.org_id || org.id,
              role: m.role || OrganizationRole.MEMBER,
              joinedAt: m.created_at || org.created_at || new Date().toISOString(),
              status: MemberStatus.ACTIVE,
              user: userDetails
            };
          });
          allMembers = [...allMembers, ...orgMembers];
        }

        return {
          id: org.id,
          name: org.name,
          description: '', 
          createdAt: org.created_at || new Date().toISOString(),
          updatedAt: org.created_at || new Date().toISOString(),
          memberCount: (org.memberships || []).length,
          teamCount: (org.teams || []).length,
          ownerId: org.owner_id || '',
          isPrivate: true,
          settings: {
            visibility: 'private',
            allowMemberInvites: true,
            requireApprovalForJoining: false,
            defaultRole: OrganizationRole.MEMBER,
            allowPublicTeams: false,
            requireApprovalForMembers: true,
            defaultTeamVisibility: 'private'
          }
        };
      });

      const mappedTeams: Team[] = allTeams.map(team => ({
        id: team.id,
        name: team.name,
        description: '',
        organizationId: team.org_id || '',
        createdAt: team.created_at || new Date().toISOString(),
        updatedAt: team.created_at || new Date().toISOString(),
        memberCount: (team.memberships || []).length,
        boardCount: team.retro_boards?.[0]?.count ?? 0,
        isPrivate: true
      }));

      // Update state with organizations, teams AND members
      this.store.update(state => ({
        ...state,
        organizations: mappedOrgs,
        teams: mappedTeams,
        organizationMembers: allMembers
      }));

      // Set current org to first one if none is selected
      const currentState = this.store.getValue();
      if (mappedOrgs.length > 0 && !currentState.currentOrganization) {
        this.setCurrentOrganization(mappedOrgs[0].id);
      }

      // Restore previously selected team from sessionStorage (survives navigation)
      const savedTeamId = sessionStorage.getItem('current_team_id');
      if (savedTeamId && !this.store.getValue().currentTeam) {
        console.log('[OrganizationService] Restoring team from sessionStorage:', savedTeamId);
        this.setCurrentTeam(savedTeamId);
      }

    } catch (error) {
      console.error('Error loading Supabase orgs:', error);
      this.store.setError(error);
    } finally {
      this.store.setLoading(false);
    }
  }

  // Organization Management
  createOrganization(name: string, description: string): Organization {
    const user = this.authQuery.getValue();
    const organizationId = this.generateId();
    
    const newOrganization: Organization = {
      id: organizationId,
      name,
      description,
      avatarUrl: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memberCount: 1,
      teamCount: 0,
      ownerId: user?.id || '',
      isPrivate: true,
      settings: {
        visibility: 'private',
        allowMemberInvites: true,
        requireApprovalForJoining: false,
        defaultRole: OrganizationRole.MEMBER,
        allowPublicTeams: false,
        requireApprovalForMembers: true,
        defaultTeamVisibility: 'private'
      }
    };

    const currentState = this.store.getValue();
    this.store.update(state => ({
      ...state,
      organizations: [...state.organizations, newOrganization],
      currentOrganization: newOrganization
    }));

    // Add the creator as the owner
    this.addOrganizationMember(organizationId, user?.id || '', OrganizationRole.OWNER);

    return newOrganization;
  }

  updateOrganization(organizationId: string, updates: Partial<Organization>): void {
    const currentState = this.store.getValue();
    
    const updatedOrganizations = currentState.organizations.map(org =>
      org.id === organizationId 
        ? { ...org, ...updates, updatedAt: new Date().toISOString() }
        : org
    );

    this.store.update(state => ({
      ...state,
      organizations: updatedOrganizations,
      currentOrganization: state.currentOrganization?.id === organizationId 
        ? { ...state.currentOrganization, ...updates, updatedAt: new Date().toISOString() }
        : state.currentOrganization
    }));
  }

  deleteOrganization(organizationId: string): void {
    const currentState = this.store.getValue();
    
    this.store.update(state => ({
      ...state,
      organizations: state.organizations.filter(org => org.id !== organizationId),
      teams: state.teams.filter(team => team.organizationId !== organizationId),
      organizationMembers: state.organizationMembers.filter(member => member.organizationId !== organizationId),
      teamMembers: state.teamMembers.filter(member => {
        const team = state.teams.find(t => t.id === member.teamId);
        return team?.organizationId !== organizationId;
      }),
      projects: state.projects.filter(project => project.organizationId !== organizationId),
      currentOrganization: state.currentOrganization?.id === organizationId ? null : state.currentOrganization
    }));
  }

  setCurrentOrganization(organizationId: string): void {
    const currentState = this.store.getValue();
    const organization = currentState.organizations.find(org => org.id === organizationId);
    
    if (organization) {
      this.store.update(state => ({
        ...state,
        currentOrganization: organization
      }));
    }
  }

  setCurrentTeam(teamId: string): void {
    console.log('[OrganizationService] setCurrentTeam called with teamId:', teamId);
    const currentState = this.store.getValue();
    console.log('[OrganizationService] Teams in store:', currentState.teams.map(t => ({ id: t.id, name: t.name })));
    const team = currentState.teams.find(t => t.id === teamId);
    console.log('[OrganizationService] Resolved team:', team);
    
    if (team) {
      // Persist to sessionStorage so it survives navigation
      sessionStorage.setItem('current_team_id', teamId);
      this.store.update(state => ({
        ...state,
        currentTeam: team
      }));
      // Async — fetch all members of this team with their names
      this.loadTeamMembersFromSupabase(teamId);
    } else {
      console.error('[OrganizationService] TEAM NOT FOUND in store for id:', teamId);
    }
  }

  private async loadTeamMembersFromSupabase(teamId: string): Promise<void> {
    try {
      const { data: { user } } = await this.supabaseService.client.auth.getUser();
      const currentUserId = user?.id;

      // Fetch all memberships for this team
      const { data, error } = await this.supabaseService.client
        .from('memberships')
        .select('*')
        .eq('team_id', teamId);

      if (error) throw error;

      const members: TeamMember[] = (data || []).map((m: any, i: number) => {
        const isCurrentUser = m.user_id === currentUserId;
        const resolvedName = isCurrentUser
          ? (user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Me')
          : (m.name || m.full_name || m.display_name || m.user_metadata?.name || m.user_metadata?.full_name || null);

        return {
          id: m.id || `${teamId}_${m.user_id}`,
          name: resolvedName || `Member ${i + 1}`,
          email: m.email || (isCurrentUser ? user?.email || '' : ''),
          avatar: m.avatar_url || m.user_metadata?.avatar_url,
          teamId: teamId,
          organizationId: m.org_id || '',
          role: m.role || 'member',
          status: 'active',
          joinDate: new Date(m.created_at || new Date()),
          projectIds: []
        } as TeamMember;
      });

      this.store.update(state => ({
        ...state,
        teamMembers: [
          ...state.teamMembers.filter(m => m.teamId !== teamId),
          ...members
        ]
      }));
    } catch (err) {
      console.warn('[OrganizationService] Could not load team members:', err);
    }
  }


  // Team Management
  createTeam(name: string, description: string, organizationId: string): Team {
    const user = this.authQuery.getValue();
    const teamId = this.generateId();
    
    const newTeam: Team = {
      id: teamId,
      name,
      description,
      organizationId,
      avatarUrl: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memberCount: 1,
      boardCount: 0,
      leadId: user?.id || '',
      isPrivate: true,
      settings: {
        visibility: 'private',
        allowMemberInvites: true,
        projectAccess: 'selected',
        allowExternalCollaborators: false,
        requireApprovalForProjects: true,
        defaultProjectVisibility: 'private'
      }
    };

    const currentState = this.store.getValue();
    this.store.update(state => ({
      ...state,
      teams: [...state.teams, newTeam],
      organizations: state.organizations.map(org =>
        org.id === organizationId
          ? { ...org, teamCount: org.teamCount + 1, updatedAt: new Date().toISOString() }
          : org
      )
    }));

    // Add the creator as a team member
    this.addTeamMemberDirect(teamId, organizationId, user?.name || 'Unknown User', user?.email || '', 'team_lead');

    return newTeam;
  }

  updateTeam(teamId: string, updates: Partial<Team>): void {
    const currentState = this.store.getValue();
    
    const updatedTeams = currentState.teams.map(team =>
      team.id === teamId 
        ? { ...team, ...updates, updatedAt: new Date().toISOString() }
        : team
    );

    this.store.update(state => ({
      ...state,
      teams: updatedTeams
    }));
  }

  deleteTeam(teamId: string): void {
    const currentState = this.store.getValue();
    const team = currentState.teams.find(t => t.id === teamId);
    
    this.store.update(state => ({
      ...state,
      teams: state.teams.filter(t => t.id !== teamId),
      teamMembers: state.teamMembers.filter(member => member.teamId !== teamId),
      projects: state.projects.filter(project => 
        !project.teamIds || !project.teamIds.includes(teamId)
      ),
      organizations: team ? state.organizations.map(org =>
        org.id === team.organizationId
          ? { ...org, teamCount: org.teamCount - 1, updatedAt: new Date().toISOString() }
          : org
      ) : state.organizations
    }));
  }

  // Member Management
  addOrganizationMember(organizationId: string, userId: string, role: OrganizationRole): void {
    const user = this.authQuery.getValue();
    const memberId = this.generateId();
    
    const newMember: OrganizationMember = {
      id: memberId,
      userId,
      organizationId,
      role,
      joinedAt: new Date().toISOString(),
      status: MemberStatus.ACTIVE,
      user: {
        id: userId,
        name: user?.name || 'Unknown User',
        email: user?.email || '',
        avatarUrl: user?.avatarUrl
      }
    };

    const currentState = this.store.getValue();
    this.store.update(state => ({
      ...state,
      organizationMembers: [...state.organizationMembers, newMember],
      organizations: state.organizations.map(org =>
        org.id === organizationId
          ? { ...org, memberCount: org.memberCount + 1, updatedAt: new Date().toISOString() }
          : org
      )
    }));
  }

  addTeamMemberDirect(teamId: string, organizationId: string, name: string, email: string, role: 'team_lead' | 'senior' | 'developer' | 'designer' | 'qa' | 'member'): void {
    const memberId = this.generateId();
    
    const newMember: TeamMember = {
      id: memberId,
      name,
      email,
      avatar: undefined,
      teamId,
      organizationId,
      role,
      status: 'active',
      joinDate: new Date(),
      projectIds: []
    };

    const currentState = this.store.getValue();
    this.store.update(state => ({
      ...state,
      teamMembers: [...state.teamMembers, newMember],
      teams: state.teams.map(team =>
        team.id === teamId
          ? { ...team, memberCount: team.memberCount + 1, updatedAt: new Date().toISOString() }
          : team
      )
    }));
  }

  removeOrganizationMember(memberId: string): void {
    const currentState = this.store.getValue();
    const member = currentState.organizationMembers.find(m => m.id === memberId);
    
    this.store.update(state => ({
      ...state,
      organizationMembers: state.organizationMembers.filter(m => m.id !== memberId),
      organizations: member ? state.organizations.map(org =>
        org.id === member.organizationId
          ? { ...org, memberCount: org.memberCount - 1, updatedAt: new Date().toISOString() }
          : org
      ) : state.organizations
    }));
  }

  removeTeamMember(memberId: string): void {
    const currentState = this.store.getValue();
    const member = currentState.teamMembers.find(m => m.id === memberId);
    
    this.store.update(state => ({
      ...state,
      teamMembers: state.teamMembers.filter(m => m.id !== memberId),
      teams: member ? state.teams.map(team =>
        team.id === member.teamId
          ? { ...team, memberCount: team.memberCount - 1, updatedAt: new Date().toISOString() }
          : team
      ) : state.teams
    }));
  }

  // Project Management
  createProject(name: string, description: string, organizationId: string, teamIds: string[]): Project {
    const projectId = this.generateId();
    
    const newProject: Project = {
      id: projectId,
      name,
      description,
      organizationId,
      teamIds,
      memberIds: [],
      status: 'planning',
      createdAt: new Date(),
      updatedAt: new Date(),
      totalTasks: 0,
      completedTasks: 0
    };

    const currentState = this.store.getValue();
    this.store.update(state => ({
      ...state,
      projects: [...state.projects, newProject],
      teams: state.teams.map(team =>
        teamIds.includes(team.id)
          ? { ...team, boardCount: team.boardCount + 1, updatedAt: new Date().toISOString() }
          : team
      )
    }));

    return newProject;
  }

  // Utility methods for URL generation
  getTeamUrl(organization: Organization, teamId: string): string[] {
    // Extract orgId from Jira integration or use organization name
    let orgId = organization.name.toLowerCase();
    
    if (organization.jiraIntegration?.siteUrl) {
      const siteUrlMatch = organization.jiraIntegration.siteUrl.match(/https:\/\/(.+)\.atlassian\.net/);
      if (siteUrlMatch && siteUrlMatch[1]) {
        orgId = siteUrlMatch[1];
      }
    }
    
    return ['/organization', orgId, 'teams', teamId];
  }

  getOrganizationDetailsUrl(organization: Organization): string[] {
    return ['/organization/org', organization.id];
  }

  // Utility methods
  loadSampleData(): void {
    const user = this.authQuery.getValue();
    
    // Create sample organization
    const sampleOrg = this.createOrganization(
      'Acme Corporation',
      'A leading technology company focused on innovation and excellence.'
    );

    // Add sample Jira integration for testing URL generation
    const jiraIntegration = {
      isConnected: true,
      siteUrl: 'https://learnship.atlassian.net',
      connectedAt: new Date().toISOString()
    };
    this.updateOrganization(sampleOrg.id, { jiraIntegration });
    
    // Create sample teams
    const engineeringTeam = this.createTeam('Engineering', 'Software development team', sampleOrg.id);
    const designTeam = this.createTeam('Design', 'User experience and design team', sampleOrg.id);
    const productTeam = this.createTeam('Product', 'Product management and strategy team', sampleOrg.id);

    // Add sample team members
    this.addTeamMemberDirect(engineeringTeam.id, sampleOrg.id, 'John Smith', 'john.smith@acme.com', 'senior');
    this.addTeamMemberDirect(engineeringTeam.id, sampleOrg.id, 'Sarah Johnson', 'sarah.johnson@acme.com', 'developer');
    this.addTeamMemberDirect(designTeam.id, sampleOrg.id, 'Mike Chen', 'mike.chen@acme.com', 'designer');
    this.addTeamMemberDirect(productTeam.id, sampleOrg.id, 'Emily Davis', 'emily.davis@acme.com', 'member');

    // Create sample projects
    this.createProject('Mobile App Redesign', 'Complete redesign of the mobile application', sampleOrg.id, [engineeringTeam.id, designTeam.id]);
    this.createProject('API v2.0', 'New version of the company API', sampleOrg.id, [engineeringTeam.id]);
    this.createProject('User Research Study', 'Comprehensive user research for new features', sampleOrg.id, [designTeam.id, productTeam.id]);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
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

  async inviteMember(email: string, orgId: string, orgName: string): Promise<{ success: boolean; error?: any }> {
    try {
      const { data: { session } } = await this.supabaseService.getSession();
      const jwt = session?.access_token;

      const { data, error } = await this.supabaseService.client.functions.invoke('invite-member', {
        body: { email, orgId, orgName },
        headers: {
          'apikey': jwt || ''
        }
      });

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('[OrganizationService] inviteMember failed:', error);
      return { success: false, error };
    }
  }

  async loadOrganizationsFromSupabase() {
    this.store.setLoading(true);
    try {
      const { data: { user } } = await this.supabaseService.getUser();
      const currentUserId = user?.id;

      if (!currentUserId) {
        throw new Error('User not authenticated');
      }

      // Auto-activate any pending memberships for the current user
      await this.activateMembership(currentUserId);

      // Step 1: Get organizations the user belongs to along with their teams
      const { data: orgsData, error: orgsError } = await this.supabaseService.client
        .from('organisations')
        .select(`
          *,
          teams (*, retro_boards(count)),
          memberships!inner (user_id)
        `)
        .eq('memberships.user_id', currentUserId);

      if (orgsError) throw orgsError;

      if (!orgsData || orgsData.length === 0) {
        this.store.update(state => ({
          ...state,
          organizations: [],
          teams: [],
          organizationMembers: []
        }));
        return;
      }

      const orgIds = orgsData.map(o => o.id);

      // Step 2: Fetch ALL memberships for these organizations and their teams
      const teamIds = orgsData.reduce((ids, org) => {
        return ids.concat((org.teams || []).map((t: any) => t.id));
      }, [] as string[]);
      
      const { data: allMemberships, error: membershipsError } = await this.supabaseService.client
        .from('memberships')
        .select(`
          *,
          profiles:user_id (
            full_name,
            email,
            avatar_url
          )
        `)
        .or(`org_id.in.(${orgIds.join(',')}),team_id.in.(${teamIds.join(',')})`);

      if (membershipsError) throw membershipsError;

      let allTeams: any[] = [];
      let allOrganizationMembers: OrganizationMember[] = [];

      const mappedOrgs: Organization[] = orgsData.map(org => {
        // Get all memberships associated with THIS organization OR its teams
        const orgTeamIds = (org.teams || []).map((t: any) => t.id);
        
        // Deduplicate by user_id to ensure a unique member list for the organization
        const uniqueUserMemberships = new Map<string, any>();
        allMemberships?.forEach(m => {
          if (m.org_id === org.id || (m.team_id && orgTeamIds.includes(m.team_id))) {
            if (!uniqueUserMemberships.has(m.user_id)) {
              uniqueUserMemberships.set(m.user_id, m);
            }
          }
        });
        
        const deduplicatedMemberships = Array.from(uniqueUserMemberships.values());
        
        // Collect teams and associate them with their memberships from the FULL list
        if (org.teams && Array.isArray(org.teams)) {
          const teamsWithMembers = org.teams.map((t: any) => ({
            ...t,
            memberships: allMemberships?.filter((m: any) => m.team_id === t.id) || []
          }));
          allTeams = [...allTeams, ...teamsWithMembers];
        }

        // Map and collect organization members
        const mappedMembers: OrganizationMember[] = deduplicatedMemberships.map((m: any) => {
          const isCurrentUser = m.user_id === currentUserId;
          // Use joined profile data if available
          const profile = m.profiles;
          
          const userDetails = isCurrentUser ? {
            id: user.id,
            name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Me',
            email: user.email || '',
            avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || user.user_metadata?.avatarUrl
          } : {
            id: m.user_id,
            name: profile?.full_name || 'User ' + m.user_id.substring(0, 5),
            email: profile?.email || profile?.email || `user_${m.user_id.substring(0, 5)}@example.com`,
            avatarUrl: profile?.avatar_url
          };

          return {
            id: m.id || `${m.org_id}_${m.user_id}`,
            userId: m.user_id,
            organizationId: org.id,
            role: m.user_id === org.owner_id ? OrganizationRole.OWNER : (m.role || OrganizationRole.MEMBER),
            joinedAt: m.created_at || org.created_at || new Date().toISOString(),
            status: m.status as MemberStatus || MemberStatus.ACTIVE,
            user: userDetails
          };
        });
        
        // Filter out pending members from the main organization list
        const activeMembers = mappedMembers.filter(m => m.status === MemberStatus.ACTIVE);
        allOrganizationMembers = [...allOrganizationMembers, ...activeMembers];

        return {
          id: org.id,
          name: org.name,
          description: org.description || '',
          avatarUrl: org.avatar_url,
          createdAt: org.created_at || new Date().toISOString(),
          updatedAt: org.created_at || new Date().toISOString(),
          memberCount: activeMembers.length,
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
        description: team.description || '',
        organizationId: team.org_id || '',
        createdAt: team.created_at || new Date().toISOString(),
        updatedAt: team.created_at || new Date().toISOString(),
        memberCount: (team.memberships || []).length,
        boardCount: team.retro_boards?.[0]?.count ?? 0,
        isPrivate: true,
        isMember: (team.memberships || []).some((m: any) => m.user_id === currentUserId)
      }));

      // Update state with organizations, teams AND members
      this.store.update(state => ({
        ...state,
        organizations: mappedOrgs,
        teams: mappedTeams,
        organizationMembers: allOrganizationMembers
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
  async createOrganizationSupabase(name: string, description: string): Promise<Organization | null> {
    try {
      this.store.setLoading(true);
      const { data: { user } } = await this.supabaseService.getUser();
      if (!user) throw new Error('User not authenticated');

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const uniqueSlug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;

      // 1. Create the organization
      const { data: orgData, error: orgError } = await this.supabaseService.client
        .from('organisations')
        .insert({
          name,
          description,
          slug: uniqueSlug,
          owner_id: user.id
        })
        .select()
        .single();

      if (orgError) throw orgError;

      // 2. Create the initial membership (owner)
      const { error: memberError } = await this.supabaseService.client
        .from('memberships')
        .insert({
          user_id: user.id,
          org_id: orgData.id,
          role: OrganizationRole.OWNER
        });

      if (memberError) throw memberError;

      // 3. Update local store
      const newOrganization: Organization = {
        id: orgData.id,
        name: orgData.name,
        description: description,
        avatarUrl: undefined,
        createdAt: orgData.created_at,
        updatedAt: orgData.created_at,
        memberCount: 1,
        teamCount: 0,
        ownerId: user.id,
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

      this.store.update(state => ({
        ...state,
        organizations: [...state.organizations, newOrganization],
        currentOrganization: newOrganization
      }));

      // 4. Add owner to organizationMembers state
      const memberId = this.generateId();
      const newMember: OrganizationMember = {
        id: memberId,
        userId: user.id,
        organizationId: orgData.id,
        role: OrganizationRole.OWNER,
        joinedAt: orgData.created_at,
        status: MemberStatus.ACTIVE,
        user: {
          id: user.id,
          name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Me',
          email: user.email || '',
          avatarUrl: user.user_metadata?.picture || user.user_metadata?.avatar_url
        }
      };

      this.store.update(state => ({
        ...state,
        organizationMembers: [...state.organizationMembers, newMember]
      }));

      return newOrganization;
    } catch (error) {
      console.error('[OrganizationService] createOrganizationSupabase failed:', error);
      this.store.setError(error);
      return null;
    } finally {
      this.store.setLoading(false);
    }
  }

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

  async uploadOrgAvatar(orgId: string, file: File): Promise<string | null> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${orgId}/${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${fileName}`;

      // 1. Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await this.supabaseService.client.storage
        .from('org-avatars')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) throw uploadError;

      // 2. Get Public URL
      const { data: { publicUrl } } = this.supabaseService.client.storage
        .from('org-avatars')
        .getPublicUrl(filePath);

      // 3. Update Database
      const { error: updateError } = await this.supabaseService.client
        .from('organisations')
        .update({ avatar_url: publicUrl })
        .eq('id', orgId);

      if (updateError) throw updateError;

      // 4. Update local state
      this.updateOrganization(orgId, { avatarUrl: publicUrl });

      return publicUrl;
    } catch (error) {
      console.error('[OrganizationService] uploadOrgAvatar failed:', error);
      return null;
    }
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
      const { data: { user } } = await this.supabaseService.getUser();
      const currentUserId = user?.id;

      // Fetch all memberships for this team and join with profiles
      const { data, error } = await this.supabaseService.client
        .from('memberships')
        .select(`
          *,
          profiles:user_id (
            full_name,
            email,
            avatar_url
          )
        `)
        .eq('team_id', teamId);

      if (error) throw error;

      const members: TeamMember[] = (data || []).map((m: any, i: number) => {
        const isCurrentUser = m.user_id === currentUserId;
        const profile = m.profiles;

        const resolvedName = isCurrentUser
          ? (user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Me')
          : (profile?.full_name || m.name || m.full_name || m.display_name || m.user_metadata?.name || m.user_metadata?.full_name || null);

        return {
          id: m.id || `${teamId}_${m.user_id}`,
          userId: m.user_id, // Store userId for isAdded checks
          name: resolvedName || `Member ${i + 1}`,
          email: m.email || profile?.email || (isCurrentUser ? user?.email || '' : ''),
          avatarUrl: isCurrentUser 
            ? (user?.user_metadata?.avatar_url || user?.user_metadata?.picture || user?.user_metadata?.avatarUrl)
            : (profile?.avatar_url || m.avatar_url || m.user_metadata?.avatar_url || null),
          teamId: teamId,
          organizationId: m.org_id || '',
          role: m.role || 'member',
          status: m.status || 'active',
          joinDate: new Date(m.created_at || new Date()),
          projectIds: []
        } as TeamMember;
      });

      this.store.update(state => ({
        ...state,
        teamMembers: [
          ...state.teamMembers.filter(m => m.teamId !== teamId),
          ...members.filter(m => m.status === 'active')
        ]
      }));
    } catch (err) {
      console.warn('[OrganizationService] Could not load team members:', err);
    }
  }


  // Team Management
  async createTeamSupabase(name: string, description: string, organizationId: string): Promise<Team | null> {
    try {
      this.store.setLoading(true);
      const { data: { user } } = await this.supabaseService.getUser();
      if (!user) throw new Error('User not authenticated');

      // 1. Create the team
      const { data: teamData, error: teamError } = await this.supabaseService.client
        .from('teams')
        .insert({
          name,
          description,
          org_id: organizationId
        })
        .select()
        .single();

      if (teamError) throw teamError;

      // 2. Create the initial membership (team lead)
      const { error: memberError } = await this.supabaseService.client
        .from('memberships')
        .insert({
          user_id: user.id,
          org_id: organizationId,
          team_id: teamData.id,
          role: 'team_lead'
        });

      if (memberError) throw memberError;

      // 3. Update local store
      const newTeam: Team = {
        id: teamData.id,
        name: teamData.name,
        description: description,
        organizationId: teamData.org_id,
        avatarUrl: undefined,
        createdAt: teamData.created_at,
        updatedAt: teamData.created_at,
        memberCount: 1,
        boardCount: 0,
        leadId: user.id,
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

      this.store.update(state => ({
        ...state,
        teams: [...state.teams, newTeam],
        organizations: state.organizations.map(org =>
          org.id === organizationId
            ? { ...org, teamCount: org.teamCount + 1, updatedAt: new Date().toISOString() }
            : org
        )
      }));

      // 4. Add creator as team member locally
      this.addTeamMemberDirect(teamData.id, organizationId, user.user_metadata?.full_name || user.user_metadata?.name || 'Me', user.email || '', 'team_lead');

      return newTeam;
    } catch (error) {
      console.error('[OrganizationService] createTeamSupabase failed:', error);
      this.store.setError(error);
      return null;
    } finally {
      this.store.setLoading(false);
    }
  }

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

  async updateTeamSupabase(teamId: string, updates: Partial<Team>): Promise<boolean> {
    try {
      const { error } = await this.supabaseService.client
        .from('teams')
        .update({
          name: updates.name,
          description: updates.description,
          updated_at: new Date().toISOString()
        })
        .eq('id', teamId);

      if (error) throw error;

      this.updateTeam(teamId, updates);
      return true;
    } catch (error) {
      console.error('Error updating team in Supabase:', error);
      return false;
    }
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

  async deleteTeamSupabase(teamId: string): Promise<boolean> {
    try {
      // Memberships and boards should be deleted by cascade or handled specifically if needed
      // For now, we assume simple team deletion
      const { error } = await this.supabaseService.client
        .from('teams')
        .delete()
        .eq('id', teamId);

      if (error) throw error;

      this.deleteTeam(teamId);
      return true;
    } catch (error) {
      console.error('Error deleting team from Supabase:', error);
      return false;
    }
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
      avatarUrl: undefined,
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

  async addMemberToTeamSupabase(teamId: string, userId: string, userName: string, userEmail: string, role: string = 'member'): Promise<boolean> {
    try {
      const currentTeam = this.store.getValue().currentTeam;
      const orgId = currentTeam?.organizationId || '';

      const { error } = await this.supabaseService.client
        .from('memberships')
        .insert({
          user_id: userId,
          team_id: teamId,
          org_id: orgId,
          role: role
        });

      if (error) throw error;

      // Optimistically update the local store
      this.addTeamMemberDirect(teamId, orgId, userName, userEmail, role as any);
      return true;
    } catch (err) {
      console.error('[OrganizationService] addMemberToTeamSupabase failed:', err);
      return false;
    }
  }

  async activateMembership(userId: string): Promise<void> {
    try {
      const { error } = await this.supabaseService.client
        .from('memberships')
        .update({ status: 'active' })
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (error) throw error;
    } catch (error) {
      console.error('[OrganizationService] activateMembership failed:', error);
    }
  }

  async searchOrgMembers(query: string): Promise<{ userId: string; name: string; email: string; isAdded: boolean }[]> {
    try {
      const { data: { user } } = await this.supabaseService.getUser();
      const currentOrg = this.store.getValue().currentOrganization;
      if (!currentOrg) return [];

      const currentTeamMemberIds = new Set(
        this.store.getValue().teamMembers.map(m => (m as any).userId || m.id)
      );

      let queryBuilder = this.supabaseService.client
        .from('profiles')
        .select(`
          id,
          full_name,
          email,
          avatar_url,
          memberships!inner(org_id)
        `)
        .eq('memberships.org_id', currentOrg.id)
        .limit(20);

      if (query && query.trim() !== '') {
        const safeQuery = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
        queryBuilder = queryBuilder.or(`full_name.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`);
      }

      const { data, error } = await queryBuilder;

      if (error) throw error;

      // Deduplicate by profile id
      const uniqueProfiles = new Map<string, any>();
      (data || []).forEach((p: any) => {
        if (!uniqueProfiles.has(p.id)) {
          uniqueProfiles.set(p.id, p);
        }
      });

      return Array.from(uniqueProfiles.values()).map((p: any) => {
        const isCurrentUser = p.id === user?.id;
        const name = isCurrentUser
          ? (user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Me')
          : (p.full_name || `User ${p.id.substring(0, 5)}`);
        const email = isCurrentUser ? (user?.email || '') : (p.email || '');
        const isAdded = currentTeamMemberIds.has(p.id);

        return { userId: p.id, name, email, isAdded };
      });
    } catch (err) {
      console.warn('[OrganizationService] searchOrgMembers failed:', err);
      return [];
    }
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
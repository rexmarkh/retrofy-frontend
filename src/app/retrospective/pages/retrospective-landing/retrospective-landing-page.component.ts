import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, takeUntil, combineLatest, timer, map, startWith, distinctUntilChanged } from 'rxjs';
import { trigger, transition, style, animate } from '@angular/animations';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';

import { RetrospectiveService } from '../../state/retrospective.service';
import { RetrospectiveQuery } from '../../state/retrospective.query';
import { AuthQuery } from '../../../project/auth/auth.query';
import { OrganizationQuery } from '../../../organization/state/organization.query';
import { OrganizationService } from '../../../organization/state/organization.service';
import { RetrospectiveBoard, RetroPhase } from '../../interfaces/retrospective.interface';
import { JiraControlModule } from '../../../jira-control/jira-control.module';


import { environment } from '../../../../environments/environment';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-retrospective-landing',
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
    NzTagModule,
    NzDividerModule,
    NzGridModule,
    NzToolTipModule,
    NzAvatarModule,
    NzSkeletonModule,
    JiraControlModule
  ],
  templateUrl: './retrospective-landing-page.component.html',
  styleUrls: ['./retrospective-landing-page.component.scss'],
  animations: [
    trigger('fadeAnimation', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('250ms ease-in', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('250ms ease-out', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class RetrospectiveLandingPageComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  boards: RetrospectiveBoard[] = [];
  isCreateModalVisible = false;
  newBoardTitle = '';
  newBoardDescription = '';
  favoriteBoards: Set<string> = new Set();
  isLoading$ = this.retrospectiveQuery.isLoading$;
  
  showSkeleton$ = combineLatest([
    this.isLoading$,
    timer(1000).pipe(startWith(null))
  ]).pipe(
    map(([loading, timerDone]) => loading || timerDone === null),
    distinctUntilChanged()
  );
  activeTab: 'active' | 'completed' = 'active';
  teamMembers: import('../../../organization/interfaces/organization.interface').TeamMember[] = [];
  currentTeam$ = this.organizationQuery.currentTeam$;
  memberContributionStats: Map<string, number> = new Map();
  minContribution = 0;
  maxContribution = 0;

  // Add member panel
  showAddMember = false;
  memberSearchQuery = '';
  memberSearchResults: { userId: string; name: string; email: string; isAdded?: boolean }[] = [];
  isSearchingMembers = false;
  isAddingMember = false;
  addMemberSuccess: string | null = null;

  // Board Edit Modal
  isEditBoardModalVisible = false;
  editingBoard: RetrospectiveBoard | null = null;
  editBoardTitle = '';
  editBoardDescription = '';

  constructor(
    private router: Router,
    private retrospectiveService: RetrospectiveService,
    private retrospectiveQuery: RetrospectiveQuery,
    private authQuery: AuthQuery,
    private organizationQuery: OrganizationQuery,
    private organizationService: OrganizationService,
    private supabaseService: SupabaseService
  ) {}

  async ngOnInit() {
    // Subscribe to boards
    this.retrospectiveQuery.boards$
      .pipe(takeUntil(this.destroy$))
      .subscribe(boards => {
        this.boards = boards;
        this.calculateContributionStats();
      });

    // Subscribe to team members for the sidebar
    this.organizationQuery.teamMembers$
      .pipe(takeUntil(this.destroy$))
      .subscribe(members => {
        this.teamMembers = members;
        this.calculateContributionStats();
      });

    // Always use sessionStorage as the source of truth for the selected team.
    // It is written by setCurrentTeam on every team card click, so it always
    // reflects the most recent selection regardless of Akita in-memory state.
    const savedTeamId = sessionStorage.getItem('current_team_id');
    console.log('[RetroLanding] ngOnInit | savedTeamId from sessionStorage:', savedTeamId);

    if (this.organizationQuery.getValue().organizations.length === 0) {
      // Orgs not yet in memory (hard page reload / direct URL access).
      // Load them first; loadOrganizationsFromSupabase will restore the team
      // from sessionStorage once teams are available.
      console.log('[RetroLanding] No orgs in store – triggering loadOrganizationsFromSupabase');
      this.organizationService.loadOrganizationsFromSupabase();
    } else if (savedTeamId) {
      // Orgs already loaded – just (re-)apply the saved team selection.
      // This covers subsequent navigations where the store may have stale data.
      console.log('[RetroLanding] Orgs in store, restoring team:', savedTeamId);
      this.organizationService.setCurrentTeam(savedTeamId);
    }

    // Reactive subscription: fires whenever currentTeam changes (including the
    // setCurrentTeam call above and the restore inside loadOrganizationsFromSupabase).
    this.organizationQuery.currentTeam$
      .pipe(takeUntil(this.destroy$))
      .subscribe(team => {
        console.log('[RetroLanding] currentTeam$ emitted:', team?.id, team?.name);
        if (team) {
          this.retrospectiveService.loadBoardsFromSupabase(undefined, team.id);
        }
      });

    // const client = new Client()
    // .setEndpoint('https://fra.cloud.appwrite.io/v1')
    // .setProject('672cf511001d207a7adb');

    //   // your database & collection IDs
    //   const DB_ID = '672cf53e0038d268d196';
    //   const TABLE_ID = 'sample';
      
    //   const account = new Account(client);
    //   // await account.createAnonymousSession();

    //   // 2️⃣ Realtime subscription (future updates)
    //   client.subscribe(`databases.${DB_ID}.tables.${TABLE_ID}.rows`, (event) => {
    //     console.log('Updated data:', event.payload);
    //   });
    this.sendPing()
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Board Management
  showCreateBoardModal() {
    this.isCreateModalVisible = true;
    this.newBoardTitle = '';
    this.newBoardDescription = '';
    
    // Focus the title input after modal opens
    setTimeout(() => {
      const input = document.querySelector('input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  async sendPing() {
    let logs: any[] = [];
    let status: 'idle' | 'loading' | 'success' | 'error' = 'idle';
    let showLogs: boolean = false;

    try {
      // Supabase basic connectivity ping via auth endpoint or getting session
      const { data, error } = await this.supabaseService.client.auth.getSession();
      
      if (error) throw error;
      
      const log: any = {
        date: new Date(),
        method: 'GET',
        path: '/v1/session',
        status: 200,
        response: JSON.stringify(data),
      };
      logs = [log, ...logs];
      status = 'success';
    } catch (err: any) {
      const log: any = {
        date: new Date(),
        method: 'GET',
        path: '/v1/session',
        status: err instanceof Error ? 500 : err.code || 500,
        response: err instanceof Error ? 'Something went wrong' : err.message,
      };
      logs = [log, ...logs];
      status = 'error';
    }
    showLogs = true;
  }

  async createBoard() {
    console.log('createBoard called, title:', this.newBoardTitle);
    console.log('User from auth:', this.authQuery.getValue());
    if (this.newBoardTitle.trim()) {
      console.log('Creating board with title:', this.newBoardTitle.trim());
      try {
        const currentOrg = this.organizationQuery.getValue().currentOrganization;
        const currentOrgId = currentOrg ? currentOrg.id : undefined;

        const currentTeam = this.organizationQuery.getValue().currentTeam;
        const currentTeamId = currentTeam ? currentTeam.id : undefined;

        const board = await this.retrospectiveService.createBoard(
          this.newBoardTitle.trim(),
          this.newBoardDescription.trim(),
          currentOrgId,
          currentTeamId
        );
        console.log('Board created:', board);
        this.cancelCreateBoard();
        this.openBoard(board.id);
      } catch (error) {
        console.error('Error creating board:', error);
      }
    } else {
      console.log('Title is empty, not creating board');
    }
  }

  cancelCreateBoard() {
    this.isCreateModalVisible = false;
    this.newBoardTitle = '';
    this.newBoardDescription = '';
  }

  // Add Member to Team
  toggleAddMember() {
    this.showAddMember = !this.showAddMember;
    if (!this.showAddMember) {
      this.memberSearchQuery = '';
      this.memberSearchResults = [];
      this.addMemberSuccess = null;
    } else {
      this.onMemberSearch();
    }
  }

  async onMemberSearch() {
    if (!this.memberSearchQuery.trim()) {
      this.memberSearchResults = [];
      return;
    }
    this.isSearchingMembers = true;
    this.memberSearchResults = await this.organizationService.searchOrgMembers(this.memberSearchQuery);
    this.isSearchingMembers = false;
  }

  async addMember(result: { userId: string; name: string; email: string; isAdded?: boolean }) {
    if (result.isAdded) return;
    const team = this.organizationQuery.getValue().currentTeam;
    if (!team) return;
    this.isAddingMember = true;
    const ok = await this.organizationService.addMemberToTeamSupabase(team.id, result.userId, result.name, result.email);
    this.isAddingMember = false;
    if (ok) {
      this.addMemberSuccess = result.name;
      const index = this.memberSearchResults.findIndex(r => r.userId === result.userId);
      if (index !== -1) {
        this.memberSearchResults[index] = { ...this.memberSearchResults[index], isAdded: true };
      }
      setTimeout(() => { this.addMemberSuccess = null; }, 2500);
    }
  }

  openBoard(boardId: string) {
    this.router.navigate(['/retrospective/board', boardId]);
  }

  editBoard(board: RetrospectiveBoard) {
    this.editingBoard = board;
    this.editBoardTitle = board.title;
    this.editBoardDescription = board.description || '';
    this.isEditBoardModalVisible = true;
  }

  cancelEditBoard() {
    this.isEditBoardModalVisible = false;
    this.editingBoard = null;
  }

  async updateBoard() {
    if (!this.editingBoard || !this.editBoardTitle.trim()) return;

    const success = await this.retrospectiveService.updateBoardSupabase(this.editingBoard.id, {
      title: this.editBoardTitle,
      description: this.editBoardDescription
    });

    if (success) {
      this.cancelEditBoard();
    }
  }

  async deleteBoard(boardId: string) {
    if (confirm('Are you sure you want to delete this board? This action cannot be undone.')) {
      await this.retrospectiveService.deleteBoardSupabase(boardId);
    }
  }


  // Utility Methods
  trackByBoardId(index: number, board: RetrospectiveBoard): string {
    return board.id;
  }

  getActiveBoards(): RetrospectiveBoard[] {
    return this.boards.filter(board => board.isActive && board.currentPhase !== 'completed');
  }

  getCompletedBoards(): RetrospectiveBoard[] {
    return this.boards.filter(board => !board.isActive || board.currentPhase === 'completed');
  }

  getFilteredBoards(): RetrospectiveBoard[] {
    if (this.activeTab === 'completed') {
      return this.getCompletedBoards();
    }
    return this.getActiveBoards();
  }

  getTeamMembers(): (import('../../../organization/interfaces/organization.interface').TeamMember & { contributionRate: number, color: string, role: string })[] {
    const roleColors = ['#7954AA', '#10b981', '#f59e0b', '#3b82f6', '#ef4444'];
    const currentTeam = this.organizationQuery.getValue().currentTeam;

    // Use the reactive teamMembers store filtered by current team
    const members = currentTeam
      ? this.teamMembers.filter(m => m.teamId === currentTeam.id)
      : this.teamMembers;

    let result: any[] = [];
    if (members.length > 0) {
      result = members.map((m, i) => ({
        ...m,
        id: m.id,
        name: m.name || m.email || 'Team Member',
        role: this.formatRole(m.role),
        color: roleColors[i % roleColors.length],
        avatarUrl: m.avatarUrl,
        contributionRate: this.memberContributionStats.get((m as any).userId || m.id) || 0
      }));
    } else {
      // Last-resort fallback: use current user only
      const team = currentTeam as any;
      if (team?.members?.length) {
        result = team.members.map((m: any, i: number) => ({
          ...m,
          id: m.id || String(i),
          name: m.name || m.email || 'Team Member',
          role: m.role || 'Member',
          color: roleColors[i % roleColors.length],
          avatarUrl: m.avatarUrl,
          contributionRate: this.memberContributionStats.get(m.user_id || m.id) || 0
        }));
      }
    }

    // Sort by contributionRate high to low
    return result.sort((a, b) => (b.contributionRate || 0) - (a.contributionRate || 0));
  }

  private formatRole(role: string): string {
    const labels: Record<string, string> = {
      owner: 'Owner',
      admin: 'Admin',
      team_lead: 'Team Lead',
      senior: 'Senior Developer',
      developer: 'Developer',
      designer: 'Designer',
      qa: 'QA Engineer',
      member: 'Member'
    };
    return labels[role] || role;
  }


  getMemberInitials(name: string): string {
    const words = name.trim().split(' ');
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return words.map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  }

  getTotalParticipants(): number {
    const allParticipants = new Set<string>();
    this.boards.forEach(board => {
      board.participants.forEach(participant => allParticipants.add(participant));
    });
    return allParticipants.size;
  }

  getThisWeekBoards(): number {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    return this.boards.filter(board => 
      new Date(board.createdAt) >= weekAgo
    ).length;
  }

  getStickyNotesCount(boardId: string): number {
    const board = this.boards.find(b => b.id === boardId);
    return board ? (board.notesCount ?? board.stickyNotes.length) : 0;
  }

  getPhaseColor(phase: RetroPhase): string {
    const colors = {
      [RetroPhase.BRAINSTORMING]: 'blue',
      [RetroPhase.GROUPING]: 'cyan',
      [RetroPhase.VOTING]: 'purple',
      [RetroPhase.DISCUSSION]: 'orange',
      [RetroPhase.ACTION_ITEMS]: 'green',
      [RetroPhase.COMPLETED]: 'default'
    };
    return colors[phase] || 'default';
  }

  getPhaseLabel(phase: RetroPhase): string {
    const labels = {
      [RetroPhase.BRAINSTORMING]: 'Brainstorming',
      [RetroPhase.GROUPING]: 'Grouping',
      [RetroPhase.VOTING]: 'Voting',
      [RetroPhase.DISCUSSION]: 'Discussion',
      [RetroPhase.ACTION_ITEMS]: 'Action Items',
      [RetroPhase.COMPLETED]: 'Completed'
    };
    return labels[phase] || 'Unknown';
  }

  getPhaseDescription(phase: RetroPhase): string {
    const descriptions = {
      [RetroPhase.BRAINSTORMING]: 'Team members are adding their thoughts and feedback',
      [RetroPhase.GROUPING]: 'Organizing similar ideas into groups',
      [RetroPhase.VOTING]: 'Team is voting on the most important items',
      [RetroPhase.DISCUSSION]: 'Discussing key insights and next steps',
      [RetroPhase.ACTION_ITEMS]: 'Creating action items for improvement',
      [RetroPhase.COMPLETED]: 'Retrospective has been completed'
    };
    return descriptions[phase] || 'Status unknown';
  }

  getParticipantInitials(participantId: string): string {
    // In a real app, you would look up participant details
    return participantId.slice(0, 2).toUpperCase();
  }

  getTimeAgo(dateString: string): string {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    
    const diffWeeks = Math.floor(diffDays / 7);
    return `${diffWeeks}w ago`;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Favorites
  toggleBoardFavorite(boardId: string) {
    if (this.favoriteBoards.has(boardId)) {
      this.favoriteBoards.delete(boardId);
    } else {
      this.favoriteBoards.add(boardId);
    }
  }

  isBoardFavorite(boardId: string): boolean {
    return this.favoriteBoards.has(boardId);
  }

  get totalBoardsCount(): string {
    const count = this.boards.length;
    return count < 10 ? `0${count}` : `${count}`;
  }

  get teamMembersCount(): string {
    const count = this.getTeamMembers().length;
    return count < 10 ? `0${count}` : `${count}`;
  }

  async calculateContributionStats() {
    const boardIds = this.boards.map(b => b.id);
    if (boardIds.length === 0) {
      this.memberContributionStats.clear();
      return;
    }

    const allItems = await this.retrospectiveService.getRetroItemsForBoards(boardIds);
    const stats = new Map<string, { user: number; total: number }>();

    // Get current team members to initialize stats
    const currentTeam = this.organizationQuery.getValue().currentTeam;
    const members = currentTeam
      ? this.teamMembers.filter(m => m.teamId === currentTeam.id)
      : this.teamMembers;
    
    members.forEach(m => {
      const userId = (m as any).userId || m.id;
      stats.set(userId, { user: 0, total: 0 });
    });

    // Calculate totals per board
    const boardTotals = new Map<string, number>();
    this.boards.forEach(board => {
      const boardItems = allItems.filter(item => item.board_id === board.id);
      const notesCount = boardItems.length;
      const votesCount = boardItems.reduce((acc, item) => acc + (item.voter_ids?.length || 0), 0);
      boardTotals.set(board.id, notesCount + votesCount);
    });

    // Calculate user contributions
    allItems.forEach(item => {
      // Note contribution
      if (item.user_id && stats.has(item.user_id)) {
        stats.get(item.user_id)!.user += 1;
      }
      // Vote contributions
      if (item.voter_ids) {
        item.voter_ids.forEach((voterId: string) => {
          if (stats.has(voterId)) {
            stats.get(voterId)!.user += 1;
          }
        });
      }
    });

    // Calculate grand total contributions across all boards
    let grandTotal = 0;
    boardTotals.forEach(total => grandTotal += total);

    // Calculate final percentage relative to team grand total
    this.memberContributionStats.clear();
    const rates: number[] = [];

    stats.forEach((val, userId) => {
      // Each user's rate is their total actions / grand total actions of the team
      const rate = grandTotal > 0 ? (val.user / grandTotal) * 100 : 0;
      const roundedRate = Math.round(rate);
      this.memberContributionStats.set(userId, roundedRate);
      rates.push(roundedRate);
    });

    if (rates.length > 0) {
      this.minContribution = Math.min(...rates);
      this.maxContribution = Math.max(...rates);
    } else {
      this.minContribution = 0;
      this.maxContribution = 0;
    }
  }

  getContributionColor(percentage: number): string {
    if (percentage <= 10) return '#DECFF0';
    if (percentage <= 20) return '#CDB7E8';
    if (percentage <= 30) return '#BA9BDE';
    if (percentage <= 40) return '#A67FD2';
    return '#7954AA';
  }
}

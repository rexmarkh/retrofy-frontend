import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { JUser } from '@trungk18/interface/user';
import { AuthQuery } from '@trungk18/project/auth/auth.query';
import { AuthService } from '@trungk18/project/auth/auth.service';
import { ProjectQuery } from '@trungk18/project/state/project/project.query';
import { RetrospectiveService } from '@trungk18/retrospective/state/retrospective.service';
import { Observable, forkJoin, of, BehaviorSubject, combineLatest, timer } from 'rxjs';
import { filter, distinctUntilKeyChanged, map, startWith, distinctUntilChanged } from 'rxjs/operators';
import { trigger, transition, style, animate } from '@angular/animations';

@Component({
  selector: 'app-profile-page',
  templateUrl: './profile-page.component.html',
  styleUrls: ['./profile-page.component.scss'],
  standalone: false,
  animations: [
    trigger('fadeAnimation', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-in', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-out', style({ opacity: 0 }))
      ])
    ])
  ]
})
@UntilDestroy()
export class ProfilePageComponent implements OnInit {
  user$: Observable<JUser | null>;
  currentUser: JUser | null = null;
  isEditing = false;
  
  private loadingSubject = new BehaviorSubject<boolean>(false);
  isLoading$ = this.loadingSubject.asObservable();
  
  showSkeleton$ = combineLatest([
    this.isLoading$,
    timer(1000).pipe(startWith(null))
  ]).pipe(
    map(([loading, timerDone]) => loading || timerDone === null),
    distinctUntilChanged()
  );
  dataReady$ = this.isLoading$.pipe(map(loading => !loading));
  
  // Retro stats
  retrosJoined = 0;
  notesAdded = 0;
  votesCast = 0;
  actionItems = 0;
  categoryDistribution: { [key: string]: number } = {};
  activityHistory: any[] = [];
  
  // Dynamic Trends & Info
  userRole = 'Contributor';
  retrosTrend = 'Active participant';
  notesTrend = 'Identifying team wins';
  votesTrend = 'Supporting team ideas';
  actionItemsTrend = 'Driving progress';
  
  // Profile stats
  totalIssuesAssigned = 0;
  completedIssues = 0;
  activeIssues = 0;
  loginEmail = '';
  lastLoginTime = new Date();

  constructor(
    private authQuery: AuthQuery,
    private authService: AuthService,
    private projectQuery: ProjectQuery,
    private retrospectiveService: RetrospectiveService,
    private router: Router
  ) {
    this.user$ = this.authQuery.user$;
  }

  ngOnInit(): void {
    this.user$.pipe(
      filter(user => !!user),
      distinctUntilKeyChanged('id'),
      untilDestroyed(this)
    ).subscribe(async user => {
      if (!user) {
        this.loadingSubject.next(false);
        return;
      }

      this.currentUser = user;
      this.loginEmail = user.email || '';
      this.lastLoginTime = new Date(); 
      
      this.loadingSubject.next(true);
      try {
        // Load retro stats
        const stats = await this.retrospectiveService.getUserRetroStats(user.id);
        if (stats) {
          this.retrosJoined = stats.retrosJoined;
          this.notesAdded = stats.notesAdded;
          this.votesCast = stats.votesCast;
          this.actionItems = stats.actionItems;
          this.categoryDistribution = stats.categoryDistribution;
          
          // Calculate dynamic trends
          this.votesTrend = this.retrosJoined > 0 
            ? `Avg ${Math.round(this.votesCast / this.retrosJoined)} votes per board`
            : 'Start voting to see stats';
            
          this.userRole = this.notesAdded > 20 ? 'Power Contributor' : 'Active Contributor';
          this.actionItemsTrend = `${this.actionItems} items identified`;
        }

        // Load activity history
        this.activityHistory = await this.retrospectiveService.getUserActivityHistory(user.id);
        
        if (this.activityHistory.length > 0) {
          const lastActivity = new Date(this.activityHistory[0].date);
          this.notesTrend = `Last active ${this.getRelativeTime(lastActivity)}`;
        }

        // Fetch total boards for participation trend using service method
        const totalBoards = await this.retrospectiveService.getTotalRetroBoardsCount();
          
        if (totalBoards && totalBoards > 0) {
          const percent = Math.round((this.retrosJoined / totalBoards) * 100);
          this.retrosTrend = `${percent}% participation rate`;
        }

      } catch (err) {
        console.error('[Profile] Loading failed:', err);
      } finally {
        this.loadingSubject.next(false);
      }

      this.calculateUserStats(user);
    });
  }

  private calculateUserStats(user: JUser): void {
    if (user.issueIds && user.issueIds.length > 0) {
      this.totalIssuesAssigned = user.issueIds.length;
      
      // Get project data to calculate completed vs active issues
      this.projectQuery.all$.pipe(untilDestroyed(this)).subscribe(project => {
        if (project && project.issues) {
          const userIssues = project.issues.filter(issue => 
            user.issueIds.includes(issue.id)
          );
          
          this.completedIssues = userIssues.filter(issue => 
            issue.status === 'Done'
          ).length;
          
          this.activeIssues = userIssues.filter(issue => 
            issue.status !== 'Done'
          ).length;
        }
      });
    }
  }

  toggleEditMode(): void {
    this.isEditing = !this.isEditing;
  }

  saveProfile(): void {
    // Implementation for saving profile changes
    this.isEditing = false;
    // You can add actual save logic here
    console.log('Profile saved');
  }

  logout(): void {
    this.authService.logout();
  }

  cancelEdit(): void {
    this.isEditing = false;
    // Reset any changes if needed
  }

  onSettingChange(setting: string, value: boolean): void {
    // Handle setting changes
    console.log(`Setting ${setting} changed to:`, value);
  }

  goBack(): void {
    this.router.navigate(['/board']);
  }

  formatJoinDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  getUserInitials(user: JUser): string {
    if (!user?.name) return '';
    return user.name
      .split(' ')
      .map(name => name.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getCompletionPercentage(): number {
    if (this.totalIssuesAssigned === 0) return 0;
    return Math.round((this.completedIssues / this.totalIssuesAssigned) * 100);
  }

  onAvatarClick(): void {
    // TODO: Implement avatar upload functionality
    console.log('Avatar clicked - implement upload functionality');
  }

  getLoginType(): string {
    if (!this.loginEmail) return 'Email';
    
    if (this.loginEmail.includes('@gmail.com')) {
      return 'Google';
    } else if (this.loginEmail.includes('@github.com')) {
      return 'GitHub';
    } else {
      return 'Email';
    }
  }

  getLoginBadgeText(): string {
    const loginType = this.getLoginType();
    return loginType === 'Email' ? 'Active Login' : `${loginType} Login`;
  }

  getGroupedActivity(): any[] {
    const rawGroups: Map<string, any> = new Map();

    this.activityHistory.forEach(activity => {
      if (!rawGroups.has(activity.boardId)) {
        rawGroups.set(activity.boardId, {
          boardId: activity.boardId,
          target: activity.target,
          date: activity.date,
          notes: [],
          voteCount: 0
        });
      }
      
      const group = rawGroups.get(activity.boardId);
      if (activity.type === 'added_note') {
        const catClass = activity.category?.toLowerCase()?.split(' ').join('-') || 'default';
        group.notes.push({ ...activity, categoryClass: catClass });
      } else if (activity.type === 'voted') {
        group.voteCount++;
      }
    });

    // Convert Map back to array and structure for template
    return Array.from(rawGroups.values()).map(group => {
      const activities: any[] = [...group.notes];
      if (group.voteCount > 0) {
        activities.push({
          type: 'voted',
          count: group.voteCount,
          date: group.date // Using group date for simplicity
        });
      }
      return {
        ...group,
        activities: activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
  }
}
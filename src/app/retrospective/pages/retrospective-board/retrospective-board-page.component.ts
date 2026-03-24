import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil, combineLatest, timer, map, startWith, distinctUntilChanged } from 'rxjs';
import { trigger, transition, style, animate } from '@angular/animations';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { CdkDragDrop, moveItemInArray, transferArrayItem, DragDropModule } from '@angular/cdk/drag-drop';

import { RetrospectiveService } from '../../state/retrospective.service';
import { RetrospectiveQuery } from '../../state/retrospective.query';
import { AuthQuery } from '../../../project/auth/auth.query';
import { ProjectQuery } from '../../../project/state/project/project.query';
import { RetrospectiveBoard, StickyNote, StickyNoteColor, RetroPhase, RetroColumn } from '../../interfaces/retrospective.interface';
import { RetroColumnComponent } from '../../components/retro-column/retro-column.component';
import { JiraControlModule } from '../../../jira-control/jira-control.module';
import { JUser } from '../../../interface/user';

@Component({
  selector: 'app-retrospective-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TextFieldModule,
    NzLayoutModule,
    NzCardModule,
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzStepsModule,
    NzModalModule,
    NzInputModule,
    NzSelectModule,
    NzToolTipModule,
    NzDividerModule,
    NzAvatarModule,
    NzSkeletonModule,
    DragDropModule,
    RetroColumnComponent,
    JiraControlModule
  ],
  templateUrl: './retrospective-board-page.component.html',
  styleUrls: ['./retrospective-board-page.component.scss'],
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
export class RetrospectiveBoardPageComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  // Make RetroPhase enum available in template
  RetroPhase = RetroPhase;
  
  currentBoard: RetrospectiveBoard | null = null;
  columnDataArrays: { [columnId: string]: StickyNote[] } = {};
  
  isPhaseModalVisible = false;
  isSettingsModalVisible = false;
  selectedPhase: RetroPhase = RetroPhase.BRAINSTORMING;
  settingsTitle = '';
  settingsDescription = '';
  isLoading$ = this.retrospectiveQuery.isLoading$;
  
  showSkeleton$ = combineLatest([
    this.isLoading$,
    timer(1000).pipe(startWith(null))
  ]).pipe(
    map(([loading, timerDone]) => loading || timerDone === null),
    distinctUntilChanged()
  );
  dataReady$ = this.isLoading$.pipe(map(loading => !loading));
  
  // User data
  users: JUser[] = [];

  phaseOptions = [
    { value: RetroPhase.BRAINSTORMING, label: 'Brainstorming', icon: 'bulb' },
    { value: RetroPhase.GROUPING, label: 'Grouping', icon: 'group' },
    { value: RetroPhase.VOTING, label: 'Voting', icon: 'like' },
    { value: RetroPhase.DISCUSSION, label: 'Discussion', icon: 'message' },
    { value: RetroPhase.ACTION_ITEMS, label: 'Action Items', icon: 'check-circle' },
    { value: RetroPhase.COMPLETED, label: 'Completed', icon: 'check' }
  ];

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private retrospectiveService: RetrospectiveService,
    private retrospectiveQuery: RetrospectiveQuery,
    public authQuery: AuthQuery,
    private projectQuery: ProjectQuery,
    private modal: NzModalService
  ) {}

  ngOnInit() {
    // Subscribing to param changes handles navigating between different boards
    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const boardId = params.get('id');
        if (boardId) {
          this.retrospectiveService.loadBoard(boardId);
          this.retrospectiveService.subscribeToBoard(boardId);
        }
      });

    // Subscribe to users
    this.projectQuery.users$
      .pipe(takeUntil(this.destroy$))
      .subscribe(users => {
        this.users = users;
      });

    // Subscribe to current board
    this.retrospectiveQuery.currentBoard$
      .pipe(takeUntil(this.destroy$))
      .subscribe(board => {
        this.currentBoard = board;
        if (board) {
          this.selectedPhase = board.currentPhase;
          this.settingsTitle = board.title;
          this.settingsDescription = board.description;
          
          // Initialize column data arrays for drag & drop
          this.initializeColumnArrays();
        }
      });
  }

  ngOnDestroy() {
    this.retrospectiveService.unsubscribeFromBoard();
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack() {
    this.router.navigate(['/retrospective']);
  }

  getCurrentUserId(): string {
    return this.authQuery.getValue()?.id || '';
  }

  get uniqueParticipants(): string[] {
    if (!this.currentBoard?.participants) return [];
    return Array.from(new Set(this.currentBoard.participants));
  }

  getStickyNotesForColumn(columnId: string): StickyNote[] {
    return this.columnDataArrays[columnId] || [];
  }

  private initializeColumnArrays() {
    if (!this.currentBoard) return;
    
    // Initialize empty arrays for each column
    this.columnDataArrays = {};
    this.currentBoard.columns.forEach(column => {
      this.columnDataArrays[column.id] = [];
    });
    
    // Populate arrays with current notes
    const seenIds = new Set<string>();
    this.currentBoard.stickyNotes.forEach(note => {
      if (seenIds.has(note.id)) return;
      seenIds.add(note.id);
      
      if (this.columnDataArrays[note.columnId]) {
        this.columnDataArrays[note.columnId].push(note);
      }
    });

    // Sort notes by position within each column initially
    Object.keys(this.columnDataArrays).forEach(columnId => {
      this.columnDataArrays[columnId].sort((a, b) => a.position.y - b.position.y);
    });

    // If beyond BRAINSTORMING phase, sort by vote count descending instead
    if (this.currentBoard.currentPhase !== RetroPhase.BRAINSTORMING) {
      Object.keys(this.columnDataArrays).forEach(columnId => {
        const notes = this.columnDataArrays[columnId];
        
        // Pre-calculate max votes per group for efficient sorting
        const groupMaxVotes: Record<string, number> = {};
        notes.forEach(n => {
          if (n.groupId) {
            groupMaxVotes[n.groupId] = Math.max(groupMaxVotes[n.groupId] || 0, n.votes || 0);
          }
        });

        notes.sort((a, b) => {
          // 1. Group by tags (groupId) if available
          if (a.groupId || b.groupId) {
            if (a.groupId !== b.groupId) {
              // Both have groups - sort by group's importance (max votes)
              if (a.groupId && b.groupId) {
                const maxA = groupMaxVotes[a.groupId] || 0;
                const maxB = groupMaxVotes[b.groupId] || 0;
                if (maxA !== maxB) return maxB - maxA;
                return a.groupId.localeCompare(b.groupId);
              }
              // Ungrouped items go to the bottom
              return a.groupId ? -1 : 1;
            }
          }

          // 2. Internally (or if no groups), sort by votes high to low
          return (b.votes || 0) - (a.votes || 0);
        });
      });
    }
  }

  trackByColumnId(index: number, column: RetroColumn): string {
    return column.id;
  }

  // Phase Management
  getCurrentPhaseStep(): number {
    if (!this.currentBoard) return 0;
    
    const phaseSteps = {
      [RetroPhase.BRAINSTORMING]: 0,
      [RetroPhase.GROUPING]: 1,
      [RetroPhase.VOTING]: 2,
      [RetroPhase.DISCUSSION]: 3,
      [RetroPhase.ACTION_ITEMS]: 4,
      [RetroPhase.COMPLETED]: 4
    };
    
    return phaseSteps[this.currentBoard.currentPhase] || 0;
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

  getPhaseIcon(phase: RetroPhase): string {
    const icons = {
      [RetroPhase.BRAINSTORMING]: 'bulb',
      [RetroPhase.GROUPING]: 'group',
      [RetroPhase.VOTING]: 'like',
      [RetroPhase.DISCUSSION]: 'message',
      [RetroPhase.ACTION_ITEMS]: 'check-circle',
      [RetroPhase.COMPLETED]: 'check'
    };
    return icons[phase] || 'question';
  }

  getPhaseInstructions(phase: RetroPhase): string {
    const instructions = {
      [RetroPhase.BRAINSTORMING]: 'Add sticky notes with your thoughts about what went well, what could be improved, and action items for the next sprint.',
      [RetroPhase.GROUPING]: 'Group similar ideas together by dragging notes close to each other. This helps identify common themes.',
      [RetroPhase.VOTING]: 'Vote on the most important items by clicking the like button. Focus on what matters most to the team.',
      [RetroPhase.DISCUSSION]: 'Discuss the highest-voted items. Share perspectives and dive deeper into the key topics.',
      [RetroPhase.ACTION_ITEMS]: 'Define concrete action items based on your discussion. Assign owners and set deadlines.',
      [RetroPhase.COMPLETED]: 'Retrospective completed! Review the action items and plan for the next retrospective.'
    };
    return instructions[phase] || '';
  }

  getPhaseDescription(phase: RetroPhase): string {
    return this.getPhaseInstructions(phase);
  }

  getPhaseTitle(phase: RetroPhase): string {
    return this.getPhaseLabel(phase);
  }

  getPhaseShortDescription(phase: RetroPhase): string {
    const descriptions = {
      [RetroPhase.BRAINSTORMING]: 'Share thoughts & ideas',
      [RetroPhase.GROUPING]: 'Organize similar notes',
      [RetroPhase.VOTING]: 'Vote on key topics',
      [RetroPhase.DISCUSSION]: 'Discuss & collaborate',
      [RetroPhase.ACTION_ITEMS]: 'Create action plan',
      [RetroPhase.COMPLETED]: 'Review & complete'
    };
    return descriptions[phase] || '';
  }

  getPhaseTooltip(phase: RetroPhase): string {
    if (this.currentBoard?.currentPhase === phase) {
      return 'Current phase - ' + this.getPhaseInstructions(phase);
    }
    if (this.isPhaseCompleted(phase)) {
      return 'Completed - Click to return to this phase';
    }
    return 'Click to move to this phase - ' + this.getPhaseInstructions(phase);
  }

  isPhaseCompleted(phase: RetroPhase): boolean {
    if (!this.currentBoard) return false;
    
    const phaseOrder = [
      RetroPhase.BRAINSTORMING,
      RetroPhase.GROUPING,
      RetroPhase.VOTING,
      RetroPhase.DISCUSSION,
      RetroPhase.ACTION_ITEMS,
      RetroPhase.COMPLETED
    ];
    
    const currentIndex = phaseOrder.indexOf(this.currentBoard.currentPhase);
    const targetIndex = phaseOrder.indexOf(phase);
    
    return targetIndex < currentIndex;
  }

  canChangePhase(): boolean {
    // In a real app, you might check if the user is a facilitator
    return true;
  }

  isPhaseClickable(phase: RetroPhase): boolean {
    if (!this.currentBoard || !this.canChangePhase()) {
      return false;
    }

    // If board is completed, no one can change phase (locking the board)
    if (this.currentBoard.currentPhase === RetroPhase.COMPLETED) {
      return false;
    }

    // Current phase is not clickable (already there)
    if (this.currentBoard.currentPhase === phase) {
      return false;
    }

    // Get the phase order
    const phases = this.retroPhases;
    const currentPhaseIndex = phases.indexOf(this.currentBoard.currentPhase);
    const targetPhaseIndex = phases.indexOf(phase);

    // Can only move backward (to completed phases) or forward to immediate next phase
    return targetPhaseIndex < currentPhaseIndex || targetPhaseIndex === currentPhaseIndex + 1;
  }

  get currentPhaseIndex(): number {
    if (!this.currentBoard) return -1;
    return this.retroPhases.indexOf(this.currentBoard.currentPhase);
  }

  canGoToPreviousPhase(): boolean {
    const index = this.currentPhaseIndex;
    return index > 0 && this.isPhaseClickable(this.retroPhases[index - 1]);
  }

  canGoToNextPhase(): boolean {
    const index = this.currentPhaseIndex;
    return index < this.retroPhases.length - 1 && this.isPhaseClickable(this.retroPhases[index + 1]);
  }

  goToPreviousPhase(): void {
    if (this.canGoToPreviousPhase()) {
      this.changePhase(this.retroPhases[this.currentPhaseIndex - 1]);
    }
  }

  goToNextPhase(): void {
    if (this.canGoToNextPhase()) {
      this.changePhase(this.retroPhases[this.currentPhaseIndex + 1]);
    }
  }

  changePhase(phase: RetroPhase) {
    if (!this.isPhaseClickable(phase)) {
      return;
    }

    // Special handling for GROUPING phase - offer AI assistance
    if (phase === RetroPhase.GROUPING && this.currentBoard?.currentPhase === RetroPhase.BRAINSTORMING) {
      const modal = this.modal.create({
        nzTitle: `Switch to ${this.getPhaseTitle(phase)} Phase?`,
        nzClassName: 'premium-modal',
        nzWrapClassName: 'premium-modal',
        nzContent: this.getPhaseChangeWarning(phase) + `
          <div style="margin-top: 16px; padding: 20px; background: linear-gradient(135deg, #7954AA 0%, #5a3d82 100%); border-radius: 12px; color: white; box-shadow: 0 4px 12px rgba(121, 84, 170, 0.2);">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <span style="font-size: 24px;">💡</span>
              <span style="font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px;">AI Opportunity</span>
            </div>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; opacity: 0.9;">The <strong>Grouping</strong> phase is where Retrofy AI shines. We can automatically group similar stickers and sort them by team priority for you!</p>
          </div>
        `,
        nzFooter: [
          {
            label: 'Maybe Later',
            onClick: () => {
              this.retrospectiveService.updatePhase(phase);
              modal.destroy();
            }
          },
          {
            label: '✨ Use AI Grouping',
            type: 'primary',
            onClick: () => {
              this.retrospectiveService.updatePhase(phase);
              modal.destroy();
              setTimeout(() => this.performAIGrouping(), 500);
            }
          }
        ]
      });
      return;
    }

    // Show confirmation modal for other phases
    const modal = this.modal.create({
      nzTitle: `Switch to ${this.getPhaseTitle(phase)} Phase?`,
      nzClassName: 'premium-modal',
      nzWrapClassName: 'premium-modal',
      nzContent: this.getPhaseChangeWarning(phase),
      nzFooter: [
        {
          label: 'Cancel',
          onClick: () => modal.destroy()
        },
        {
          label: 'Yes, Switch Phase',
          type: 'primary',
          onClick: () => {
            this.retrospectiveService.updatePhase(phase);
            modal.destroy();
          }
        }
      ]
    });
  }

  getPhaseChangeWarning(phase: RetroPhase): string {
    const currentPhase = this.currentBoard?.currentPhase;
    
    // Generate contextual warnings based on current and target phase
    const warnings: { [key: string]: string } = {
      [RetroPhase.BRAINSTORMING]: `
        <div style="margin-bottom: 12px;">
          <strong>Switching to Brainstorming phase will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Allow adding and editing notes</li>
            <li>Enable note deletion</li>
            <li>Disable voting functionality</li>
            <li>Hide author information for privacy</li>
          </ul>
        </div>
      `,
      [RetroPhase.GROUPING]: `
        <div style="margin-bottom: 12px;">
          <strong>Switching to Grouping phase will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Disable adding new notes</li>
            <li>Disable editing and deleting notes</li>
            <li>Allow moving notes between columns</li>
            <li>Keep author information hidden</li>
          </ul>
        </div>
      `,
      [RetroPhase.VOTING]: `
        <div style="margin-bottom: 12px;">
          <strong>Switching to Voting phase will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Disable editing and moving notes</li>
            <li>Enable voting on notes</li>
            <li>Keep author information hidden</li>
            <li>Focus on prioritizing key topics</li>
          </ul>
        </div>
      `,
      [RetroPhase.DISCUSSION]: `
        <div style="margin-bottom: 12px;">
          <strong>Switching to Discussion phase will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Disable all note modifications</li>
            <li>Reveal author information</li>
            <li>Show voting results</li>
            <li>Focus on discussing high-priority items</li>
          </ul>
        </div>
      `,
      [RetroPhase.ACTION_ITEMS]: `
        <div style="margin-bottom: 12px;">
          <strong>Switching to Action Items phase will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Disable all note modifications</li>
            <li>Show all author information</li>
            <li>Focus on creating action plans</li>
            <li>Prepare for retrospective completion</li>
          </ul>
        </div>
      `,
      [RetroPhase.COMPLETED]: `
        <div style="margin-bottom: 12px;">
          <strong>Completing this retrospective will:</strong>
          <ul style="margin-top: 8px; padding-left: 20px; list-style-type: disc;">
            <li>Lock all modifications</li>
            <li>Make the board read-only</li>
            <li>Preserve all data for review</li>
            <li style="color: #ef4444; font-weight: 500;">⚠️ This cannot be easily undone</li>
          </ul>
        </div>
      `
    };

    return warnings[phase] || 'Are you sure you want to switch to this phase?';
  }

  showPhaseModal() {
    this.isPhaseModalVisible = true;
  }

  updatePhase() {
    this.retrospectiveService.updatePhase(this.selectedPhase);
    this.isPhaseModalVisible = false;
  }

  cancelPhaseUpdate() {
    this.isPhaseModalVisible = false;
    if (this.currentBoard) {
      this.selectedPhase = this.currentBoard.currentPhase;
    }
  }

  showSettingsModal() {
    this.isSettingsModalVisible = true;
  }

  saveSettings() {
    if (this.currentBoard?.currentPhase === RetroPhase.COMPLETED) {
      return;
    }
    // In a real app, you would update the board settings via the service
    console.log('Saving settings:', { title: this.settingsTitle, description: this.settingsDescription });
    this.isSettingsModalVisible = false;
  }

  cancelSettings() {
    this.isSettingsModalVisible = false;
    if (this.currentBoard) {
      this.settingsTitle = this.currentBoard.title;
      this.settingsDescription = this.currentBoard.description;
    }
  }


  getParticipantAvatar(participantId: string): string | undefined {
    const user = this.users.find(u => u.id === participantId);
    if (user?.avatarUrl) return user.avatarUrl;
    
    // Fallback to profile avatar joined from sticky notes
    const note = this.currentBoard?.stickyNotes.find(n => n.authorId === participantId && n.authorAvatar);
    return note?.authorAvatar;
  }

  getParticipantInitials(participantId: string): string {
    const name = this.getParticipantName(participantId);
    if (!name || name.startsWith('User ')) return participantId.slice(0, 2).toUpperCase();
    
    return name
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  getParticipantName(participantId: string): string {
    const user = this.users.find(u => u.id === participantId);
    if (user?.name) return user.name;
    
    // Fallback to profile name joined from sticky notes
    const note = this.currentBoard?.stickyNotes.find(n => n.authorId === participantId && n.authorName && n.authorName !== 'Anonymous');
    if (note?.authorName) return note.authorName;

    return `User ${participantId.substring(0, 4)}`;
  }
  
  isFacilitator(userId: string): boolean {
    return this.currentBoard?.facilitatorId === userId;
  }

  // Note event handlers
  onNoteAdd(data: { columnId: string, content: string, color: StickyNoteColor, isAnonymous: boolean }) {
    this.retrospectiveService.addStickyNote(data.columnId, data.content, data.color, data.isAnonymous);
  }

  onNoteChange(note: StickyNote) {
    this.retrospectiveService.updateStickyNote(note.id, note);
  }

  onNoteDelete(noteId: string) {
    this.retrospectiveService.deleteStickyNote(noteId);
  }

  onNoteVote(noteId: string) {
    if (!this.currentBoard) return;
    
    const votingPhases = [
      RetroPhase.BRAINSTORMING,
      RetroPhase.GROUPING,
      RetroPhase.VOTING
    ];
    
    if (votingPhases.includes(this.currentBoard.currentPhase)) {
      this.retrospectiveService.voteOnStickyNote(noteId);
    }
  }

  onNoteDrop(event: CdkDragDrop<StickyNote[]>) {
    const draggedNote = event.item.data as StickyNote;
    
    if (event.previousContainer === event.container) {
      // Same column - reorder notes
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      
      // Update positions for all notes in the column
      event.container.data.forEach((note, index) => {
        this.retrospectiveService.updateStickyNote(note.id, {
          position: { x: note.position.x, y: index * 120 + 10 },
          updatedAt: new Date().toISOString()
        });
      });
    } else {
      // Different column - transfer note
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
      
      // Get the new column ID from the container ID
      const newColumnId = event.container.id.replace('drop-list-', '');
      
      if (draggedNote && newColumnId && newColumnId !== draggedNote.columnId) {
        // Update the note's column and position
        this.retrospectiveService.updateStickyNote(draggedNote.id, {
          columnId: newColumnId,
          position: {
            x: 0,
            y: event.currentIndex * 120 + 10
          },
          updatedAt: new Date().toISOString()
        });
        
        // Update positions for all notes in both columns
        event.previousContainer.data.forEach((note, index) => {
          this.retrospectiveService.updateStickyNote(note.id, {
            position: { x: note.position.x, y: index * 120 + 10 },
            updatedAt: new Date().toISOString()
          });
        });
        
        event.container.data.forEach((note, index) => {
          this.retrospectiveService.updateStickyNote(note.id, {
            position: { x: note.position.x, y: index * 120 + 10 },
            updatedAt: new Date().toISOString()
          });
        });
      }
    }
  }

  // Phase management methods
  get retroPhases() {
    return Object.values(RetroPhase);
  }

  cancelPhaseChange() {
    this.isPhaseModalVisible = false;
    this.selectedPhase = this.currentBoard?.currentPhase || RetroPhase.BRAINSTORMING;
  }

  // AI Grouping functionality
  performAIGrouping() {
    if (!this.currentBoard) return;

    const notificationKey = `ai-grouping-${Date.now()}`;
    
    // Show loading notification
    this.modal.info({
      nzTitle: '🤖 AI Grouping in Progress',
      nzClassName: 'premium-modal',
      nzWrapClassName: 'premium-modal',
      nzContent: `
        <div style="text-align: center; padding: 32px 20px;">
          <div style="font-size: 56px; margin-bottom: 24px; display: inline-block; animation: pulse 2s ease-in-out infinite;">
            <span>🤖</span>
          </div>
          <h4 style="font-weight: 800; font-size: 16px; color: #1e293b; margin-bottom: 8px;">Analyzing Notes...</h4>
          <p style="color: #64748b; font-size: 14px; margin: 0;">Retrofy AI is clustering similar items and sorting them by team priority. This will only take a moment.</p>
        </div>
      `,
      nzOkText: 'Working...',
      nzOkDisabled: true,
      nzClosable: false,
      nzMaskClosable: false
    });

    // Simulate AI processing (in production, this would call an AI service)
    setTimeout(() => {
      const noteUpdates = this.analyzeAndGroupNotes();
      
      // Apply the grouping and sorting positions
      noteUpdates.forEach(update => {
        this.retrospectiveService.updateStickyNote(update.noteId, {
          tags: update.tags,
          groupId: update.groupId,
          position: update.position
        });
      });

      // Close loading modal and show success
      this.modal.closeAll();
      
      setTimeout(() => {
        this.modal.success({
          nzTitle: '✨ AI Grouping Complete!',
          nzClassName: 'premium-modal',
          nzWrapClassName: 'premium-modal',
          nzContent: `
            <div style="padding: 4px;">
              <p style="margin-bottom: 16px; color: #475569; line-height: 1.6;">Successfully analyzed, grouped, and sorted <strong>${this.currentBoard?.stickyNotes.length} notes</strong> by category and priority.</p>
              <div style="background: #f8fafc; padding: 16px; border-radius: 12px; border: 1px solid #f1f5f9; display: flex; align-items: flex-start; gap: 12px;">
                <span style="font-size: 20px;">🛡️</span>
                <p style="margin: 0; font-size: 13px; color: #64748b;">You can still manually group items or move them between columns if needed.</p>
              </div>
            </div>
          `,
          nzOkText: 'Great!',
          nzWidth: 500
        });
      }, 100);
    }, 2500); // Simulate AI processing time
  }

  private analyzeAndGroupNotes(): Array<{ noteId: string; tags: string[]; groupId: string; position: { x: number, y: number } }> {
    if (!this.currentBoard) return [];

    const allUpdates: Array<{ noteId: string; tags: string[]; groupId: string; position: { x: number, y: number } }> = [];
    
    // Group notes by column first
    const notesByColumn: { [columnId: string]: StickyNote[] } = {};
    this.currentBoard.stickyNotes.forEach(note => {
      if (!notesByColumn[note.columnId]) {
        notesByColumn[note.columnId] = [];
      }
      notesByColumn[note.columnId].push(note);
    });

    // Analyze and sort each column separately
    Object.entries(notesByColumn).forEach(([columnId, notes]) => {
      // 1. Assign tags and temporary group IDs
      const taggedNotes = notes.map(note => {
        const analysis = this.analyzeNoteContent(note.content, columnId);
        return {
          ...note,
          tempTags: analysis.tags,
          tempGroupId: analysis.groupId
        };
      });

      // 2. Group notes by primary tag
      const groups: { [groupId: string]: any[] } = {};
      taggedNotes.forEach(note => {
        if (!groups[note.tempGroupId]) {
          groups[note.tempGroupId] = [];
        }
        groups[note.tempGroupId].push(note);
      });

      // 3. Rank groups by highest individual vote count within group
      const sortedGroupIds = Object.keys(groups).sort((idA, idB) => {
        const maxVotesA = Math.max(...groups[idA].map(n => n.votes || 0));
        const maxVotesB = Math.max(...groups[idB].map(n => n.votes || 0));
        return maxVotesB - maxVotesA;
      });

      // 4. Flatten and assign positions
      let currentY = 10;
      const columnUpdates: any[] = [];
      
      sortedGroupIds.forEach(groupId => {
        // Sort notes within group by votes
        const sortedNotesInGroup = groups[groupId].sort((a, b) => (b.votes || 0) - (a.votes || 0));
        
        sortedNotesInGroup.forEach(note => {
          columnUpdates.push({
            noteId: note.id,
            tags: note.tempTags,
            groupId: note.tempGroupId,
            position: { x: 0, y: currentY }
          });
          currentY += 120; // Standard spacing
        });
      });

      allUpdates.push(...columnUpdates);
    });

    return allUpdates;
  }

  private analyzeNoteContent(content: string, columnId: string): { tags: string[], groupId: string } {
    const keywords = {
      'Communication': ['communication', 'talk', 'discuss', 'meeting', 'sync', 'share', 'update', 'inform'],
      'Process': ['process', 'workflow', 'procedure', 'system', 'method', 'approach', 'way'],
      'Technical': ['code', 'bug', 'technical', 'deploy', 'build', 'test', 'review', 'refactor', 'architecture'],
      'Team': ['team', 'collaboration', 'together', 'help', 'support', 'pair', 'cooperation'],
      'Documentation': ['document', 'docs', 'documentation', 'wiki', 'readme', 'guide', 'manual'],
      'Time': ['time', 'deadline', 'schedule', 'late', 'early', 'duration', 'speed', 'fast', 'slow'],
      'Quality': ['quality', 'improvement', 'better', 'improve', 'enhance', 'optimize', 'excellent'],
      'Planning': ['plan', 'planning', 'estimate', 'forecast', 'strategy', 'goal', 'objective'],
      'Tools': ['tool', 'platform', 'software', 'application', 'service', 'framework', 'library'],
      'Blocker': ['blocker', 'blocked', 'issue', 'problem', 'obstacle', 'challenge', 'difficulty']
    };

    const matchedTags: string[] = [];
    const lowerContent = content.toLowerCase();
    
    Object.entries(keywords).forEach(([category, words]) => {
      const hasMatch = words.some(word => lowerContent.includes(word.toLowerCase()));
      if (hasMatch) {
        matchedTags.push(category);
      }
    });

    if (matchedTags.length === 0) {
      matchedTags.push('General');
    }

    const primaryTag = matchedTags[0];
    const groupId = `${columnId}-${primaryTag.toLowerCase().replace(/\s+/g, '-')}`;

    return {
      tags: matchedTags.slice(0, 3),
      groupId: groupId
    };
  }

  private getUniqueGroups(): string[] {
    if (!this.currentBoard) return [];

    const groups = new Set<string>();
    this.currentBoard.stickyNotes.forEach(note => {
      if (note.tags && note.tags.length > 0) {
        note.tags.forEach(tag => groups.add(tag));
      }
    });

    return Array.from(groups).sort();
  }
}

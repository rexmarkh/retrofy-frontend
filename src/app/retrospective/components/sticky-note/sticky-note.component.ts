import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef, TemplateRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { StickyNote, StickyNoteColor, RetroPhase } from '../../interfaces/retrospective.interface';
import { JiraControlModule } from '../../../jira-control/jira-control.module';
import { environment } from '../../../../environments/environment';
import { RetrospectiveService } from '../../state/retrospective.service';

@Component({
  selector: 'app-sticky-note',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TextFieldModule,
    NzCardModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
    NzPopoverModule,
    NzTagModule,
    NzToolTipModule,
    NzDropDownModule,
    NzMenuModule,
    DragDropModule,
    JiraControlModule
  ],
  templateUrl: './sticky-note.component.html',
  styleUrls: ['./sticky-note.component.scss'],
  host: {
    'style': 'display: block;'
  }
})
export class StickyNoteComponent implements OnInit, OnDestroy {
  @Input() note!: StickyNote;
  @Input() currentUserId: string = '';
  @Input() facilitatorId: string = '';
  @Input() currentPhase: RetroPhase = RetroPhase.BRAINSTORMING;
  @Input() teamAbbreviation: string = 'NT';
  @Input() currentUserRole: string | null = null;
  @Output() noteChange = new EventEmitter<StickyNote>();
  @Output() noteDelete = new EventEmitter<string>();
  @Output() noteVote = new EventEmitter<string>();
  @Output() noteEdit = new EventEmitter<StickyNote>();

  colorOptions = Object.values(StickyNoteColor);
  
  @ViewChild('contentElement') contentElement?: ElementRef;
  @ViewChild('noteModalContent') noteModalContent?: TemplateRef<any>;
  isTruncated = false;
  isGeneratingActionItem = false;

  constructor(
    private modal: NzModalService,
    private cdr: ChangeDetectorRef,
    private retrospectiveService: RetrospectiveService
  ) {}

  ngOnInit() {
    // Component initialization
  }

  ngOnDestroy() {
    // Clean up any subscriptions if needed
  }

  ngAfterViewChecked() {
    this.checkTruncation();
  }

  checkTruncation() {
    if (this.contentElement) {
      const el = this.contentElement.nativeElement;
      const truncated = el.scrollHeight > el.offsetHeight;
      if (truncated !== this.isTruncated) {
        this.isTruncated = truncated;
        this.cdr.detectChanges();
      }
    }
  }

  showFullNote() {
    if (this.noteModalContent) {
      this.modal.create({
        nzTitle: `Note ${this.teamAbbreviation}-${this.note.noteNumber}`,
        nzContent: this.noteModalContent,
        nzFooter: null,
        nzClassName: 'premium-modal',
        nzWrapClassName: 'premium-modal',
        nzCentered: true,
        nzWidth: 600
      });
    }
  }

  getBackgroundColor(): string {
    return this.getColorValue(this.note.color);
  }

  getBorderColor(): string {
    const colorMap = {
      [StickyNoteColor.YELLOW]: '#fbbf24',
      [StickyNoteColor.GREEN]: '#34d399',
      [StickyNoteColor.BLUE]: '#60a5fa',
      [StickyNoteColor.PINK]: '#f472b6',
      [StickyNoteColor.PURPLE]: '#a78bfa',
      [StickyNoteColor.ORANGE]: '#fb923c'
    };
    return colorMap[this.note.color] || colorMap[StickyNoteColor.YELLOW];
  }

  getColorValue(color: StickyNoteColor): string {
    const colorMap = {
      [StickyNoteColor.YELLOW]: '#fef9c3',
      [StickyNoteColor.GREEN]: '#d1fae5',
      [StickyNoteColor.BLUE]: '#e0f2fe',
      [StickyNoteColor.PINK]: '#fce7f3',
      [StickyNoteColor.PURPLE]: '#ede9fe',
      [StickyNoteColor.ORANGE]: '#fed7aa'
    };
    return colorMap[color] || colorMap[StickyNoteColor.YELLOW];
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(n => n.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  hasUserVoted(): boolean {
    return this.note.voterIds.includes(this.currentUserId);
  }

  getTimeAgo(): string {
    const now = new Date();
    const created = new Date(this.note.createdAt);
    const diffMs = now.getTime() - created.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  // Permission methods
  canEdit(): boolean {
    // Edit is only allowed for the note author during brainstorming phase
    return this.currentPhase === RetroPhase.BRAINSTORMING && 
           this.note.authorId === this.currentUserId;
  }

  canDelete(): boolean {
    // Delete is allowed for:
    // 1. The note author during brainstorming phase
    // 2. Organization Admins or Owners at any time (moderation)
    const isAuthor = this.note.authorId === this.currentUserId;
    const isAdminOrOwner = this.currentUserRole === 'admin' || this.currentUserRole === 'owner';
    
    if (isAdminOrOwner) return true;
    
    return this.currentPhase === RetroPhase.BRAINSTORMING && isAuthor;
  }

  canChangeColor(): boolean {
    // Color change is only allowed during brainstorming phase
    return this.currentPhase === RetroPhase.BRAINSTORMING && 
           this.note.authorId === this.currentUserId;
  }

  canDrag(): boolean {
    // Dragging is allowed during brainstorming and grouping phases
    // But strictly disabled if completed
    if (this.currentPhase === RetroPhase.COMPLETED) {
      return false;
    }
    return this.currentPhase === RetroPhase.BRAINSTORMING || 
           this.currentPhase === RetroPhase.GROUPING;
  }

  canVote(): boolean {
    // Voting is allowed in Brainstorming, Grouping, and Voting phases
    const votingPhases = [
      RetroPhase.BRAINSTORMING,
      RetroPhase.GROUPING,
      RetroPhase.VOTING
    ];
    return votingPhases.includes(this.currentPhase);
  }

  shouldShowAuthor(): boolean {
    // 1. Logged in user always sees themselves on their own notes
    if (this.note.authorId === this.currentUserId) {
      return true;
    }

    // 2. If it's a strictly anonymous note, NEVER show author to others
    if (this.note.isAnonymous) {
      return false;
    }

    // 3. Regular notes: Others revealed during Discussion Phase and beyond
    return this.currentPhase === RetroPhase.DISCUSSION || 
           this.currentPhase === RetroPhase.COMPLETED;
  }

  canMarkAsCompleted(): boolean {
    // Only the facilitator can mark as completed in this implementation
    // Future: check for organization admin/owner roles if needed
    const isDiscussionPhase = this.currentPhase === RetroPhase.DISCUSSION;
    if (!isDiscussionPhase) return false;

    return this.facilitatorId === this.currentUserId;
  }

  toggleCompleted() {
    if (!this.canMarkAsCompleted()) return;
    
    // We update through the regular note change flow
    const updatedNote = {
      ...this.note,
      isCompleted: !this.note.isCompleted,
      updatedAt: new Date().toISOString()
    };
    this.noteChange.emit(updatedNote);
  }

  shouldShowAnonymous(): boolean {
    return !this.shouldShowAuthor();
  }

  getDragDisabledMessage(): string {
    if (this.currentPhase === RetroPhase.VOTING) {
      return 'Notes cannot be moved during voting phase';
    } else if (this.currentPhase === RetroPhase.DISCUSSION) {
      return 'Notes cannot be moved during discussion phase';
    } else if (this.currentPhase === RetroPhase.COMPLETED) {
      return 'Retrospective is completed - no changes allowed';
    }
    return 'Dragging not allowed in current phase';
  }

  startEditing() {
    if (!this.canEdit()) {
      return;
    }
    
    // Emit event to parent to open edit modal
    this.noteEdit.emit(this.note);
  }

  canGenerateActionItem(): boolean {
    const isNotCompleted = this.currentPhase !== RetroPhase.COMPLETED;
    const isNotActionItemColumn = this.note.columnId !== 'action-items';
    const isFacilitator = this.facilitatorId === this.currentUserId;
    const isAdminOrOwner = this.currentUserRole === 'admin' || this.currentUserRole === 'owner';
    return isNotCompleted && isNotActionItemColumn && (isFacilitator || isAdminOrOwner);
  }

  async handleGenerateActionItem() {
    if (this.isGeneratingActionItem || !this.canGenerateActionItem()) return;

    this.isGeneratingActionItem = true;
    const sourceNoteId = `${this.teamAbbreviation}-${this.note.noteNumber}`;
    let tempId: string | null = null;
    
    try {
      // 1. Show optimistic placeholder in Action Items column
      const placeholderContent = `AI is suggesting an action item for [Ref: ${sourceNoteId}]...`;
      tempId = this.retrospectiveService.addOptimisticNote(
        'action-items',
        placeholderContent,
        this.note.color
      );

      // 2. Call AI service
      const actionItemContent = await this.retrospectiveService.generateActionItem(this.note.content);
      
      // 3. Remove placeholder
      if (tempId) {
        this.retrospectiveService.removeOptimisticNote(tempId);
        tempId = null;
      }

      if (actionItemContent) {
        // 4. Add final action item with reference
        const finalContent = `${actionItemContent}\n\n[Ref: ${sourceNoteId}]`;
        await this.retrospectiveService.addStickyNote(
          'action-items',
          finalContent,
          this.note.color,
          false
        );
      }
    } catch (error) {
      console.error('Failed to suggest action item:', error);
      // Clean up placeholder on error
      if (tempId) {
        this.retrospectiveService.removeOptimisticNote(tempId);
      }
    } finally {
      this.isGeneratingActionItem = false;
      this.cdr.detectChanges();
    }
  }

  changeColor(color: StickyNoteColor) {
    if (!this.canChangeColor()) {
      return;
    }
    
    if (color !== this.note.color) {
      const updatedNote = {
        ...this.note,
        color,
        updatedAt: new Date().toISOString()
      };
      this.noteChange.emit(updatedNote);
    }
  }

  onVote() {
    if (this.canVote()) {
      this.noteVote.emit(this.note.id);
    }
  }

  confirmDelete() {
    if (!this.canDelete()) {
      return;
    }
    
    // Show confirmation dialog with more context
    const confirmMessage = `Are you sure you want to delete this note?\n\n"${this.note.content}"\n\nThis action cannot be undone.`;
    if (confirm(confirmMessage)) {
      this.noteDelete.emit(this.note.id);
    }
  }

  getTagColor(tag: string): string {
    const tagColors: { [key: string]: string } = {
      'Communication': 'blue',
      'Process': 'cyan',
      'Technical': 'purple',
      'Team': 'green',
      'Documentation': 'geekblue',
      'Time': 'orange',
      'Quality': 'lime',
      'Planning': 'magenta',
      'Tools': 'volcano',
      'Blocker': 'red',
      'General': 'default'
    };
    
    return tagColors[tag] || 'default';
  }

  private getTagIndex(tag: string): number {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  getTagBackgroundColor(tag: string): string {
    const normalizedTag = tag.toUpperCase().trim();
    
    const bgColors: { [key: string]: string } = {
      'COMMUNICATION': '#e0f2fe',
      'PROCESS': '#cffafe',
      'TECHNICAL': '#ede9fe',
      'TEAM': '#dcfce7',
      'TEAMWORK': '#dcfce7',
      'DOCUMENTATION': '#dbeafe',
      'TIME': '#fed7aa',
      'QUALITY': '#ecfccb',
      'PLANNING': '#fce7f3',
      'TOOLS': '#fee2e2',
      'BLOCKER': '#fecaca',
      'GENERAL': '#fef9c3',
      'GENERAL FEEDBACK': '#fef9c3',
      'TESTING': '#e0f2fe',
      'SCENARIOS': '#ede9fe',
    };
    
    if (bgColors[normalizedTag]) {
      return bgColors[normalizedTag];
    }

    // Fallback dynamic palette (premium soft background colors)
    const fallbackBgs = ['#e0f2fe', '#cffafe', '#ede9fe', '#dcfce7', '#dbeafe', '#fed7aa', '#ecfccb', '#fce7f3', '#fee2e2', '#fef9c3'];
    return fallbackBgs[this.getTagIndex(normalizedTag) % fallbackBgs.length];
  }

  getTagTextColor(tag: string): string {
    const normalizedTag = tag.toUpperCase().trim();
    
    const textColors: { [key: string]: string } = {
      'COMMUNICATION': '#0369a1',
      'PROCESS': '#0891b2',
      'TECHNICAL': '#7954AA',
      'TEAM': '#15803d',
      'TEAMWORK': '#15803d',
      'DOCUMENTATION': '#1e40af',
      'TIME': '#c2410c',
      'QUALITY': '#4d7c0f',
      'PLANNING': '#be185d',
      'TOOLS': '#b91c1c',
      'BLOCKER': '#dc2626',
      'GENERAL': '#854d0e',
      'GENERAL FEEDBACK': '#854d0e',
      'TESTING': '#0369a1',
      'SCENARIOS': '#7954AA',
    };
    
    if (textColors[normalizedTag]) {
      return textColors[normalizedTag];
    }

    // Fallback dynamic palette (premium dark text colors)
    const fallbackTexts = ['#0369a1', '#0891b2', '#7954AA', '#15803d', '#1e40af', '#c2410c', '#4d7c0f', '#be185d', '#b91c1c', '#854d0e'];
    return fallbackTexts[this.getTagIndex(normalizedTag) % fallbackTexts.length];
  }
}
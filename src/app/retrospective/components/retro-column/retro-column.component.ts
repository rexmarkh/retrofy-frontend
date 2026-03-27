import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { CdkDropList, CdkDragDrop, CdkDragStart, CdkDragEnd, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { RetroColumn, StickyNote, StickyNoteColor, RetroPhase } from '../../interfaces/retrospective.interface';
import { StickyNoteComponent } from '../sticky-note/sticky-note.component';
import { JiraControlModule } from '../../../jira-control/jira-control.module';
import { RetrospectiveService } from '../../state/retrospective.service';
import { RetrospectiveQuery } from '../../state/retrospective.query';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-retro-column',
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
    NzEmptyModule,
    NzToolTipModule,
    NzSwitchModule,
    NzSkeletonModule,
    DragDropModule,
    StickyNoteComponent,
    JiraControlModule
  ],
  templateUrl: './retro-column.component.html',
  styleUrls: ['./retro-column.component.scss']
})
export class RetroColumnComponent {
  @Input() column!: RetroColumn;
  @Input() stickyNotes: StickyNote[] = [];
  @Input() currentUserId: string = '';
  @Input() currentPhase!: RetroPhase;
  @Input() isLoading: boolean = false;
  
  @Output() noteAdd = new EventEmitter<{ columnId: string, content: string, color: StickyNoteColor, isAnonymous: boolean }>();
  @Output() noteChange = new EventEmitter<StickyNote>();
  @Output() noteDelete = new EventEmitter<string>();
  @Output() noteVote = new EventEmitter<string>();
  @Output() noteDrop = new EventEmitter<CdkDragDrop<StickyNote[]>>();

  @ViewChild('notesContainer') notesContainer!: ElementRef;

  isAddNoteModalVisible = false;
  isEditMode = false;
  editingNote: StickyNote | null = null;
  newNoteContent = '';
  selectedColor: StickyNoteColor = StickyNoteColor.YELLOW;
  isAnonymous = false;
  
  isAISummaryExpanded = false;
  isGeneratingSummary = false;
  aiSummary = '';
  
  colorOptions = Object.values(StickyNoteColor);

  constructor(
    private renderer: Renderer2,
    private retrospectiveService: RetrospectiveService,
    private retrospectiveQuery: RetrospectiveQuery,
    private supabaseService: SupabaseService
  ) {}

  getRandomColor(): StickyNoteColor {
    const colors = Object.values(StickyNoteColor);
    const randomIndex = Math.floor(Math.random() * colors.length);
    return colors[randomIndex];
  }

  showAddNoteModal() {
    if (!this.canAddNotes()) {
      return;
    }
    
    this.isEditMode = false;
    this.editingNote = null;
    this.isAddNoteModalVisible = true;
    this.newNoteContent = '';
    this.selectedColor = this.getRandomColor();
    this.isAnonymous = false;
    
    // Focus the textarea after modal opens
    setTimeout(() => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
      }
    }, 100);
  }

  onNoteEdit(note: StickyNote) {
    this.isEditMode = true;
    this.editingNote = note;
    this.isAddNoteModalVisible = true;
    this.newNoteContent = note.content;
    this.selectedColor = note.color;
    
    // Focus the textarea after modal opens
    setTimeout(() => {
      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }, 100);
  }

  addNote() {
    console.log('addNote called, content:', this.newNoteContent);
    console.log('Column ID:', this.column.id);
    console.log('Selected color:', this.selectedColor);
    console.log('Is anonymous:', this.isAnonymous);
    if (this.newNoteContent.trim()) {
      console.log('Emitting noteAdd event');
      this.noteAdd.emit({
        columnId: this.column.id,
        content: this.newNoteContent.trim(),
        color: this.selectedColor,
        isAnonymous: this.isAnonymous
      });
      this.cancelAddNote();
    } else {
      console.log('Content is empty, not adding note');
    }
  }

  saveEditedNote() {
    if (this.editingNote && this.newNoteContent.trim()) {
      const updatedNote: StickyNote = {
        ...this.editingNote,
        content: this.newNoteContent.trim(),
        color: this.selectedColor,
        updatedAt: new Date().toISOString()
      };
      this.noteChange.emit(updatedNote);
      this.cancelAddNote();
    }
  }

  cancelAddNote() {
    this.isAddNoteModalVisible = false;
    this.isEditMode = false;
    this.editingNote = null;
    this.newNoteContent = '';
    this.selectedColor = this.getRandomColor();
    this.isAnonymous = false;
  }

  onNoteChange(note: StickyNote) {
    this.noteChange.emit(note);
  }

  onNoteDelete(noteId: string) {
    this.noteDelete.emit(noteId);
  }

  onNoteVote(noteId: string) {
    this.noteVote.emit(noteId);
  }

  onNoteDrop(event: CdkDragDrop<StickyNote[]>) {
    // Always pass the event to parent - let it handle both same column and cross-column logic
    this.noteDrop.emit(event);
  }

  onDragStarted(event: CdkDragStart) {
    // Scrollbar hiding removed as it might interfere with placeholder rendering
  }

  onDragEnded(event: CdkDragEnd) {
    // Scrollbar restoration removed
  }

  trackByNoteId(index: number, note: StickyNote): string {
    return note.id;
  }

  getColorValue(color: StickyNoteColor): string {
    const colorMap = {
      [StickyNoteColor.YELLOW]: '#fef3c7',
      [StickyNoteColor.GREEN]: '#d1fae5',
      [StickyNoteColor.BLUE]: '#dbeafe',
      [StickyNoteColor.PINK]: '#fce7f3',
      [StickyNoteColor.PURPLE]: '#e7d5fa',
      [StickyNoteColor.ORANGE]: '#fed7aa'
    };
    return colorMap[color] || colorMap[StickyNoteColor.YELLOW];
  }

  canDragNotes(): boolean {
    // Notes can be dragged during brainstorming and grouping phases
    return this.currentPhase === RetroPhase.BRAINSTORMING || 
           this.currentPhase === RetroPhase.GROUPING;
  }

  canAddNotes(): boolean {
    // Strictly disable if completed
    if (this.currentPhase === RetroPhase.COMPLETED) {
      return false;
    }

    if (this.column.id === 'action-items') {
      return this.currentPhase === RetroPhase.DISCUSSION || this.currentPhase === RetroPhase.ACTION_ITEMS;
    }
    // Other notes can only be added during brainstorming phase
    return this.currentPhase === RetroPhase.BRAINSTORMING;
  }

  getAddNoteDisabledMessage(): string {
    if (this.column.id === 'action-items') {
      if (this.currentPhase !== RetroPhase.DISCUSSION && this.currentPhase !== RetroPhase.ACTION_ITEMS) {
        return 'Action items can only be created during Discussion or Action Items phase';
      }
    }
    
    if (this.currentPhase === RetroPhase.GROUPING) {
      return 'Notes cannot be added during grouping phase - only moved and grouped';
    } else if (this.currentPhase === RetroPhase.VOTING) {
      return 'Notes cannot be added during voting phase';
    } else if (this.currentPhase === RetroPhase.DISCUSSION) {
      return 'Notes cannot be added during discussion phase';
    } else if (this.currentPhase === RetroPhase.ACTION_ITEMS) {
      return 'Notes cannot be added during action items phase';
    } else if (this.currentPhase === RetroPhase.COMPLETED) {
      return 'Retrospective is completed - no changes allowed';
    }
    return 'Adding notes not allowed in current phase';
  }

  toggleAISummary() {
    const currentBoard = this.retrospectiveQuery.getCurrentBoard();
    
    // Check if we have cached summary
    if (currentBoard?.aiSummary && currentBoard.aiSummary[this.column.id]) {
      this.aiSummary = currentBoard.aiSummary[this.column.id];
    }

    if (!this.isAISummaryExpanded && !this.aiSummary && !this.isGeneratingSummary) {
      this.generateAISummary();
      return;
    }
    this.isAISummaryExpanded = !this.isAISummaryExpanded;
  }

  async generateAISummary(forceRegenerate = false) {
    if (this.stickyNotes.length === 0 || this.isGeneratingSummary) {
      return;
    }

    const currentBoard = this.retrospectiveQuery.getCurrentBoard();
    if (!currentBoard) return;

    this.isAISummaryExpanded = true;

    // Use cache if not forcing regeneration
    if (!forceRegenerate && currentBoard.aiSummary && currentBoard.aiSummary[this.column.id]) {
      this.aiSummary = currentBoard.aiSummary[this.column.id];
      return;
    }

    this.isGeneratingSummary = true;
    this.aiSummary = '';

    try {
      const noteContents = this.stickyNotes.map(n => n.content);
      
      const { data, error } = await this.supabaseService.client.functions.invoke('generate-ai-summary', {
        body: {
          boardId: currentBoard.id,
          columnId: this.column.id,
          columnTitle: this.column.title,
          notes: noteContents
        }
      });

      if (error) throw error;

      if (data && data.summary) {
        this.aiSummary = data.summary;
        this.retrospectiveService.updateBoardAiSummary(currentBoard.id, this.column.id, data.summary);
      } else {
        this.aiSummary = 'Unable to generate summary.';
      }
    } catch (err) {
      console.error('Failed to generate summary:', err);
      this.aiSummary = 'Error generating summary. Please try again.';
    } finally {
      this.isGeneratingSummary = false;
    }
  }

  regenerateAISummary() {
    this.generateAISummary(true);
  }
}
import { Injectable } from '@angular/core';
import { RetrospectiveStore } from './retrospective.store';
import { RetrospectiveBoard, StickyNote, StickyNoteColor, RetroPhase, RetroColumn } from '../interfaces/retrospective.interface';
import { AuthQuery } from '../../project/auth/auth.query';
import { SupabaseService } from '../../core/services/supabase.service';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ProjectQuery } from '../../project/state/project/project.query';
@Injectable({ providedIn: 'root' })
export class RetrospectiveService {
  private retroItemsChannel: RealtimeChannel | null = null;

  constructor(
    private store: RetrospectiveStore,
    private authQuery: AuthQuery,
    public supabaseService: SupabaseService,
    private projectQuery: ProjectQuery
  ) {}

  async loadBoardsFromSupabase(orgId?: string, teamId?: string) {
    console.log('[RetrospectiveService] loadBoardsFromSupabase called | orgId:', orgId, '| teamId:', teamId);
    this.store.setLoading(true);
    try {
      // Build query to fetch boards with their items' creation times
      let query = this.supabaseService.client
        .from('retro_boards')
        .select(`
          *,
          retro_items (
            created_at,
            user_id
          )
        `);
      
      // If teamId is provided, optionally filter by team
      if (teamId) {
        console.log('[RetrospectiveService] Filtering by team_id:', teamId);
        query = query.eq('team_id', teamId);
      } else if (orgId) {
        // Fallback to searching all boards across org if no team selected
        console.log('[RetrospectiveService] Filtering by org_id:', orgId);
        query = query.eq('org_id', orgId);
      } else {
        console.warn('[RetrospectiveService] No orgId or teamId provided – fetching ALL boards!');
      }

      const { data, error } = await query;
      
      if (error) throw error;

      // Map Supabase rows to Angular models
      const mappedBoards: RetrospectiveBoard[] = (data || []).map((row: any) => {
        // Calculate the latest activity time (max of board updated_at and all notes created_at)
        const noteDates = row.retro_items?.map((item: any) => new Date(item.created_at).getTime()) || [];
        const boardUpdateAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        const boardCreateAt = row.created_at ? new Date(row.created_at).getTime() : 0;
        
        const latestActivityTime = Math.max(boardUpdateAt, boardCreateAt, ...noteDates);
        const finalUpdatedAt = latestActivityTime > 0 ? new Date(latestActivityTime).toISOString() : new Date().toISOString();

        // Accurate unique participants calculation from metadata, creator, and contributors
        const participantIds = new Set<string>();
        if (row.created_by) participantIds.add(row.created_by);
        row.retro_items?.forEach((item: any) => {
          if (item.user_id) participantIds.add(item.user_id);
        });
        row.participants?.forEach((p: string) => {
          if (p) participantIds.add(p);
        });

        return {
          id: row.id,
          title: row.title,
          description: row.description || '',
          facilitatorId: row.created_by || '',
          participants: Array.from(participantIds),
          columns: [],
          stickyNotes: [],
          aiSummary: row.ai_summary || {},
          notesCount: row.retro_items?.length || 0,
          isActive: row.status === 'active',
          currentPhase: this.mapPhaseFromDb(row.current_stage),
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: finalUpdatedAt,
          orgId: row.org_id,
          teamId: row.team_id
        };
      });

      this.store.update(state => ({
        ...state,
        boards: mappedBoards
      }));
    } catch (error) {
      console.error('Error fetching retro boards:', error);
      this.store.setError(error);
    } finally {
      this.store.setLoading(false);
    }
  }

  clearBoards() {
    this.store.update(state => ({
      ...state,
      boards: []
    }));
    this.store.setLoading(false);
  }

  private mapPhaseFromDb(stage: string): RetroPhase {
    switch (stage?.toLowerCase()) {
      case 'brainstorming': return RetroPhase.BRAINSTORMING;
      case 'grouping': return RetroPhase.GROUPING;
      case 'voting': return RetroPhase.VOTING;
      case 'discussion': return RetroPhase.DISCUSSION;
      case 'action points':
      case 'action-items': return RetroPhase.ACTION_ITEMS;
      case 'completed': return RetroPhase.COMPLETED;
      default: return RetroPhase.BRAINSTORMING;
    }
  }

  async createBoard(title: string, description: string, orgId?: string, teamId?: string): Promise<RetrospectiveBoard> {
    const user = this.authQuery.getValue();
    
    try {
      const newInternalBoardObj = {
        title,
        description: description || '',
        status: 'active',
        current_stage: 'Brainstorming',
        created_by: user?.id,
        org_id: orgId || null,
        team_id: teamId || null
      };

      const { data, error } = await this.supabaseService.client
        .from('retro_boards')
        .insert(newInternalBoardObj)
        .select()
        .single();

      if (error) throw error;

      const newBoard: RetrospectiveBoard = {
        id: data.id,
        title: data.title,
        description: data.description || '',
        facilitatorId: data.created_by,
        participants: [data.created_by],
        columns: [],
        stickyNotes: [],
        aiSummary: {},
        notesCount: 0,
        isActive: true,
        currentPhase: RetroPhase.BRAINSTORMING,
        orgId: data.org_id,
        teamId: data.team_id,
        createdAt: data.created_at,
        updatedAt: data.created_at
      };

      this.store.update(state => ({
        ...state,
        currentBoard: newBoard,
        boards: [newBoard, ...state.boards]
      }));

      return newBoard;
    } catch (error) {
      console.error('Error creating board:', error);
      throw error;
    }
  }

  async updateBoardSupabase(boardId: string, updates: Partial<RetrospectiveBoard>): Promise<boolean> {
    try {
      const dbUpdates: any = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.currentPhase !== undefined) dbUpdates.current_stage = this.mapPhaseToDb(updates.currentPhase);
      if (updates.participants !== undefined) dbUpdates.participants = updates.participants;
      
      dbUpdates.updated_at = new Date().toISOString();

      const { error } = await this.supabaseService.client
        .from('retro_boards')
        .update(dbUpdates)
        .eq('id', boardId);

      if (error) throw error;

      this.store.update(state => ({
        ...state,
        boards: state.boards.map(board => 
          board.id === boardId ? { ...board, ...updates, updatedAt: dbUpdates.updated_at } : board
        ),
        currentBoard: state.currentBoard && state.currentBoard.id === boardId 
          ? { ...state.currentBoard, ...updates, updatedAt: dbUpdates.updated_at }
          : state.currentBoard
      }));

      return true;
    } catch (error) {
      console.error('Error updating board in Supabase:', error);
      return false;
    }
  }

  async deleteBoardSupabase(boardId: string): Promise<boolean> {
    try {
      const { error } = await this.supabaseService.client
        .from('retro_boards')
        .delete()
        .eq('id', boardId);

      if (error) throw error;

      this.store.update(state => ({
        ...state,
        boards: state.boards.filter(board => board.id !== boardId),
        currentBoard: state.currentBoard && state.currentBoard.id === boardId ? null : state.currentBoard
      }));

      return true;
    } catch (error) {
      console.error('Error deleting board from Supabase:', error);
      return false;
    }
  }

  private mapPhaseToDb(phase: RetroPhase): string {
    switch (phase) {
      case RetroPhase.BRAINSTORMING: return 'Brainstorming';
      case RetroPhase.GROUPING: return 'Grouping';
      case RetroPhase.VOTING: return 'Voting';
      case RetroPhase.DISCUSSION: return 'Discussion';
      case RetroPhase.ACTION_ITEMS: return 'Action Items';
      case RetroPhase.COMPLETED: return 'Completed';
      default: return 'Brainstorming';
    }
  }

  async loadBoard(boardId: string) {
    // Clear out the current board before fetching the next one
    this.store.update({ currentBoard: null });
    this.store.setLoading(true);
    try {
      const currentState = this.store.getValue();
      const existingBoard = currentState.boards.find(b => b.id === boardId);
      let board = existingBoard ? { ...existingBoard } : null;

      // If board isn't in store (e.g., direct navigation), fetch it
      if (!board) {
        const { data: boardData, error: boardError } = await this.supabaseService.client
          .from('retro_boards')
          .select('*')
          .eq('id', boardId)
          .single();

        if (boardError) throw boardError;
        if (boardData) {
          board = {
            id: boardData.id,
            title: boardData.title,
            description: boardData.description || '',
            facilitatorId: boardData.created_by || '',
            participants: boardData.participants || [boardData.created_by || ''],
            columns: [],
            stickyNotes: [],
            aiSummary: boardData.ai_summary || {},
            isActive: boardData.status === 'active',
            currentPhase: this.mapPhaseFromDb(boardData.current_stage),
            orgId: boardData.org_id,
            teamId: boardData.team_id,
            createdAt: boardData.created_at || new Date().toISOString(),
            updatedAt: boardData.created_at || new Date().toISOString()
          };
        }
      }

      if (!board) return;
      
      // Always ensure we have default columns
      if (!board.columns || board.columns.length === 0) {
        board.columns = [
          {
            id: 'went-well',
            title: 'What went well?',
            description: 'Things that worked well in this sprint',
            color: '#4CAF50',
            position: 1
          },
          {
            id: 'improve',
            title: 'What can be improved?',
            description: 'Things that could be done better',
            color: '#FF9800',
            position: 2
          },
          {
            id: 'action-items',
            title: 'Action Items',
            description: 'Concrete actions for the next sprint',
            color: '#2196F3',
            position: 3
          }
        ];
      }
      
      // Update store with board metadata early so the layout can render
      this.store.update({ currentBoard: board });

      // Fetch items from retro_items and join with profiles
      const { data: itemsData, error: itemsError } = await this.supabaseService.client
        .from('retro_items')
        .select(`
          *,
          profiles:user_id (
            full_name,
            email,
            avatar_url
          )
        `)
        .eq('board_id', boardId);

      if (itemsError) throw itemsError;

      const mapCategoryToColumnId = this.mapCategoryToColumnId.bind(this);

      const mappedNotes: StickyNote[] = (itemsData || []).map((item: any) => {
        // Look up author from in-memory users list OR from the joined profiles data
        const author = this.projectQuery.getValue().users.find(u => u.id === item.user_id);
        const profile = item.profiles;
        
        const fallbackName = profile?.full_name || author?.name || 'User';
        const fallbackAvatar = profile?.avatar_url || author?.avatarUrl || '';

        return {
          id: item.id,
          noteNumber: item.sequence_number || 1,
          content: item.content,
          authorId: item.user_id || '',
          authorName: fallbackName,
          authorAvatar: fallbackAvatar,
          isAnonymous: !!item.is_anonymous,
          columnId: mapCategoryToColumnId(item.category),
          color: item.color_code || StickyNoteColor.YELLOW,
          position: { x: item.position_x || 0, y: item.position_y || 0 },
          votes: item.votes || 0,
          voterIds: item.voter_ids || [],
          tags: item.tags || [],
          groupId: item.group_id || null,
          createdAt: item.created_at || new Date().toISOString(),
          updatedAt: item.updated_at || new Date().toISOString()
        };
      });

      const participantIds = [board.facilitatorId || ''];
      mappedNotes.forEach(note => {
        if (!note.isAnonymous && note.authorId) {
          participantIds.push(note.authorId);
        }
      });

      const updatedBoard = {
        ...board,
        participants: Array.from(new Set(participantIds)),
        stickyNotes: mappedNotes
      };

      this.store.update(state => {
        const boardExists = state.boards.some(b => b.id === boardId);
        return {
          ...state,
          currentBoard: updatedBoard,
          boards: boardExists 
            ? state.boards.map(b => b.id === boardId ? updatedBoard : b)
            : [...state.boards, updatedBoard]
        };
      });

    } catch (error) {
      console.error('Error loading board:', error);
      this.store.setError(error);
    } finally {
      this.store.setLoading(false);
    }
  }

  mapCategoryToColumnId(category: string): string {
    const lower = category?.toLowerCase() || '';
    if (lower.includes('went well')) return 'went-well';
    if (lower.includes('improve')) return 'improve';
    if (lower.includes('action')) return 'action-items';
    // Fallback for demo records or unknown categories
    return 'went-well';
  }

  mapColumnIdToCategory(columnId: string): string {
    if (columnId === 'went-well') return 'What went well';
    if (columnId === 'improve') return 'What can be improved';
    if (columnId === 'action-items') return 'Action Items';
    return 'What went well';
  }

  subscribeToBoard(boardId: string) {
    if (this.retroItemsChannel) {
      this.unsubscribeFromBoard();
    }

    this.retroItemsChannel = this.supabaseService.client
      .channel(`retro_items_${boardId}`)
    // Listen to all changes on the retro_items table for this specific board
    .on(
      'postgres_changes',
      {
        event: '*', 
        schema: 'public', 
        table: 'retro_items',
        filter: `board_id=eq.${boardId}`
      },
      (payload) => {
        this.handleRealtimeEvent(payload);
      }
    )
    .subscribe((status) => {
      console.log('Realtime subscription status:', status);
    });
  }

  unsubscribeFromBoard() {
    if (this.retroItemsChannel) {
      this.supabaseService.client.removeChannel(this.retroItemsChannel);
      this.retroItemsChannel = null;
    }
  }

  private handleRealtimeEvent(payload: any) {
    const currentState = this.store.getValue();
    if (!currentState.currentBoard) return;

    if (payload.eventType === 'INSERT') {
       const newItem = payload.new;
       // Prevent duplicate in state if we created it
       if (currentState.currentBoard.stickyNotes.some(n => n.id === newItem.id)) return;
       
        const author = this.projectQuery.getValue().users.find(u => u.id === newItem.user_id);
        const mappedNote: StickyNote = {
           id: newItem.id,
           noteNumber: newItem.sequence_number || 1,
           content: newItem.content,
           authorId: newItem.user_id || '',
           authorName: newItem.is_anonymous ? 'Anonymous' : (author?.name || 'User'),
           authorAvatar: newItem.is_anonymous ? '' : (author?.avatarUrl || ''),
           isAnonymous: !!newItem.is_anonymous,
           columnId: this.mapCategoryToColumnId(newItem.category),
            color: newItem.color_code || StickyNoteColor.YELLOW,
            position: { x: newItem.position_x || 0, y: newItem.position_y || 0 },
            votes: newItem.votes || 0,
           voterIds: newItem.voter_ids || [],
           tags: newItem.tags || [],
           groupId: newItem.group_id || null,
           createdAt: newItem.created_at,
           updatedAt: newItem.updated_at
        };

        this.store.update(state => {
          // Prevent duplicate if realtime event already added it
          if (state.currentBoard?.stickyNotes.some(n => n.id === mappedNote.id)) {
            return state;
          }

          const currentParticipants = state.currentBoard!.participants || [];
          const updatedParticipants = (!mappedNote.isAnonymous && mappedNote.authorId && !currentParticipants.includes(mappedNote.authorId)) 
            ? [...currentParticipants, mappedNote.authorId] 
            : currentParticipants;

          const updatedBoard = {
            ...state.currentBoard!,
            participants: updatedParticipants,
            stickyNotes: [...state.currentBoard!.stickyNotes, mappedNote],
            notesCount: state.currentBoard!.stickyNotes.length + 1
          };

          return {
            ...state,
            currentBoard: updatedBoard,
            boards: state.boards.map(board => 
              board.id === updatedBoard.id ? updatedBoard : board
            )
          };
        });
    } else if (payload.eventType === 'UPDATE') {
       const updatedItem = payload.new;
       this.store.update(state => ({
         ...state,
         currentBoard: {
            ...state.currentBoard!,
            stickyNotes: state.currentBoard!.stickyNotes.map(note =>
              note.id === updatedItem.id 
                ? { 
                    ...note, 
                    content: updatedItem.content, 
                    columnId: this.mapCategoryToColumnId(updatedItem.category),
                    votes: updatedItem.votes || 0,
                    tags: updatedItem.tags || note.tags,
                    groupId: updatedItem.group_id !== undefined ? updatedItem.group_id : note.groupId,
                    updatedAt: updatedItem.updated_at,
                    noteNumber: updatedItem.sequence_number || note.noteNumber,
                    position: updatedItem.position_x !== undefined ? { x: updatedItem.position_x, y: updatedItem.position_y } : note.position
                  }
                : note
            )
         }
       }));
    } else if (payload.eventType === 'DELETE') {
       const deletedItem = payload.old;
       this.store.update(state => ({
         ...state,
         currentBoard: {
            ...state.currentBoard!,
            stickyNotes: state.currentBoard!.stickyNotes.filter(n => n.id !== deletedItem.id),
            notesCount: Math.max(0, state.currentBoard!.stickyNotes.length - 1)
         }
       }));
    }
  }

  async addStickyNote(columnId: string, content: string, color: StickyNoteColor = StickyNoteColor.YELLOW, isAnonymous: boolean = false): Promise<void> {
    console.log('addStickyNote called with:', { columnId, content, color, isAnonymous });
    const user = this.authQuery.getValue();
    const currentState = this.store.getValue();
    
    console.log('User from auth:', user);
    console.log('Current board:', currentState.currentBoard);
    
    if (!currentState.currentBoard || !user) {
      console.error('Missing current board or user');
      return;
    }

    const category = this.mapColumnIdToCategory(columnId);

    // Calculate next note number based on existing notes
    const maxNoteNumber = currentState.currentBoard.stickyNotes.reduce((max, note) => {
      return Math.max(max, note.noteNumber || 0);
    }, 0);
    const nextNoteNumber = maxNoteNumber + 1;

    const newRetroItem = {
      board_id: currentState.currentBoard.id,
      user_id: user.id,
      content,
      category,
      sequence_number: nextNoteNumber,
      is_anonymous: isAnonymous,
      color_code: color, // If applicable, might be text hex
      tags: [],
      group_id: null
    };

    try {
      const { data, error } = await this.supabaseService.client
        .from('retro_items')
        .insert(newRetroItem)
        .select()
        .single();

      if (error) throw error;
      
      const newNote: StickyNote = {
        id: data.id,
        noteNumber: data.sequence_number || nextNoteNumber,
        content: data.content,
        authorId: data.user_id || '',
        authorName: user.name,
        authorAvatar: user.avatarUrl,
        isAnonymous: isAnonymous,
        columnId: this.mapCategoryToColumnId(data.category),
        color,
        position: { x: 0, y: 0 },
        votes: data.votes || 0,
        voterIds: [],
        tags: [],
        groupId: null,
        createdAt: data.created_at,
        updatedAt: data.updated_at
      };

      console.log('Created new note:', newNote);

      this.store.update(state => {
        // Prevent duplicate if realtime event already added it
        if (state.currentBoard?.stickyNotes.some(n => n.id === newNote.id)) {
          console.log('Note already exists in store, skipping optimistic update');
          return state;
        }

        const updatedBoard = {
          ...state.currentBoard!,
          stickyNotes: [...state.currentBoard!.stickyNotes, newNote],
          notesCount: state.currentBoard!.stickyNotes.length + 1,
          updatedAt: new Date().toISOString()
        };

        return {
          ...state,
          currentBoard: updatedBoard,
          boards: state.boards.map(board => 
            board.id === updatedBoard.id ? updatedBoard : board
          )
        };
      });

      console.log('Store updated successfully');
    } catch (error) {
      console.error('Error adding sticky note to Supabase:', error);
    }
  }

  async updateStickyNote(noteId: string, updates: Partial<StickyNote>): Promise<void> {
    return this.updateStickyNoteBatch([{ id: noteId, updates }]);
  }

  async updateStickyNoteBatch(updates: Array<{ id: string, updates: Partial<StickyNote> }>): Promise<void> {
    const currentState = this.store.getValue();
    if (!currentState.currentBoard) return;

    // 1. Optimistically update local state in one go
    const updatedStickyNotes = currentState.currentBoard.stickyNotes.map(note => {
      const update = updates.find(u => u.id === note.id);
      if (update) {
        return { ...note, ...update.updates, updatedAt: new Date().toISOString() };
      }
      return note;
    });

    const updatedBoard = {
      ...currentState.currentBoard,
      stickyNotes: updatedStickyNotes,
      updatedAt: new Date().toISOString()
    };

    this.store.update(state => ({
      ...state,
      currentBoard: updatedBoard,
      boards: state.boards.map(board => 
        board.id === updatedBoard.id ? updatedBoard : board
      )
    }));

    // 2. Perform DB updates (individual calls since retro_items doesn't have a RPC for batch update yet, 
    // but the store emission is now just once)
    const dbUpdatePromises = updates.map(async ({ id, updates: noteUpdates }) => {
      const dbUpdates: any = {};
      if (noteUpdates.content !== undefined) dbUpdates.content = noteUpdates.content;
      if (noteUpdates.columnId !== undefined) dbUpdates.category = this.mapColumnIdToCategory(noteUpdates.columnId);
      if (noteUpdates.votes !== undefined) dbUpdates.votes = noteUpdates.votes;
      if (noteUpdates.voterIds !== undefined) dbUpdates.voter_ids = noteUpdates.voterIds;
      if (noteUpdates.tags !== undefined) dbUpdates.tags = noteUpdates.tags;
      if (noteUpdates.groupId !== undefined) dbUpdates.group_id = noteUpdates.groupId;
      if (noteUpdates.position !== undefined) {
        dbUpdates.position_x = noteUpdates.position.x;
        dbUpdates.position_y = noteUpdates.position.y;
      }

      if (Object.keys(dbUpdates).length > 0) {
        return this.supabaseService.client
          .from('retro_items')
          .update(dbUpdates)
          .eq('id', id);
      }
      return Promise.resolve({ error: null });
    });

    try {
      await Promise.all(dbUpdatePromises);
    } catch (error) {
      console.error('Error in batch updating sticky notes:', error);
    }
  }

  async deleteStickyNote(noteId: string): Promise<void> {
    const currentState = this.store.getValue();
    
    if (!currentState.currentBoard) return;

    // Optimistic delete
    const updatedBoard = {
      ...currentState.currentBoard,
      stickyNotes: currentState.currentBoard.stickyNotes.filter(note => note.id !== noteId),
      updatedAt: new Date().toISOString()
    };

    this.store.update(state => ({
      ...state,
      currentBoard: updatedBoard,
      boards: state.boards.map(board => 
        board.id === updatedBoard.id ? updatedBoard : board
      )
    }));

    try {
      await this.supabaseService.client
        .from('retro_items')
        .delete()
        .eq('id', noteId);
    } catch (error) {
       console.error('Error deleting sticky note:', error);
    }
  }

  async voteOnStickyNote(noteId: string): Promise<void> {
    const user = this.authQuery.getValue();
    if (!user) return;

    const currentState = this.store.getValue();
    if (!currentState.currentBoard) return;

    const note = currentState.currentBoard.stickyNotes.find(n => n.id === noteId);
    if (!note) return;

    const hasVoted = note.voterIds.includes(user.id);
    const updatedNote = hasVoted 
      ? {
          ...note,
          votes: Math.max(0, (note.votes || 0) - 1),
          // We don't persist voterIds directly via this model in Supabase atm but we keep it in state
          voterIds: note.voterIds.filter(id => id !== user.id)
        }
      : {
          ...note,
          votes: (note.votes || 0) + 1,
          voterIds: [...(note.voterIds || []), user.id]
        };

    await this.updateStickyNote(noteId, { votes: updatedNote.votes, voterIds: updatedNote.voterIds });
  }

  async updatePhase(phase: RetroPhase): Promise<void> {
    const currentState = this.store.getValue();
    
    if (!currentState.currentBoard) return;

    const updates: Partial<RetrospectiveBoard> = { currentPhase: phase };

    // If moving to completed, also save the current participants list
    if (phase === RetroPhase.COMPLETED) {
      updates.participants = currentState.currentBoard.participants || [];
    }

    await this.updateBoardSupabase(currentState.currentBoard.id, updates);
  }

  async updateBoardAiSummary(boardId: string, columnId: string, summary: string): Promise<void> {
    const currentState = this.store.getValue();
    const board = currentState.boards.find(b => b.id === boardId);
    if (!board) return;

    const newAiSummary = {
      ...(board.aiSummary || {}),
      [columnId]: summary
    };

    // Optimistically update local store
    this.store.update(state => ({
      ...state,
      boards: state.boards.map(b => 
        b.id === boardId ? { ...b, aiSummary: newAiSummary } : b
      ),
      currentBoard: state.currentBoard && state.currentBoard.id === boardId 
        ? { ...state.currentBoard, aiSummary: newAiSummary }
        : state.currentBoard
    }));

    // Save to Supabase
    try {
      await this.supabaseService.client
        .from('retro_boards')
        .update({ ai_summary: newAiSummary })
        .eq('id', boardId);
    } catch (error) {
      console.error('Error updating ai_summary in Supabase:', error);
    }
  }

  private createDemoBoard(): void {
    const user = this.authQuery.getValue();
    const currentState = this.store.getValue();
    
    // Remove any existing demo boards first to prevent duplicates
    const boardsWithoutDemo = currentState.boards.filter(board => board.id !== 'demo');
    
    const demoBoard: RetrospectiveBoard = {
      id: 'demo',
      title: 'Sprint 23 Retrospective',
      description: 'Team retrospective for Sprint 23 - Q4 2025',
      facilitatorId: user?.id || 'demo-user',
      participants: [user?.id || 'demo-user'],
      columns: [
        {
          id: 'went-well',
          title: 'What went well?',
          description: 'Things that worked well in this sprint',
          color: '#4CAF50',
          position: 1
        },
        {
          id: 'improve',
          title: 'What can be improved?',
          description: 'Things that could be done better',
          color: '#FF9800',
          position: 2
        },
        {
          id: 'action-items',
          title: 'Action Items',
          description: 'Concrete actions for the next sprint',
          color: '#2196F3',
          position: 3
        }
      ],
      stickyNotes: [
        {
          id: 'note-1',
          noteNumber: 1,
          content: 'Great team collaboration on the login feature',
          authorId: user?.id || 'demo-user',
          authorName: user?.name || 'Demo User',
          authorAvatar: user?.avatarUrl,
          isAnonymous: false,
          columnId: 'went-well',
          color: StickyNoteColor.GREEN,
          position: { x: 10, y: 10 },
          votes: 3,
          voterIds: ['user-1', 'user-2', 'user-3'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'note-2',
          noteNumber: 2,
          content: 'Need better communication during code reviews',
          authorId: user?.id || 'demo-user',
          authorName: user?.name || 'Demo User',
          authorAvatar: user?.avatarUrl,
          isAnonymous: false,
          columnId: 'improve',
          color: StickyNoteColor.ORANGE,
          position: { x: 10, y: 10 },
          votes: 1,
          voterIds: ['user-1'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      isActive: true,
      currentPhase: RetroPhase.BRAINSTORMING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.store.update(state => ({
      ...state,
      currentBoard: demoBoard,
      boards: [...boardsWithoutDemo, demoBoard]
    }));
  }

  updateNotePosition(noteId: string, position: { x: number; y: number }, newColumnId?: string): void {
    const currentState = this.store.getValue();
    
    if (!currentState.currentBoard) return;

    const updates: Partial<StickyNote> = {
      position,
      updatedAt: new Date().toISOString()
    };

    if (newColumnId) {
      updates.columnId = newColumnId;
    }

    this.updateStickyNote(noteId, updates); // Will sync category if newColumnId is provided
  }

  updateNotesOrder(columnId: string, noteIds: string[]): void {
    const currentState = this.store.getValue();
    
    if (!currentState.currentBoard) return;

    const updatedNotes = currentState.currentBoard.stickyNotes.map(note => {
      if (note.columnId === columnId) {
        const orderIndex = noteIds.indexOf(note.id);
        if (orderIndex !== -1) {
          return {
            ...note,
            position: {
              ...note.position,
              y: orderIndex * 120 + 10 // Space notes vertically
            },
            noteNumber: orderIndex + 1, // Store as sort order basically
            updatedAt: new Date().toISOString()
          };
        }
      }
      return note;
    });

    const updatedBoard = {
      ...currentState.currentBoard,
      stickyNotes: updatedNotes,
      updatedAt: new Date().toISOString()
    };

    this.store.update(state => ({
      ...state,
      currentBoard: updatedBoard,
      boards: state.boards.map(board => 
        board.id === updatedBoard.id ? updatedBoard : board
      )
    }));
    
    // In a production app, batch update sequence numbers to Supabase
    // for this feature since it's an array update.
    // For now we assume realtime features primarily cover add/update/delete.
  }

  moveNoteBetweenColumns(noteId: string, fromColumnId: string, toColumnId: string, position: { x: number; y: number }): void {
    const currentState = this.store.getValue();
    
    if (!currentState.currentBoard) return;

    const note = currentState.currentBoard.stickyNotes.find(n => n.id === noteId);
    if (!note || note.columnId !== fromColumnId) return;

    this.updateNotePosition(noteId, position, toColumnId);
  }

  async getRetroItemsForBoards(boardIds: string[]) {
    if (!boardIds || boardIds.length === 0) return [];
    
    try {
      const { data, error } = await this.supabaseService.client
        .from('retro_items')
        .select('id, board_id, user_id, voter_ids')
        .in('board_id', boardIds);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching retro items for boards:', error);
      return [];
    }
  }

  async getTotalRetroBoardsCount(): Promise<number> {
    try {
      const { count, error } = await this.supabaseService.client
        .from('retro_boards')
        .select('*', { count: 'exact', head: true });
      
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('[RetrospectiveService] getTotalRetroBoardsCount failed:', error);
      return 0;
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async getUserRetroStats(userId: string) {
    try {
      // 1. Fetch board participation from multiple sources for an accurate count
      const [
        { data: mbBoards }, // Memberships
        { data: cbBoards }, // Created by
        { data: noteItems }, // Contributed notes
        { data: voteItems }  // Cast votes
      ] = await Promise.all([
        this.supabaseService.client.from('retro_boards').select('id').contains('participants', [userId]),
        this.supabaseService.client.from('retro_boards').select('id').eq('created_by', userId),
        this.supabaseService.client.from('retro_items').select('board_id, category').eq('user_id', userId),
        this.supabaseService.client.from('retro_items').select('board_id').contains('voter_ids', [userId])
      ]);

      const uniqueBoardIds = new Set<string>();
      mbBoards?.forEach(b => uniqueBoardIds.add(b.id));
      cbBoards?.forEach(b => uniqueBoardIds.add(b.id));
      noteItems?.forEach(i => uniqueBoardIds.add(i.board_id));
      voteItems?.forEach(i => uniqueBoardIds.add(i.board_id));

      const retrosJoined = uniqueBoardIds.size;

      // 2. Aggregate counts from fetched note items
      const notesAdded = noteItems?.filter(item => item.category !== 'Action Items').length || 0;
      const actionItems = noteItems?.filter(item => item.category === 'Action Items').length || 0;

      // 3. Fetch total votes cast count
      const { count: votesCast, error: votesError } = await this.supabaseService.client
        .from('retro_items')
        .select('*', { count: 'exact', head: true })
        .contains('voter_ids', [userId]);

      if (votesError) throw votesError;

      // Calculate category distribution
      const categoryDistribution = {
        'What went well': noteItems?.filter(item => item.category === 'What went well').length || 0,
        'What can be improved': noteItems?.filter(item => item.category === 'What can be improved').length || 0,
        'Action Items': actionItems
      };

      return {
        retrosJoined: retrosJoined || 0,
        notesAdded,
        votesCast: votesCast || 0,
        actionItems,
        categoryDistribution
      };
    } catch (error) {
      console.error('Error fetching user retro stats:', error);
      return null;
    }
  }

  async getUserActivityHistory(userId: string) {
    try {
      // 1. Fetch recent notes
      const { data: notes, error: notesError } = await this.supabaseService.client
        .from('retro_items')
        .select('content, category, created_at, board_id, retro_boards(title)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (notesError) throw notesError;

      // 2. Fetch recent votes
      const { data: votes, error: votesError } = await this.supabaseService.client
        .from('retro_items')
        .select('content, created_at, board_id, retro_boards(title)')
        .contains('voter_ids', [userId])
        .order('created_at', { ascending: false })
        .limit(10);

      if (votesError) throw votesError;

      // Merge and sort
      const history = [
        ...(notes || []).map(n => ({
          type: 'added_note',
          content: n.content,
          category: n.category,
          target: (n as any).retro_boards?.title || 'Unknown Retro',
          boardId: n.board_id,
          date: n.created_at
        })),
        ...(votes || []).map(v => ({
          type: 'voted',
          content: `Voted on 3 notes`, // Simulated text for now
          target: (v as any).retro_boards?.title || 'Unknown Retro',
          boardId: v.board_id,
          date: v.created_at
        }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return history.slice(0, 10);
    } catch (error) {
      console.error('Error fetching user activity history:', error);
      return [];
    }
  }
}
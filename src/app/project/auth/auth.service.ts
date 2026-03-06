import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthStore } from './auth.store';
import { SupabaseService } from '../../core/services/supabase.service';
import { LoginPayload } from '@trungk18/project/auth/loginPayload';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(
    private _http: HttpClient,
    private _store: AuthStore,
    private supabaseService: SupabaseService
  ) {
    // Listen for auth state changes to keep store in sync
    this.supabaseService.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        this.updateStoreFromUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        // Implement store reset if needed
      }
    });
  }

  async login({ email = '', password = '' }: LoginPayload) {
    this._store.setLoading(true);
    try {
      const { data, error } = await this.supabaseService.client.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        this.updateStoreFromUser(data.user);
      }
    } catch (err: any) {
      this._store.setError(err);
      throw err;
    } finally {
      this._store.setLoading(false);
    }
  }

  private updateStoreFromUser(user: any) {
    this._store.update(state => ({
      ...state,
      id: user.id || state.id,
      email: user.email || state.email,
      name: user.user_metadata?.name || user.email?.split('@')[0] || state.name,
      avatarUrl: user.user_metadata?.avatarUrl || state.avatarUrl
    }));
  }
}



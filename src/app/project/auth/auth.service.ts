import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthStore } from './auth.store';
import { SupabaseService } from '../../core/services/supabase.service';
import { LoginPayload } from '@trungk18/project/auth/loginPayload';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthService {
  constructor(
    private _http: HttpClient,
    private _store: AuthStore,
    private supabaseService: SupabaseService,
    private _router: Router
  ) {
    // Listen for auth state changes to keep store in sync
    this.supabaseService.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        this.updateStoreFromUser(session.user);
        
        // Proactively navigate to organization if we are on the login page or root
        // This is especially helpful for OAuth redirects that land on the root of the app
        const currentUrl = this._router.url;
        if (currentUrl.includes('/login') || currentUrl === '/' || currentUrl === '/#/') {
          this._router.navigate(['/organization']);
        }
      } else if (event === 'SIGNED_OUT') {
        this._store.update((state) => ({
          ...state,
          id: undefined,
          email: undefined,
          name: undefined,
          avatarUrl: undefined,
          token: undefined
        }));
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

  async logout() {
    try {
      const { error } = await this.supabaseService.client.auth.signOut();
      if (error) {
        throw error;
      }
      this._store.update((state) => ({
        ...state,
        id: undefined,
        email: undefined,
        name: undefined,
        avatarUrl: undefined,
        token: undefined
      }));
      this._router.navigate(['/login']);
    } catch (err: any) {
      console.error('Logout error:', err);
      throw err;
    }
  }

  private updateStoreFromUser(user: any) {
    this._store.update(state => ({
      ...state,
      id: user.id || state.id,
      email: user.email || state.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || state.name,
      avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.avatarUrl || state.avatarUrl
    }));
  }
}



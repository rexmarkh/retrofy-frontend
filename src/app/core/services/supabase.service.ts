import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SupabaseService {
  private supabase: SupabaseClient;
  private sessionPromise: Promise<any> | null = null;
  private userPromise: Promise<any> | null = null;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
      auth: {
        flowType: 'pkce'
      }
    });
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  /**
   * Safe way to get session without triggering NavigatorLockAcquireTimeoutError
   * by ensuring we don't call auth methods redundantly in parallel.
   */
  async getSession() {
    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = this.supabase.auth.getSession();
    try {
      return await this.sessionPromise;
    } finally {
      this.clearAuthPromises();
    }
  }

  /**
   * Safe way to get user without triggering NavigatorLockAcquireTimeoutError.
   */
  async getUser() {
    if (this.userPromise) {
      return this.userPromise;
    }

    this.userPromise = this.supabase.auth.getUser();
    try {
      return await this.userPromise;
    } finally {
      this.clearAuthPromises();
    }
  }

  private clearAuthPromises() {
    // Clear promises after a short delay to bridge the "initialization burst"
    setTimeout(() => {
      this.sessionPromise = null;
      this.userPromise = null;
    }, 1000);
  }
}

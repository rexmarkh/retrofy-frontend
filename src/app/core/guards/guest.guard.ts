import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { map, from, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class GuestGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService, private router: Router) {}

  canActivate(): Observable<boolean | UrlTree> {
    return from(this.supabaseService.getSession()).pipe(
      map(({ data: { session } }) => {
        if (session) {
          return this.router.createUrlTree(['/organization']);
        } else {
          return true;
        }
      })
    );
  }
}

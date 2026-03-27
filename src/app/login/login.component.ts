import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { AuthService } from '../project/auth/auth.service';
import { AuthQuery } from '../project/auth/auth.query';
import { SupabaseService } from '../core/services/supabase.service';
import { environment } from '../../environments/environment';

@UntilDestroy()
@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  standalone: false
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  loading = false;
  error: string | null = null;
  passwordVisible = false;
  isSignUpMode = false;

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private authService: AuthService,
    private authQuery: AuthQuery,
    private supabaseService: SupabaseService
  ) {
    this.loginForm = this.fb.group({
      fullName: [''],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['']
    }, { validators: this.passwordMatchValidator });
  }

  passwordMatchValidator(form: AbstractControl): ValidationErrors | null {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    if (!password || !confirmPassword) return null;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  ngOnInit(): void {
    
    // Check local session storage first for immediate redirect
    const refreshToken = sessionStorage.getItem('refresh_token');
    if (refreshToken) {
      this.router.navigate(['/organization']);
      return;
    }

    // Check actual Supabase session
    this.supabaseService.getSession().then(({ data: { session } }) => {
      if (session) {
        if (session.refresh_token) {
          sessionStorage.setItem('refresh_token', session.refresh_token);
        }
        this.router.navigate(['/organization']);
      }
    });

    // Check if user is already authenticated via state
    this.authQuery.user$.pipe(untilDestroyed(this)).subscribe(user => {
      if (user && user.id) {
        // User is already logged in, redirect to organization
        this.router.navigate(['/organization']);
      }
    });
  }

  toggleMode(): void {
    this.isSignUpMode = !this.isSignUpMode;
    this.error = null;
    
    const fullNameControl = this.loginForm.get('fullName');
    const confirmPasswordControl = this.loginForm.get('confirmPassword');

    if (this.isSignUpMode) {
      fullNameControl?.setValidators([Validators.required]);
      confirmPasswordControl?.setValidators([Validators.required]);
    } else {
      fullNameControl?.clearValidators();
      confirmPasswordControl?.clearValidators();
    }
    
    fullNameControl?.updateValueAndValidity();
    confirmPasswordControl?.updateValueAndValidity();
  }

  async onSubmit(): Promise<void> {
    if (this.loginForm.valid) {
      this.loading = true;
      this.error = null;

      try {
        const { email, password, fullName } = this.loginForm.value;
        
        let result;
        if (this.isSignUpMode) {
          result = await this.authService.signUp(email, password, fullName);
        } else {
          // Call Supabase auth to sign in
          const { data, error } = await this.supabaseService.client.auth.signInWithPassword({
            email,
            password
          });
          
          if (error) {
            throw error;
          }
          result = data;
        }

        if (result?.session?.refresh_token) {
          sessionStorage.setItem('refresh_token', result.session.refresh_token);
        }
        
        // On successful login, redirect to organization
        this.router.navigate(['/organization']);
        
      } catch (error: any) {
        this.error = error.message || `${this.isSignUpMode ? 'Sign up' : 'Login'} failed. Please try again.`;
        console.error(`${this.isSignUpMode ? 'Sign up' : 'Login'} error:`, error);
      } finally {
        this.loading = false;
      }
    } else {
      this.markFormGroupTouched();
    }
  }

  async onGoogleSignIn(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const { data, error } = await this.supabaseService.client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${environment.appDomainUrl}`
        }
      });

      if (error) {
        throw error;
      }
      
    } catch (error: any) {
      this.error = error.message || 'Google Sign-In failed. Please try again.';
      console.error('Google Sign-In error:', error);
    } finally {
      this.loading = false;
    }
  }

  async onGitHubSignIn(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      // For demo purposes, use a GitHub OAuth email
      const githubEmail = 'user@github.com';
      
      // Call the auth service with GitHub email
      this.authService.login({ email: githubEmail, password: 'oauth' });
      
      // Wait for authentication to complete
      await new Promise(resolve => {
        this.authQuery.user$.pipe(untilDestroyed(this)).subscribe(user => {
          if (user && user.id) {
            resolve(user);
          }
        });
      });
      
      // On successful login, redirect to organization
      this.router.navigate(['/organization']);
      
    } catch (error: any) {
      this.error = error.message || 'GitHub Sign-In failed. Please try again.';
      console.error('GitHub Sign-In error:', error);
    } finally {
      this.loading = false;
    }
  }

  togglePasswordVisibility(): void {
    this.passwordVisible = !this.passwordVisible;
  }

  onForgotPassword(): void {
    // TODO: Implement forgot password functionality
    console.log('Forgot password clicked');
  }

  onCreateAccount(): void {
    this.toggleMode();
  }

  private markFormGroupTouched(): void {
    Object.keys(this.loginForm.controls).forEach(key => {
      const control = this.loginForm.get(key);
      control?.markAsTouched();
    });
  }

  // Form validation getters
  get fullName() {
    return this.loginForm.get('fullName');
  }

  get email() { 
    return this.loginForm.get('email'); 
  }

  get password() { 
    return this.loginForm.get('password'); 
  }

  get confirmPassword() {
    return this.loginForm.get('confirmPassword');
  }

  get isFullNameInvalid(): boolean {
    const control = this.loginForm.get('fullName');
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  get fullNameErrorMessage(): string {
    const control = this.loginForm.get('fullName');
    if (control?.hasError('required')) return 'Full name is required';
    return '';
  }

  get isEmailInvalid(): boolean {
    const control = this.loginForm.get('email');
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  get emailErrorMessage(): string {
    const control = this.loginForm.get('email');
    if (control?.hasError('required')) return 'Email is required';
    if (control?.hasError('email')) return 'Please enter a valid email address';
    return '';
  }

  get isPasswordInvalid(): boolean {
    const control = this.loginForm.get('password');
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  get passwordErrorMessage(): string {
    const control = this.loginForm.get('password');
    if (control?.hasError('required')) return 'Password is required';
    if (control?.hasError('minlength')) return 'Password must be at least 6 characters';
    return '';
  }

  get isConfirmPasswordInvalid(): boolean {
    const control = this.loginForm.get('confirmPassword');
    const isDirty = control?.dirty || control?.touched;
    const hasMismatch = this.loginForm.hasError('passwordMismatch') && isDirty;
    const isRequiredMissing = control?.hasError('required') && isDirty;
    return !!(this.isSignUpMode && (isRequiredMissing || hasMismatch));
  }

  get confirmPasswordErrorMessage(): string {
    const control = this.loginForm.get('confirmPassword');
    if (control?.hasError('required')) return 'Please confirm your password';
    if (this.loginForm.hasError('passwordMismatch')) return 'Passwords do not match';
    return '';
  }
}
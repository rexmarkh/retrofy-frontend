import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { GuestGuard } from './core/guards/guest.guard';

const routes: Routes = [
  {
    path: 'login',
    canActivate: [GuestGuard],
    loadChildren: () => import('./login/login.module').then((m) => m.LoginModule)
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'organization'
  },
  {
    path: '',
    canActivate: [AuthGuard],
    loadChildren: () => import('./project/project.module').then((m) => m.ProjectModule)
  },
  {
    path: 'organization',
    canActivate: [AuthGuard],
    loadChildren: () => import('./organization/organization.module').then(m => m.OrganizationModule)
  },
  {
    path: 'wip',
    canActivate: [AuthGuard],
    loadChildren: () =>
      import('./work-in-progress/work-in-progress.module').then(
        (m) => m.WorkInProgressModule
      )
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule]
})
export class AppRoutingModule {}

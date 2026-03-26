import { OrganizationRole } from '../../organization/interfaces/organization.interface';

export enum Permission {
  CREATE_ORG = 'CREATE_ORG',
  BILLING = 'BILLING',
  CREATE_TEAM = 'CREATE_TEAM',
  INVITE_USERS = 'INVITE_USERS',
  MANAGE_RETROS = 'MANAGE_RETROS',
  PARTICIPATE = 'PARTICIPATE',
  UPDATE_RETRO_PHASE = 'UPDATE_RETRO_PHASE'
}

export const ROLE_PERMISSIONS: Record<OrganizationRole, Permission[]> = {
  [OrganizationRole.OWNER]: [
    Permission.CREATE_ORG,
    Permission.BILLING,
    Permission.CREATE_TEAM,
    Permission.INVITE_USERS,
    Permission.MANAGE_RETROS,
    Permission.PARTICIPATE,
    Permission.UPDATE_RETRO_PHASE
  ],
  [OrganizationRole.ADMIN]: [
    Permission.CREATE_ORG,
    Permission.CREATE_TEAM,
    Permission.INVITE_USERS,
    Permission.MANAGE_RETROS,
    Permission.PARTICIPATE,
    Permission.UPDATE_RETRO_PHASE
  ],
  [OrganizationRole.MEMBER]: [
    Permission.CREATE_ORG,
    Permission.PARTICIPATE
  ]
};

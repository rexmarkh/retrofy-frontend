export interface JUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  designation?: string;
  createdAt: string;
  updatedAt: string;
  issueIds: string[];
}

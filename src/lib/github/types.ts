export type GitHubAccountType = 'user' | 'organization';

export interface GitHubAuthenticatedUser {
  id: string;
  login: string;
}

export interface GitHubInstallation {
  id: string;
  account: {
    id: string;
    login: string;
    type: GitHubAccountType;
  };
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  suspendedAt: string | null;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
}

export interface GitHubRepository {
  id: string;
  nodeId: string | null;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
}

export interface GitHubCommit {
  sha: string;
  treeSha: string;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size: number | null;
}

export interface GitHubTree {
  sha: string;
  truncated: boolean;
  entries: GitHubTreeEntry[];
}

export interface GitHubBlob {
  sha: string;
  size: number;
  encoding: 'base64';
  content: string;
}

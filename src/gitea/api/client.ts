/**
 * Lightweight Gitea REST-only API client.
 *
 * Gitea does **not** support GraphQL, so every call uses the v1 REST API.
 * The surface is intentionally kept small – only the methods actually used by
 * the action are implemented.
 */

import { GITEA_API_URL } from "./config";
import { retryWithBackoff } from "../../utils/retry";

export type GiteaClientOptions = {
  token: string;
  baseUrl?: string;
};

export class GiteaClient {
  private token: string;
  private baseUrl: string;

  constructor(opts: GiteaClientOptions) {
    this.token = opts.token;
    // Strip trailing slash
    this.baseUrl = (opts.baseUrl || GITEA_API_URL).replace(/\/+$/, "");
  }

  // ------------------------------------------------------------------
  // Low-level helpers
  // ------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `token ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const res = await retryWithBackoff(async () => {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Gitea API ${method} ${path} failed: ${response.status} ${response.statusText} – ${text}`,
        );
      }

      // 204 No Content
      if (response.status === 204) return {} as T;
      return (await response.json()) as T;
    });

    return res;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  // ------------------------------------------------------------------
  // Repository
  // ------------------------------------------------------------------

  async getRepo(owner: string, repo: string) {
    return this.get<GiteaRepository>(`/repos/${owner}/${repo}`);
  }

  async getBranch(owner: string, repo: string, branch: string) {
    return this.get<GiteaBranch>(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    );
  }

  // ------------------------------------------------------------------
  // Issues
  // ------------------------------------------------------------------

  async getIssue(owner: string, repo: string, index: number) {
    return this.get<GiteaIssue>(`/repos/${owner}/${repo}/issues/${index}`);
  }

  async getIssueComments(owner: string, repo: string, index: number) {
    return this.get<GiteaComment[]>(
      `/repos/${owner}/${repo}/issues/${index}/comments`,
    );
  }

  async createIssueComment(
    owner: string,
    repo: string,
    index: number,
    body: string,
  ) {
    return this.post<GiteaComment>(
      `/repos/${owner}/${repo}/issues/${index}/comments`,
      { body },
    );
  }

  async updateIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ) {
    return this.patch<GiteaComment>(
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      { body },
    );
  }

  // ------------------------------------------------------------------
  // Pull Requests
  // ------------------------------------------------------------------

  async getPullRequest(owner: string, repo: string, index: number) {
    return this.get<GiteaPullRequest>(`/repos/${owner}/${repo}/pulls/${index}`);
  }

  async getPullRequestFiles(owner: string, repo: string, index: number) {
    return this.get<GiteaChangedFile[]>(
      `/repos/${owner}/${repo}/pulls/${index}/files`,
    );
  }

  async getPullRequestReviews(owner: string, repo: string, index: number) {
    return this.get<GiteaReview[]>(
      `/repos/${owner}/${repo}/pulls/${index}/reviews`,
    );
  }

  async getPullRequestReviewComments(
    owner: string,
    repo: string,
    index: number,
    reviewId: number,
  ) {
    return this.get<GiteaReviewComment[]>(
      `/repos/${owner}/${repo}/pulls/${index}/reviews/${reviewId}/comments`,
    );
  }

  async createPullReviewComment(
    owner: string,
    repo: string,
    index: number,
    body: string,
  ) {
    // Gitea uses the issue comment endpoint for PR general comments
    return this.createIssueComment(owner, repo, index, body);
  }

  // ------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------

  async getUser(username: string) {
    return this.get<GiteaUser>(`/users/${username}`);
  }

  // ------------------------------------------------------------------
  // Collaborators / Permissions
  // ------------------------------------------------------------------

  async getRepoPermission(owner: string, repo: string, username: string) {
    return this.get<{ permission: string }>(
      `/repos/${owner}/${repo}/collaborators/${username}/permission`,
    );
  }

  // ------------------------------------------------------------------
  // Git references
  // ------------------------------------------------------------------

  async getGitRef(owner: string, repo: string, ref: string) {
    return this.get<GiteaReference>(
      `/repos/${owner}/${repo}/git/refs/${encodeURIComponent(ref)}`,
    );
  }
}

// ------------------------------------------------------------------
// Response types (subset of Gitea API)
// ------------------------------------------------------------------

export type GiteaRepository = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string; id: number };
};

export type GiteaBranch = {
  name: string;
  commit: { id: string; message: string };
};

export type GiteaUser = {
  id: number;
  login: string;
  full_name: string;
  is_admin: boolean;
};

export type GiteaLabel = {
  id: number;
  name: string;
  color: string;
};

export type GiteaIssue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; id: number };
  labels: GiteaLabel[];
  pull_request?: { merged: boolean } | null;
};

export type GiteaComment = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: { login: string; id: number };
  html_url: string;
};

export type GiteaPullRequest = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  created_at: string;
  updated_at: string;
  user: { login: string; id: number };
  head: { ref: string; sha: string; label: string };
  base: { ref: string; sha: string; label: string };
  labels: GiteaLabel[];
  additions: number;
  deletions: number;
  changed_files: number;
};

export type GiteaChangedFile = {
  filename: string;
  status: string; // "added" | "removed" | "modified" | "renamed"
  additions: number;
  deletions: number;
  previous_filename?: string;
};

export type GiteaReview = {
  id: number;
  body: string;
  state: string; // "APPROVED" | "REQUEST_CHANGES" | "COMMENT" | "PENDING"
  submitted_at: string;
  user: { login: string; id: number };
};

export type GiteaReviewComment = {
  id: number;
  body: string;
  path: string;
  line: number | null;
  created_at: string;
  updated_at: string;
  user: { login: string; id: number };
};

export type GiteaReference = {
  ref: string;
  object: { sha: string; type: string };
};

export function createGiteaClient(token: string): GiteaClient {
  return new GiteaClient({ token });
}

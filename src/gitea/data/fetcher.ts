/**
 * Fetch PR / Issue data from Gitea REST API.
 *
 * This replaces the GraphQL-based fetcher used for GitHub.  The returned
 * data is normalised into the same shape (GitHubPullRequest / GitHubIssue)
 * so the downstream prompt-building code works unchanged.
 */

import { execFileSync } from "child_process";
import type { GiteaClient } from "../api/client";
import type {
  GitHubComment,
  GitHubFile,
  GitHubIssue,
  GitHubPullRequest,
  GitHubReview,
} from "../../github/types";
import type { GitHubFileWithSHA } from "../../github/data/fetcher";
import {
  filterCommentsToTriggerTime,
  filterReviewsToTriggerTime,
  filterCommentsByActor,
} from "../../github/data/fetcher";

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

export type GiteaFetchDataParams = {
  client: GiteaClient;
  owner: string;
  repo: string;
  entityNumber: number;
  isPR: boolean;
  triggerUsername?: string;
  triggerTime?: string;
  originalTitle?: string;
  originalBody?: string | null;
  includeCommentsByActor?: string;
  excludeCommentsByActor?: string;
};

export type GiteaFetchDataResult = {
  contextData: GitHubPullRequest | GitHubIssue;
  comments: GitHubComment[];
  changedFiles: GitHubFile[];
  changedFilesWithSHA: GitHubFileWithSHA[];
  reviewData: { nodes: GitHubReview[] } | null;
  imageUrlMap: Map<string, string>;
  triggerDisplayName?: string | null;
};

export async function fetchGiteaData(
  params: GiteaFetchDataParams,
): Promise<GiteaFetchDataResult> {
  const {
    client,
    owner,
    repo,
    entityNumber,
    isPR,
    triggerUsername,
    triggerTime,
    originalTitle,
    originalBody,
    includeCommentsByActor,
    excludeCommentsByActor,
  } = params;

  let contextData: GitHubPullRequest | GitHubIssue;
  let comments: GitHubComment[] = [];
  let changedFiles: GitHubFile[] = [];
  let reviewData: { nodes: GitHubReview[] } | null = null;

  try {
    if (isPR) {
      const pr = await client.getPullRequest(owner, repo, entityNumber);
      const files = await client.getPullRequestFiles(owner, repo, entityNumber);
      const rawComments = await client.getIssueComments(
        owner,
        repo,
        entityNumber,
      );

      // Map to normalised PR shape
      const normalisedPR: GitHubPullRequest = {
        title: pr.title,
        body: pr.body || "",
        author: { login: pr.user.login },
        baseRefName: pr.base.ref,
        headRefName: pr.head.ref,
        headRefOid: pr.head.sha,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        additions: pr.additions,
        deletions: pr.deletions,
        state: pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
        labels: { nodes: (pr.labels || []).map((l) => ({ name: l.name })) },
        commits: { totalCount: 0, nodes: [] }, // Gitea doesn't return commit list in PR endpoint
        files: {
          nodes: files.map((f) => ({
            path: f.filename,
            additions: f.additions,
            deletions: f.deletions,
            changeType: mapFileStatus(f.status),
          })),
        },
        comments: {
          nodes: rawComments.map(mapComment),
        },
        reviews: { nodes: [] },
      };

      // Fetch reviews
      try {
        const reviews = await client.getPullRequestReviews(
          owner,
          repo,
          entityNumber,
        );

        const normalisedReviews: GitHubReview[] = await Promise.all(
          reviews.map(async (r) => {
            let reviewComments: GitHubComment[] = [];
            try {
              const rc = await client.getPullRequestReviewComments(
                owner,
                repo,
                entityNumber,
                r.id,
              );
              reviewComments = rc.map((c) => ({
                id: String(c.id),
                databaseId: String(c.id),
                body: c.body,
                author: { login: c.user.login },
                createdAt: c.created_at,
                updatedAt: c.updated_at,
                path: c.path,
                line: c.line,
              })) as unknown as GitHubComment[];
            } catch {
              // Review comment fetch may fail; continue
            }

            return {
              id: String(r.id),
              databaseId: String(r.id),
              author: { login: r.user.login },
              body: r.body || "",
              state: r.state,
              submittedAt: r.submitted_at,
              comments: { nodes: reviewComments as any },
            } as GitHubReview;
          }),
        );

        normalisedPR.reviews = { nodes: normalisedReviews };
        reviewData = { nodes: normalisedReviews };
      } catch {
        // Reviews are optional
      }

      contextData = normalisedPR;
      changedFiles = normalisedPR.files.nodes;

      comments = filterCommentsByActor(
        filterCommentsToTriggerTime(normalisedPR.comments.nodes, triggerTime),
        includeCommentsByActor,
        excludeCommentsByActor,
      );

      console.log(`Successfully fetched PR #${entityNumber} data from Gitea`);
    } else {
      // Fetch issue
      const issue = await client.getIssue(owner, repo, entityNumber);
      const rawComments = await client.getIssueComments(
        owner,
        repo,
        entityNumber,
      );

      const normalisedIssue: GitHubIssue = {
        title: issue.title,
        body: issue.body || "",
        author: { login: issue.user.login },
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        state: issue.state === "closed" ? "CLOSED" : "OPEN",
        labels: { nodes: (issue.labels || []).map((l) => ({ name: l.name })) },
        comments: {
          nodes: rawComments.map(mapComment),
        },
      };

      contextData = normalisedIssue;

      comments = filterCommentsByActor(
        filterCommentsToTriggerTime(
          normalisedIssue.comments.nodes,
          triggerTime,
        ),
        includeCommentsByActor,
        excludeCommentsByActor,
      );

      console.log(
        `Successfully fetched issue #${entityNumber} data from Gitea`,
      );
    }
  } catch (error) {
    console.error(
      `Failed to fetch ${isPR ? "PR" : "issue"} data from Gitea:`,
      error,
    );
    throw new Error(`Failed to fetch ${isPR ? "PR" : "issue"} data from Gitea`);
  }

  // Compute SHAs for changed files
  let changedFilesWithSHA: GitHubFileWithSHA[] = [];
  if (isPR && changedFiles.length > 0) {
    changedFilesWithSHA = changedFiles.map((file) => {
      if (file.changeType === "DELETED") {
        return { ...file, sha: "deleted" };
      }
      try {
        const sha = execFileSync("git", ["hash-object", file.path], {
          encoding: "utf-8",
        }).trim();
        return { ...file, sha };
      } catch {
        return { ...file, sha: "unknown" };
      }
    });
  }

  // Apply TOCTOU protection
  if (originalBody !== undefined) {
    contextData.body = originalBody ?? "";
  }

  if (originalTitle !== undefined) {
    contextData.title = originalTitle;
  }

  // Filter review data
  if (reviewData?.nodes) {
    reviewData.nodes = filterCommentsByActor(
      filterReviewsToTriggerTime(reviewData.nodes, triggerTime),
      includeCommentsByActor,
      excludeCommentsByActor,
    );
  }

  // Fetch trigger display name
  let triggerDisplayName: string | null | undefined;
  if (triggerUsername) {
    try {
      const user = await client.getUser(triggerUsername);
      triggerDisplayName = user.full_name || null;
    } catch {
      triggerDisplayName = null;
    }
  }

  return {
    contextData,
    comments,
    changedFiles,
    changedFilesWithSHA,
    reviewData,
    imageUrlMap: new Map(), // Image download not yet supported for Gitea
    triggerDisplayName,
  };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function mapComment(c: {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
}): GitHubComment {
  return {
    id: String(c.id),
    databaseId: String(c.id),
    body: c.body,
    author: { login: c.user.login },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function mapFileStatus(status: string): string {
  switch (status) {
    case "added":
      return "ADDED";
    case "removed":
      return "DELETED";
    case "modified":
      return "MODIFIED";
    case "renamed":
      return "RENAMED";
    default:
      return status.toUpperCase();
  }
}

/**
 * Shared types used across the Gitea integration.
 *
 * These mirror the GitHub equivalents in src/github/types.ts but are mapped
 * from Gitea REST API responses so the downstream prompt-building code can
 * stay largely unchanged.
 */

export type {
  GitHubAuthor as GiteaAuthor,
  GitHubComment as GiteaCommentData,
  GitHubReviewComment as GiteaReviewCommentData,
  GitHubCommit as GiteaCommitData,
  GitHubFile as GiteaFileData,
  GitHubReview as GiteaReviewData,
  GitHubPullRequest as GiteaPullRequestData,
  GitHubIssue as GiteaIssueData,
} from "../github/types";

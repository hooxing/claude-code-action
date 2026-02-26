/**
 * Parse the Gitea Actions webhook context.
 *
 * Gitea Actions is designed to be largely compatible with GitHub Actions.
 * It sets the same GITHUB_* environment variables and uses a compatible
 * event payload structure.  Where differences exist (e.g. event names or
 * payload fields) we normalise them to the types already used by the rest
 * of the action code.
 */

import * as github from "@actions/github";
import type {
  IssuesEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
} from "@octokit/webhooks-types";
import { GITEA_DEFAULT_BOT_ID, GITEA_DEFAULT_BOT_NAME } from "./constants";

// Re-export the same context shape so callers do not need to care about
// the platform.
export type {
  ParsedGitHubContext as ParsedGiteaContext,
  AutomationContext as GiteaAutomationContext,
  GitHubContext as GiteaContext,
} from "../github/context";

import type {
  ParsedGitHubContext,
  AutomationContext,
  GitHubContext,
} from "../github/context";

/**
 * Parse Gitea Actions context.
 *
 * Because Gitea Actions mimics the GitHub Actions environment we can reuse
 * @actions/github to read the event payload.  We only override defaults
 * (bot ID / name) when the user has not configured them explicitly.
 */
export function parseGiteaContext(): GitHubContext {
  const context = github.context;

  const commonFields = {
    runId: process.env.GITHUB_RUN_ID || "0",
    eventAction: context.payload.action as string | undefined,
    repository: {
      owner: context.repo.owner,
      repo: context.repo.repo,
      full_name: `${context.repo.owner}/${context.repo.repo}`,
    },
    actor: context.actor,
    inputs: {
      prompt: process.env.PROMPT || "",
      triggerPhrase: process.env.TRIGGER_PHRASE ?? "@claude",
      assigneeTrigger: process.env.ASSIGNEE_TRIGGER ?? "",
      labelTrigger: process.env.LABEL_TRIGGER ?? "",
      baseBranch: process.env.BASE_BRANCH,
      branchPrefix: process.env.BRANCH_PREFIX ?? "claude/",
      branchNameTemplate: process.env.BRANCH_NAME_TEMPLATE,
      useStickyComment: process.env.USE_STICKY_COMMENT === "true",
      useCommitSigning: false, // Gitea does not support API-based commit signing the same way
      sshSigningKey: process.env.SSH_SIGNING_KEY || "",
      botId: process.env.BOT_ID ?? String(GITEA_DEFAULT_BOT_ID),
      botName: process.env.BOT_NAME ?? GITEA_DEFAULT_BOT_NAME,
      allowedBots: process.env.ALLOWED_BOTS ?? "",
      allowedNonWriteUsers: process.env.ALLOWED_NON_WRITE_USERS ?? "",
      trackProgress: process.env.TRACK_PROGRESS === "true",
      includeFixLinks: process.env.INCLUDE_FIX_LINKS === "true",
      includeCommentsByActor: process.env.INCLUDE_COMMENTS_BY_ACTOR ?? "",
      excludeCommentsByActor: process.env.EXCLUDE_COMMENTS_BY_ACTOR ?? "",
    },
  };

  // Gitea Actions dispatches the same event names as GitHub Actions.
  switch (context.eventName) {
    case "issues": {
      const payload = context.payload as IssuesEvent;
      return {
        ...commonFields,
        eventName: "issues",
        payload,
        entityNumber: payload.issue.number,
        isPR: false,
      } as ParsedGitHubContext;
    }
    case "issue_comment": {
      const payload = context.payload as IssueCommentEvent;
      return {
        ...commonFields,
        eventName: "issue_comment",
        payload,
        entityNumber: payload.issue.number,
        isPR: Boolean(payload.issue.pull_request),
      } as ParsedGitHubContext;
    }
    case "pull_request":
    case "pull_request_target": {
      const payload = context.payload as PullRequestEvent;
      return {
        ...commonFields,
        eventName: "pull_request",
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      } as ParsedGitHubContext;
    }
    case "pull_request_review": {
      const payload = context.payload as PullRequestReviewEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review",
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      } as ParsedGitHubContext;
    }
    case "pull_request_review_comment": {
      const payload = context.payload as PullRequestReviewCommentEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review_comment",
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      } as ParsedGitHubContext;
    }
    case "workflow_dispatch": {
      return {
        ...commonFields,
        eventName: "workflow_dispatch",
        payload: context.payload as unknown,
      } as AutomationContext;
    }
    case "repository_dispatch": {
      return {
        ...commonFields,
        eventName: "repository_dispatch",
        payload: context.payload as unknown,
      } as AutomationContext;
    }
    case "schedule": {
      return {
        ...commonFields,
        eventName: "schedule",
        payload: context.payload as unknown,
      } as AutomationContext;
    }
    default:
      throw new Error(`Unsupported Gitea event type: ${context.eventName}`);
  }
}

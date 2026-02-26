/**
 * Create the initial tracking comment on Gitea when Claude Code starts working.
 */

import { appendFileSync } from "fs";
import { createGiteaJobRunLink, createGiteaCommentBody } from "./common";
import type { ParsedGitHubContext } from "../../../github/context";
import type { GiteaClient } from "../../api/client";

export async function createGiteaInitialComment(
  client: GiteaClient,
  context: ParsedGitHubContext,
) {
  const { owner, repo } = context.repository;

  const jobRunLink = createGiteaJobRunLink(owner, repo, context.runId);
  const initialBody = createGiteaCommentBody(jobRunLink);

  try {
    // Gitea uses the same issue comment API for both issues and PRs
    const response = await client.createIssueComment(
      owner,
      repo,
      context.entityNumber,
      initialBody,
    );

    // Output the comment ID for downstream steps
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      appendFileSync(githubOutput, `claude_comment_id=${response.id}\n`);
    }
    console.log(`✅ Created initial Gitea comment with ID: ${response.id}`);
    return response;
  } catch (error) {
    console.error("Error creating initial Gitea comment:", error);
    throw error;
  }
}

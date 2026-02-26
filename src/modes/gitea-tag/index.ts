/**
 * Prepares tag mode for Gitea.
 *
 * Mirrors src/modes/tag/index.ts but uses Gitea API calls.
 */

import { checkGiteaHumanActor } from "../../gitea/validation/actor";
import { createGiteaInitialComment } from "../../gitea/operations/comments/create-initial";
import { setupGiteaBranch } from "../../gitea/operations/branch";
import {
  configureGiteaGitAuth,
  setupGiteaSshSigning,
} from "../../gitea/operations/git-config";
import { prepareGiteaMcpConfig } from "../../gitea/mcp/install-mcp-server";
import { fetchGiteaData } from "../../gitea/data/fetcher";
import {
  extractTriggerTimestamp,
  extractOriginalTitle,
  extractOriginalBody,
} from "../../github/data/fetcher";
import { createPrompt } from "../../create-prompt";
import { isEntityContext } from "../../github/context";
import type { GitHubContext } from "../../github/context";
import type { GiteaClient } from "../../gitea/api/client";
import { parseAllowedTools } from "../agent/parse-tools";

export async function prepareGiteaTagMode({
  context,
  client,
  giteaToken,
}: {
  context: GitHubContext;
  client: GiteaClient;
  giteaToken: string;
}) {
  if (!isEntityContext(context)) {
    throw new Error("Tag mode requires entity context");
  }

  // Check if actor is human
  await checkGiteaHumanActor(client, context);

  // Create initial tracking comment
  const commentData = await createGiteaInitialComment(client, context);
  const commentId = commentData.id;

  const triggerTime = extractTriggerTimestamp(context);
  const originalTitle = extractOriginalTitle(context);
  const originalBody = extractOriginalBody(context);

  const giteaData = await fetchGiteaData({
    client,
    owner: context.repository.owner,
    repo: context.repository.repo,
    entityNumber: context.entityNumber,
    isPR: context.isPR,
    triggerUsername: context.actor,
    triggerTime,
    originalTitle,
    originalBody,
    includeCommentsByActor: context.inputs.includeCommentsByActor,
    excludeCommentsByActor: context.inputs.excludeCommentsByActor,
  });

  // Setup branch
  const branchInfo = await setupGiteaBranch(client, giteaData, context);

  // Configure git authentication
  const useSshSigning = !!context.inputs.sshSigningKey;

  if (useSshSigning) {
    await setupGiteaSshSigning(context.inputs.sshSigningKey);
  }

  const user = {
    login: context.inputs.botName,
    id: parseInt(context.inputs.botId),
  };

  try {
    await configureGiteaGitAuth(giteaToken, context, user);
  } catch (error) {
    console.error("Failed to configure Gitea git authentication:", error);
    throw error;
  }

  // Create prompt file
  await createPrompt(
    commentId,
    branchInfo.baseBranch,
    branchInfo.claudeBranch,
    giteaData,
    context,
  );

  const userClaudeArgs = process.env.CLAUDE_ARGS || "";
  const userAllowedMCPTools = parseAllowedTools(userClaudeArgs).filter((tool) =>
    tool.startsWith("mcp__gitea_"),
  );

  // Build allowed tools for tag mode
  const tagModeTools = [
    "Edit",
    "MultiEdit",
    "Glob",
    "Grep",
    "LS",
    "Read",
    "Write",
    "mcp__gitea_comment__update_claude_comment",
    ...userAllowedMCPTools,
    // Git commands (Gitea doesn't support API-based commit signing)
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git push:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git rm:*)",
  ];

  // Get MCP config
  const ourMcpConfig = await prepareGiteaMcpConfig({
    giteaToken,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: branchInfo.claudeBranch || branchInfo.currentBranch,
    baseBranch: branchInfo.baseBranch,
    claudeCommentId: commentId.toString(),
    allowedTools: Array.from(new Set(tagModeTools)),
    mode: "tag",
    context,
  });

  let claudeArgs = "";
  const escapedOurConfig = ourMcpConfig.replace(/'/g, "'\\''");
  claudeArgs = `--mcp-config '${escapedOurConfig}'`;
  claudeArgs += ` --allowedTools "${tagModeTools.join(",")}"`;

  if (userClaudeArgs) {
    claudeArgs += ` ${userClaudeArgs}`;
  }

  return {
    commentId,
    branchInfo,
    mcpConfig: ourMcpConfig,
    claudeArgs: claudeArgs.trim(),
  };
}

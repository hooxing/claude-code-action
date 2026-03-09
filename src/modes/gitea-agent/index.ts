/**
 * Prepares agent mode for Gitea.
 *
 * Mirrors src/modes/agent/index.ts but uses Gitea API calls.
 */

import { mkdir, writeFile } from "fs/promises";
import { prepareGiteaMcpConfig } from "../../gitea/mcp/install-mcp-server";
import { parseAllowedTools } from "../agent/parse-tools";
import {
  configureGiteaGitAuth,
  setupGiteaSshSigning,
} from "../../gitea/operations/git-config";
import { checkGiteaHumanActor } from "../../gitea/validation/actor";
import { setupGiteaBranch } from "../../gitea/operations/branch";
import { fetchGiteaData } from "../../gitea/data/fetcher";
import {
  extractTriggerTimestamp,
  extractOriginalTitle,
  extractOriginalBody,
} from "../../github/data/fetcher";
import { isEntityContext, isPullRequestEvent } from "../../github/context";
import type { GitHubContext } from "../../github/context";
import type { GiteaClient } from "../../gitea/api/client";

export async function prepareGiteaAgentMode({
  context,
  client,
  giteaToken,
}: {
  context: GitHubContext;
  client: GiteaClient;
  giteaToken: string;
}) {
  // Check if actor is human
  await checkGiteaHumanActor(client, context);

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
    // Continue anyway
  }

  // Create prompt directory
  await mkdir(`${process.env.RUNNER_TEMP || "/tmp"}/claude-prompts`, {
    recursive: true,
  });

  let baseBranch =
    process.env.BASE_BRANCH || context.inputs.baseBranch || "main";
  let claudeBranch: string | undefined = process.env.CLAUDE_BRANCH || undefined;
  let currentBranch =
    claudeBranch ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    baseBranch;

  // For PR events in agent mode (e.g., automatic PR review),
  // we must checkout the PR branch so Claude can see the actual changes.
  let prContextInfo = "";
  if (isEntityContext(context) && isPullRequestEvent(context)) {
    try {
      console.log("[Gitea Agent] PR event detected — fetching PR data and checking out PR branch...");

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

      // Setup (checkout) the PR branch
      const branchInfo = await setupGiteaBranch(client, giteaData, context);
      baseBranch = branchInfo.baseBranch;
      claudeBranch = branchInfo.claudeBranch;
      currentBranch = branchInfo.currentBranch;

      // Build context info to prepend to the prompt
      const prTitle = giteaData.contextData?.title ?? "";
      const prBody = giteaData.contextData?.body ?? "No description provided.";
      const prNumber = context.entityNumber;
      prContextInfo = `
<pr_context>
Repository: ${context.repository.owner}/${context.repository.repo}
PR Number: ${prNumber}
PR Title: ${prTitle}
Base Branch: ${baseBranch}
Head Branch: ${currentBranch}

To view changes in this PR, use:
  git diff origin/${baseBranch}...HEAD
  git log origin/${baseBranch}..HEAD

PR Description:
${prBody}
</pr_context>

`;
      console.log(`[Gitea Agent] Checked out PR branch: ${currentBranch} (base: ${baseBranch})`);
    } catch (error) {
      console.error("[Gitea Agent] Failed to checkout PR branch:", error);
      // Continue with default branch — do not abort
    }
  }

  // Build prompt: prepend PR context (if any) then the user's custom prompt
  const userPrompt =
    context.inputs.prompt ||
    `Repository: ${context.repository.owner}/${context.repository.repo}`;
  const promptContent = prContextInfo + userPrompt;

  await writeFile(
    `${process.env.RUNNER_TEMP || "/tmp"}/claude-prompts/claude-prompt.txt`,
    promptContent,
  );

  // Parse allowed tools
  const userClaudeArgs = process.env.CLAUDE_ARGS || "";
  const allowedTools = parseAllowedTools(userClaudeArgs);

  // Get MCP config
  const ourMcpConfig = await prepareGiteaMcpConfig({
    giteaToken,
    owner: context.repository.owner,
    repo: context.repository.repo,
    branch: currentBranch,
    baseBranch,
    claudeCommentId: undefined,
    allowedTools,
    mode: "agent",
    context,
  });

  let claudeArgs = "";
  const ourConfig = JSON.parse(ourMcpConfig);
  if (ourConfig.mcpServers && Object.keys(ourConfig.mcpServers).length > 0) {
    const escapedOurConfig = ourMcpConfig.replace(/'/g, "'\\''");
    claudeArgs = `--mcp-config '${escapedOurConfig}'`;
  }

  claudeArgs = `${claudeArgs} ${userClaudeArgs}`.trim();

  return {
    commentId: undefined,
    branchInfo: {
      baseBranch,
      currentBranch,
      claudeBranch,
    },
    mcpConfig: ourMcpConfig,
    claudeArgs,
  };
}

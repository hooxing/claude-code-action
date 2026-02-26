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

  // Write the prompt file
  const promptContent =
    context.inputs.prompt ||
    `Repository: ${context.repository.owner}/${context.repository.repo}`;

  await writeFile(
    `${process.env.RUNNER_TEMP || "/tmp"}/claude-prompts/claude-prompt.txt`,
    promptContent,
  );

  // Parse allowed tools
  const userClaudeArgs = process.env.CLAUDE_ARGS || "";
  const allowedTools = parseAllowedTools(userClaudeArgs);

  const claudeBranch = process.env.CLAUDE_BRANCH || undefined;
  const baseBranch =
    process.env.BASE_BRANCH || context.inputs.baseBranch || "main";
  const currentBranch =
    claudeBranch ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    "main";

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
      currentBranch: baseBranch,
      claudeBranch,
    },
    mcpConfig: ourMcpConfig,
    claudeArgs,
  };
}

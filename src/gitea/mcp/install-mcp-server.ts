/**
 * Prepare MCP server configuration for Gitea.
 *
 * A slimmed-down version of src/mcp/install-mcp-server.ts that only
 * includes the Gitea comment server (no CI / file-ops / inline-comment
 * servers for now since Gitea Actions does not have an equivalent API).
 */

import { GITEA_API_URL } from "../api/config";
import type { GitHubContext } from "../../github/context";
import { isEntityContext } from "../../github/context";
import type { AutoDetectedMode } from "../../modes/detector";

type PrepareGiteaMcpConfigParams = {
  giteaToken: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  claudeCommentId?: string;
  allowedTools: string[];
  mode: AutoDetectedMode;
  context: GitHubContext;
};

export async function prepareGiteaMcpConfig(
  params: PrepareGiteaMcpConfigParams,
): Promise<string> {
  const {
    giteaToken,
    owner,
    repo,
    claudeCommentId,
    allowedTools,
    context,
    mode,
  } = params;

  const allowedToolsList = allowedTools || [];
  const isAgentMode = mode === "agent";

  const hasGiteaCommentTools = allowedToolsList.some((tool) =>
    tool.startsWith("mcp__gitea_comment__"),
  );

  const baseMcpConfig: { mcpServers: Record<string, unknown> } = {
    mcpServers: {},
  };

  // Include comment server in tag mode always, or with explicit tools in agent mode
  const shouldIncludeCommentServer = !isAgentMode || hasGiteaCommentTools;

  if (shouldIncludeCommentServer && isEntityContext(context)) {
    baseMcpConfig.mcpServers.gitea_comment = {
      command: "bun",
      args: [
        "run",
        `${process.env.GITHUB_ACTION_PATH}/src/gitea/mcp/gitea-comment-server.ts`,
      ],
      env: {
        GITHUB_TOKEN: giteaToken,
        GITEA_TOKEN: giteaToken,
        REPO_OWNER: owner,
        REPO_NAME: repo,
        ...(claudeCommentId && { CLAUDE_COMMENT_ID: claudeCommentId }),
        GITEA_API_URL: GITEA_API_URL,
        GITHUB_API_URL: GITEA_API_URL,
      },
    };
  }

  return JSON.stringify(baseMcpConfig, null, 2);
}

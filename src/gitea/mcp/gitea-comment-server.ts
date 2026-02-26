/**
 * Gitea Comment MCP Server
 *
 * Provides Claude with the ability to update tracking comments on Gitea.
 * This is the Gitea equivalent of src/mcp/github-comment-server.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GiteaClient } from "../api/client";
import { updateGiteaComment } from "../operations/comments/update-claude-comment";

const server = new McpServer({
  name: "gitea_comment",
  version: "1.0.0",
});

const giteaToken = process.env.GITHUB_TOKEN || process.env.GITEA_TOKEN || "";
const repoOwner = process.env.REPO_OWNER || "";
const repoName = process.env.REPO_NAME || "";
const claudeCommentId = process.env.CLAUDE_COMMENT_ID
  ? parseInt(process.env.CLAUDE_COMMENT_ID)
  : undefined;

const client = new GiteaClient({
  token: giteaToken,
  baseUrl: process.env.GITEA_API_URL || process.env.GITHUB_API_URL,
});

server.tool(
  "update_claude_comment",
  "Update the Claude tracking comment on the issue or PR",
  {
    body: z.string().describe("The new body content for the comment"),
  },
  async ({ body }) => {
    if (!claudeCommentId) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tracking comment ID available",
          },
        ],
      };
    }

    try {
      const result = await updateGiteaComment(client, {
        owner: repoOwner,
        repo: repoName,
        commentId: claudeCommentId,
        body,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Comment updated successfully: ${result.html_url}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to update comment: ${error}`,
          },
        ],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

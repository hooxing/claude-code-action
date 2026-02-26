/**
 * Check if the actor has write permissions to the Gitea repository.
 */

import * as core from "@actions/core";
import type { GiteaClient } from "../api/client";
import type { ParsedGitHubContext } from "../../github/context";

export async function checkGiteaWritePermissions(
  client: GiteaClient,
  context: ParsedGitHubContext,
  allowedNonWriteUsers?: string,
  giteaTokenProvided?: boolean,
): Promise<boolean> {
  const { repository, actor } = context;

  try {
    core.info(`Checking Gitea permissions for actor: ${actor}`);

    // Check if we should bypass permission checks
    if (allowedNonWriteUsers && giteaTokenProvided) {
      const allowedUsers = allowedNonWriteUsers.trim();
      if (allowedUsers === "*") {
        core.warning(
          `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users='*'.`,
        );
        return true;
      }
      const allowedUserList = allowedUsers
        .split(",")
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      if (allowedUserList.includes(actor)) {
        core.warning(
          `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users configuration.`,
        );
        return true;
      }
    }

    // Gitea: check collaborator permission
    const result = await client.getRepoPermission(
      repository.owner,
      repository.repo,
      actor,
    );

    const permissionLevel = result.permission;
    core.info(`Gitea permission level: ${permissionLevel}`);

    if (
      permissionLevel === "admin" ||
      permissionLevel === "owner" ||
      permissionLevel === "write"
    ) {
      core.info(`Actor has write access: ${permissionLevel}`);
      return true;
    }

    core.warning(`Actor has insufficient permissions: ${permissionLevel}`);
    return false;
  } catch (error) {
    core.error(`Failed to check Gitea permissions: ${error}`);
    throw new Error(`Failed to check Gitea permissions for ${actor}: ${error}`);
  }
}

/**
 * Configure git authentication for Gitea.
 */

import { $ } from "bun";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { GitHubContext } from "../../github/context";
import { GITEA_SERVER_URL } from "../api/config";

function getWorkspaceCwd(): string {
  return process.env.GITHUB_WORKSPACE || process.cwd();
}

const SSH_SIGNING_KEY_PATH = join(homedir(), ".ssh", "claude_signing_key");

type GitUser = {
  login: string;
  id: number;
};

export async function configureGiteaGitAuth(
  giteaToken: string,
  context: GitHubContext,
  user: GitUser,
) {
  console.log("Configuring git authentication for Gitea");

  const serverUrl = new URL(GITEA_SERVER_URL);

  // Configure git user
  const botName = user.login;
  const botId = user.id;
  const cwd = getWorkspaceCwd();
  console.log(`Setting git user as ${botName}...`);
  await $({ cwd })`git config user.name "${botName}"`;
  await $({ cwd })`git config user.email "${botId}+${botName}@noreply.${serverUrl.hostname}"`;
  console.log(`✓ Set git user as ${botName}`);

  // Remove any existing auth headers
  try {
    await $({ cwd })`git config --unset-all http.${GITEA_SERVER_URL}/.extraheader`;
    console.log("✓ Removed existing authentication headers");
  } catch {
    console.log("No existing authentication headers to remove");
  }

  // Update remote URL with token auth, preserving the server's original protocol (http or https)
  const protocol = serverUrl.protocol; // e.g. "http:" or "https:"
  const remoteUrl = `${protocol}//x-access-token:${giteaToken}@${serverUrl.host}/${context.repository.owner}/${context.repository.repo}.git`;
  await $({ cwd })`git remote set-url origin ${remoteUrl}`;
  console.log("✓ Updated remote URL with Gitea authentication token");

  console.log("Gitea git authentication configured successfully");
}

/**
 * Configure git to use SSH signing for commits (same as GitHub version)
 */
export async function setupGiteaSshSigning(
  sshSigningKey: string,
): Promise<void> {
  console.log("Configuring SSH signing for commits...");

  if (!sshSigningKey.trim()) {
    throw new Error("SSH signing key cannot be empty");
  }
  if (
    !sshSigningKey.includes("BEGIN") ||
    !sshSigningKey.includes("PRIVATE KEY")
  ) {
    throw new Error("Invalid SSH private key format");
  }

  const sshDir = join(homedir(), ".ssh");
  await mkdir(sshDir, { recursive: true, mode: 0o700 });

  const normalizedKey = sshSigningKey.endsWith("\n")
    ? sshSigningKey
    : sshSigningKey + "\n";

  await writeFile(SSH_SIGNING_KEY_PATH, normalizedKey, { mode: 0o600 });
  console.log(`✓ SSH signing key written to ${SSH_SIGNING_KEY_PATH}`);

  await $`git config gpg.format ssh`;
  await $`git config user.signingkey ${SSH_SIGNING_KEY_PATH}`;
  await $`git config commit.gpgsign true`;

  console.log("✓ Git configured to use SSH signing for commits");
}

export async function cleanupGiteaSshSigning(): Promise<void> {
  try {
    await rm(SSH_SIGNING_KEY_PATH, { force: true });
    console.log("✓ SSH signing key cleaned up");
  } catch {
    console.log("No SSH signing key to clean up");
  }
}

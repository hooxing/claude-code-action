/**
 * Gitea token setup.
 *
 * On Gitea there is no OIDC-based App token exchange.  Authentication is
 * done via a Personal Access Token (PAT) or OAuth2 token passed directly
 * via the `gitea_token` (or `github_token`) input.
 */

export async function setupGiteaToken(): Promise<string> {
  // 1. Explicit Gitea token
  const giteaToken = process.env.GITEA_TOKEN;
  if (giteaToken) {
    console.log("Using GITEA_TOKEN for authentication");
    return giteaToken;
  }

  // 2. Fall back to the override GitHub token input (same env var name for
  //    compatibility with Gitea Actions)
  const overrideToken = process.env.OVERRIDE_GITHUB_TOKEN;
  if (overrideToken) {
    console.log(
      "Using provided GITHUB_TOKEN override for Gitea authentication",
    );
    return overrideToken;
  }

  // 3. Fall back to the default workflow token that Gitea Actions injects
  const workflowToken = process.env.GITHUB_TOKEN;
  if (workflowToken) {
    console.log("Using default workflow GITHUB_TOKEN for Gitea authentication");
    return workflowToken;
  }

  throw new Error(
    "No authentication token found. " +
      "Set the `gitea_token` input or provide GITEA_TOKEN / GITHUB_TOKEN environment variable.",
  );
}

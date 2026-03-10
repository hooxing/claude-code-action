/**
 * Branch operations for Gitea.
 *
 * Mirrors src/github/operations/branch.ts but uses the Gitea REST API
 * for branch lookups.
 */

import { execFileSync } from "child_process";
import type { ParsedGitHubContext } from "../../github/context";
import type { GitHubPullRequest } from "../../github/types";
import type { GiteaClient } from "../api/client";
import type { GiteaFetchDataResult } from "../data/fetcher";
import { validateBranchName } from "../../github/operations/branch";
import { generateBranchName } from "../../utils/branch-template";

function extractFirstLabel(
  giteaData: GiteaFetchDataResult,
): string | undefined {
  const labels = giteaData.contextData.labels?.nodes;
  return labels && labels.length > 0 ? labels[0]?.name : undefined;
}

function execGit(args: string[]): void {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  execFileSync("git", args, { stdio: "inherit", cwd });
}

export type BranchInfo = {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
};

export async function setupGiteaBranch(
  client: GiteaClient,
  giteaData: GiteaFetchDataResult,
  context: ParsedGitHubContext,
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const { baseBranch, branchPrefix, branchNameTemplate } = context.inputs;
  const isPR = context.isPR;

  if (isPR) {
    const prData = giteaData.contextData as GitHubPullRequest;
    const prState = prData.state;

    if (prState === "CLOSED" || prState === "MERGED") {
      console.log(
        `PR #${entityNumber} is ${prState}, creating new branch from source...`,
      );
    } else {
      // Checkout open PR branch
      console.log("This is an open PR, checking out PR branch...");

      const branchName = prData.headRefName;
      const commitCount = prData.commits.totalCount || 20;
      const fetchDepth = Math.max(commitCount, 20);

      validateBranchName(branchName);

      // Use the pull ref instead of branch name to support forks and ensure ref exists
      const pullRef = `refs/pull/${entityNumber}/head`;
      execGit(["fetch", "origin", `--depth=${fetchDepth}`, `${pullRef}:${branchName}`]);
      execGit(["checkout", branchName, "--"]);

      console.log(`Successfully checked out PR branch for PR #${entityNumber}`);

      const baseBranch = prData.baseRefName;
      validateBranchName(baseBranch);

      // Fetch the base branch so `git diff origin/<base>...HEAD` works for code review
      try {
        execGit(["fetch", "origin", baseBranch, "--depth=1"]);
        console.log(`Fetched base branch '${baseBranch}' for diff comparison`);
      } catch (e) {
        console.warn(`Warning: could not fetch base branch '${baseBranch}': ${e}`);
      }

      return {
        baseBranch,
        currentBranch: branchName,
      };
    }
  }

  // Determine source branch
  let sourceBranch: string;
  if (baseBranch) {
    sourceBranch = baseBranch;
  } else {
    const repoData = await client.getRepo(owner, repo);
    sourceBranch = repoData.default_branch;
  }

  const entityType = isPR ? "pr" : "issue";

  let sourceSHA: string | undefined;
  try {
    const branchData = await client.getBranch(owner, repo, sourceBranch);
    sourceSHA = branchData.commit.id;
    console.log(`Source branch SHA: ${sourceSHA}`);

    const firstLabel = extractFirstLabel(giteaData);
    const title = giteaData.contextData.title;

    let newBranch = generateBranchName(
      branchNameTemplate,
      branchPrefix,
      entityType,
      entityNumber,
      sourceSHA,
      firstLabel,
      title,
    );

    // Create and checkout branch
    console.log(
      `Creating local branch ${newBranch} for ${entityType} #${entityNumber} from source branch: ${sourceBranch}...`,
    );

    validateBranchName(sourceBranch);
    validateBranchName(newBranch);
    execGit(["fetch", "origin", sourceBranch, "--depth=1"]);
    execGit(["checkout", sourceBranch, "--"]);
    execGit(["checkout", "-b", newBranch]);

    console.log(
      `Successfully created and checked out local branch: ${newBranch}`,
    );

    return {
      baseBranch: sourceBranch,
      claudeBranch: newBranch,
      currentBranch: newBranch,
    };
  } catch (error) {
    console.error("Error in Gitea branch setup:", error);
    throw error;
  }
}

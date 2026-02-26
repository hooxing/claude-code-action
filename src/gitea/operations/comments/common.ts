import { GITEA_SERVER_URL } from "../../api/config";

export function createGiteaJobRunLink(
  owner: string,
  repo: string,
  runId: string,
): string {
  // Gitea Actions uses a different URL scheme for workflow runs
  const jobRunUrl = `${GITEA_SERVER_URL}/${owner}/${repo}/actions/runs/${runId}`;
  return `[View job run](${jobRunUrl})`;
}

export function createGiteaBranchLink(
  owner: string,
  repo: string,
  branchName: string,
): string {
  const branchUrl = `${GITEA_SERVER_URL}/${owner}/${repo}/src/branch/${encodeURIComponent(branchName)}`;
  return `\n[View branch](${branchUrl})`;
}

export function createGiteaCommentBody(
  jobRunLink: string,
  branchLink: string = "",
): string {
  return `Claude Code is working…

I'll analyze this and get back to you.

${jobRunLink}${branchLink}`;
}

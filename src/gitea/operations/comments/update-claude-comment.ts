/**
 * Update an existing Claude comment on Gitea.
 */

import type { GiteaClient } from "../../api/client";

export type UpdateGiteaCommentParams = {
  owner: string;
  repo: string;
  commentId: number;
  body: string;
};

export type UpdateGiteaCommentResult = {
  id: number;
  html_url: string;
  updated_at: string;
};

export async function updateGiteaComment(
  client: GiteaClient,
  params: UpdateGiteaCommentParams,
): Promise<UpdateGiteaCommentResult> {
  const { owner, repo, commentId, body } = params;

  const response = await client.updateIssueComment(
    owner,
    repo,
    commentId,
    body,
  );

  return {
    id: response.id,
    html_url: response.html_url,
    updated_at: response.updated_at,
  };
}

import { describe, test, expect } from "bun:test";
import {
  createGiteaJobRunLink,
  createGiteaBranchLink,
  createGiteaCommentBody,
} from "../src/gitea/operations/comments/common";

describe("Gitea comment helpers", () => {
  test("createGiteaJobRunLink generates correct URL", () => {
    const link = createGiteaJobRunLink("my-org", "my-repo", "42");
    expect(link).toContain("my-org/my-repo/actions/runs/42");
    expect(link).toContain("[View job run]");
  });

  test("createGiteaBranchLink generates correct URL with encoding", () => {
    const link = createGiteaBranchLink("my-org", "my-repo", "claude/issue-1");
    expect(link).toContain("my-org/my-repo/src/branch/claude%2Fissue-1");
    expect(link).toContain("[View branch]");
  });

  test("createGiteaCommentBody generates working comment", () => {
    const body = createGiteaCommentBody("[View job run](http://example.com)");
    expect(body).toContain("Claude Code is working");
    expect(body).toContain("[View job run](http://example.com)");
  });

  test("createGiteaCommentBody includes branch link when provided", () => {
    const body = createGiteaCommentBody(
      "[View job run](http://example.com)",
      "\n[View branch](http://example.com/branch)",
    );
    expect(body).toContain("[View branch]");
  });
});

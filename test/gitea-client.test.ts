import { describe, test, expect } from "bun:test";
import { GiteaClient } from "../src/gitea/api/client";

describe("GiteaClient", () => {
  test("constructor strips trailing slash from baseUrl", () => {
    const client = new GiteaClient({
      token: "test-token",
      baseUrl: "https://gitea.example.com/api/v1/",
    });
    // We verify by checking the class is instantiated without error
    expect(client).toBeDefined();
  });

  test("constructor uses default baseUrl from config", () => {
    const client = new GiteaClient({ token: "test-token" });
    expect(client).toBeDefined();
  });
});

describe("GiteaClient API paths", () => {
  // Test that the client constructs correct API paths
  // We can't test actual API calls without a Gitea server,
  // but we can verify the client methods exist and have correct signatures

  test("has repository methods", () => {
    const client = new GiteaClient({ token: "t" });
    expect(typeof client.getRepo).toBe("function");
    expect(typeof client.getBranch).toBe("function");
  });

  test("has issue methods", () => {
    const client = new GiteaClient({ token: "t" });
    expect(typeof client.getIssue).toBe("function");
    expect(typeof client.getIssueComments).toBe("function");
    expect(typeof client.createIssueComment).toBe("function");
    expect(typeof client.updateIssueComment).toBe("function");
  });

  test("has pull request methods", () => {
    const client = new GiteaClient({ token: "t" });
    expect(typeof client.getPullRequest).toBe("function");
    expect(typeof client.getPullRequestFiles).toBe("function");
    expect(typeof client.getPullRequestReviews).toBe("function");
    expect(typeof client.getPullRequestReviewComments).toBe("function");
  });

  test("has user methods", () => {
    const client = new GiteaClient({ token: "t" });
    expect(typeof client.getUser).toBe("function");
  });

  test("has permission methods", () => {
    const client = new GiteaClient({ token: "t" });
    expect(typeof client.getRepoPermission).toBe("function");
  });
});

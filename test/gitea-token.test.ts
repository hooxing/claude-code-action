import { describe, test, expect } from "bun:test";
import { setupGiteaToken } from "../src/gitea/token";

describe("setupGiteaToken", () => {
  const originalEnv = { ...process.env };

  // Reset environment after each test
  function resetEnv() {
    delete process.env.GITEA_TOKEN;
    delete process.env.OVERRIDE_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  }

  test("uses GITEA_TOKEN when set", async () => {
    resetEnv();
    process.env.GITEA_TOKEN = "gitea-pat-12345";
    const token = await setupGiteaToken();
    expect(token).toBe("gitea-pat-12345");
    resetEnv();
  });

  test("falls back to OVERRIDE_GITHUB_TOKEN", async () => {
    resetEnv();
    process.env.OVERRIDE_GITHUB_TOKEN = "override-token";
    const token = await setupGiteaToken();
    expect(token).toBe("override-token");
    resetEnv();
  });

  test("falls back to GITHUB_TOKEN", async () => {
    resetEnv();
    process.env.GITHUB_TOKEN = "github-compat-token";
    const token = await setupGiteaToken();
    expect(token).toBe("github-compat-token");
    resetEnv();
  });

  test("GITEA_TOKEN takes priority over GITHUB_TOKEN", async () => {
    resetEnv();
    process.env.GITEA_TOKEN = "gitea-token";
    process.env.GITHUB_TOKEN = "github-token";
    const token = await setupGiteaToken();
    expect(token).toBe("gitea-token");
    resetEnv();
  });

  test("throws when no token is available", async () => {
    resetEnv();
    await expect(setupGiteaToken()).rejects.toThrow(
      "No authentication token found",
    );
    // Restore original env
    Object.assign(process.env, originalEnv);
  });
});

#!/usr/bin/env bun

/**
 * Entrypoint for the Claude Code Action **on Gitea**.
 *
 * This mirrors src/entrypoints/run.ts but replaces every GitHub-specific
 * call with its Gitea equivalent.  The overall flow is identical:
 *
 *   1. Parse context / detect mode
 *   2. Authenticate (PAT-based, no OIDC)
 *   3. Check permissions
 *   4. Check trigger conditions
 *   5. Prepare mode (tag / agent)
 *   6. Install Claude Code CLI
 *   7. Run Claude Code
 *   8. Cleanup (update comment, write summary)
 */

import * as core from "@actions/core";
import { dirname } from "path";
import { spawn } from "child_process";
import { appendFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";

// Gitea-specific imports
import { setupGiteaToken } from "../gitea/token";
import { createGiteaClient } from "../gitea/api/client";
import type { GiteaClient } from "../gitea/api/client";
import { parseGiteaContext } from "../gitea/context";
import type { GitHubContext } from "../github/context";
import { isEntityContext } from "../github/context";
import { checkGiteaWritePermissions } from "../gitea/validation/permissions";

// Shared imports (mode detection, trigger checking work the same)
import { detectMode } from "../modes/detector";
import { checkContainsTrigger } from "../github/validation/trigger";

// Gitea mode preparations
import { prepareGiteaTagMode } from "../modes/gitea-tag";
import { prepareGiteaAgentMode } from "../modes/gitea-agent";

import { collectActionInputsPresence } from "./collect-inputs";
import { formatTurnsFromData } from "./format-turns";
import type { Turn } from "./format-turns";

// Base-action imports
import { validateEnvironmentVariables } from "../../base-action/src/validate-env";
import { setupClaudeCodeSettings } from "../../base-action/src/setup-claude-code-settings";
import { installPlugins } from "../../base-action/src/install-plugins";
import { preparePrompt } from "../../base-action/src/prepare-prompt";
import { runClaude } from "../../base-action/src/run-claude";
import type { ClaudeRunResult } from "../../base-action/src/run-claude-sdk";

// Gitea comment update
import { updateGiteaComment } from "../gitea/operations/comments/update-claude-comment";
import {
  createGiteaJobRunLink,
  createGiteaBranchLink,
} from "../gitea/operations/comments/common";

// ─── Install Claude Code CLI ────────────────────────────────────────

async function installClaudeCode(): Promise<void> {
  const customExecutable = process.env.PATH_TO_CLAUDE_CODE_EXECUTABLE;
  if (customExecutable) {
    console.log(`Using custom Claude Code executable: ${customExecutable}`);
    const claudeDir = dirname(customExecutable);
    const githubPath = process.env.GITHUB_PATH;
    if (githubPath) {
      await appendFile(githubPath, `${claudeDir}\n`);
    }
    process.env.PATH = `${claudeDir}:${process.env.PATH}`;
    return;
  }

  const claudeCodeVersion = "2.1.59";
  console.log(`Installing Claude Code v${claudeCodeVersion}...`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Installation attempt ${attempt}...`);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "bash",
          [
            "-c",
            `curl -fsSL https://claude.ai/install.sh | bash -s -- ${claudeCodeVersion}`,
          ],
          { stdio: "inherit" },
        );
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Install failed with exit code ${code}`));
        });
        child.on("error", reject);
      });
      console.log("Claude Code installed successfully");
      const homeBin = `${process.env.HOME}/.local/bin`;
      const githubPath = process.env.GITHUB_PATH;
      if (githubPath) {
        await appendFile(githubPath, `${homeBin}\n`);
      }
      process.env.PATH = `${homeBin}:${process.env.PATH}`;
      return;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Failed to install Claude Code after 3 attempts: ${error}`,
        );
      }
      console.log("Installation failed, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// ─── Step summary ───────────────────────────────────────────────────

async function writeStepSummary(executionFile: string): Promise<void> {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  try {
    const fileContent = readFileSync(executionFile, "utf-8");
    const data: Turn[] = JSON.parse(fileContent);
    const markdown = formatTurnsFromData(data);
    await appendFile(summaryFile, markdown);
    console.log("Successfully formatted Claude Code report");
  } catch (error) {
    console.error(`Failed to format output: ${error}`);
    try {
      let fallback = "## Claude Code Report (Raw Output)\n\n";
      fallback += "```json\n";
      fallback += readFileSync(executionFile, "utf-8");
      fallback += "\n```\n";
      await appendFile(summaryFile, fallback);
    } catch {
      console.error("Failed to write raw output to step summary");
    }
  }
}

// ─── Update comment with final status ───────────────────────────────

async function updateFinalComment(opts: {
  client: GiteaClient;
  commentId: number;
  context: GitHubContext;
  claudeBranch?: string;
  baseBranch: string;
  claudeSuccess: boolean;
  prepareSuccess: boolean;
  prepareError?: string;
}) {
  if (!isEntityContext(opts.context)) return;

  const { owner, repo } = opts.context.repository;
  const jobRunLink = createGiteaJobRunLink(owner, repo, opts.context.runId);
  const branchLink = opts.claudeBranch
    ? createGiteaBranchLink(owner, repo, opts.claudeBranch)
    : "";

  // ── Failure path: Claude never ran or preparation failed ─────────────
  // In these cases the comment still has the initial placeholder, so it's
  // safe to replace it entirely with an error message.
  if (!opts.prepareSuccess) {
    const body = `❌ Claude Code failed during preparation.\n\n${opts.prepareError || "Unknown error"}\n\n${jobRunLink}`;
    await updateGiteaComment(opts.client, { owner, repo, commentId: opts.commentId, body });
    return;
  }

  // ── Success / partial-success path ───────────────────────────────────
  // Claude has already updated the comment via the MCP tool.
  // We MUST NOT replace that content.  Instead, read the current body and
  // append a short status footer so the user gets the job/branch links.
  const statusFooter = opts.claudeSuccess
    ? `\n\n---\n✅ Claude Code has finished working on this.\n\n${jobRunLink}${branchLink}`
    : `\n\n---\n⚠️ Claude Code finished with errors.\n\n${jobRunLink}`;

  try {
    type CommentBody = { body: string };
    console.log(`[Gitea] Reading comment id=${opts.commentId} from /repos/${owner}/${repo}/issues/comments/${opts.commentId}`);
    const current = await opts.client.get<CommentBody>(
      `/repos/${owner}/${repo}/issues/comments/${opts.commentId}`,
    );
    const existingBody = current?.body ?? "";
    console.log(`[Gitea] Existing comment length=${existingBody.length}, preview="${existingBody.substring(0, 80).replace(/\n/g, "↵")}"`);

    // Append the footer regardless of what Claude wrote.
    // If Claude truly didn't write anything (still placeholder), the footer
    // at least gives the user the status links.
    const finalBody = existingBody + statusFooter;
    await updateGiteaComment(opts.client, { owner, repo, commentId: opts.commentId, body: finalBody });
    console.log("[Gitea] Comment updated with status footer appended.");
  } catch (err) {
    console.error(`[Gitea] Could not read/update comment (id=${opts.commentId}): ${err}`);
    // Last resort: just try to set the comment to the status message.
    try {
      const fallbackBody = opts.claudeSuccess
        ? `✅ Claude Code has finished working on this.\n\n${jobRunLink}${branchLink}`
        : `⚠️ Claude Code finished with errors.\n\n${jobRunLink}`;
      await updateGiteaComment(opts.client, { owner, repo, commentId: opts.commentId, body: fallbackBody });
    } catch (err2) {
      console.error(`[Gitea] Final fallback update also failed: ${err2}`);
    }
  }
}


// ─── Main ───────────────────────────────────────────────────────────

async function run() {
  let giteaToken: string | undefined;
  let commentId: number | undefined;
  let claudeBranch: string | undefined;
  let baseBranch: string | undefined;
  let executionFile: string | undefined;
  let claudeSuccess = false;
  let prepareSuccess = true;
  let prepareError: string | undefined;
  let context: GitHubContext | undefined;
  let client: GiteaClient | undefined;
  let prepareCompleted = false;

  try {
    // ── Phase 1: Prepare ──────────────────────────────────────────
    const actionInputsPresent = collectActionInputsPresence();
    context = parseGiteaContext();
    const modeName = detectMode(context);
    console.log(
      `[Gitea] Auto-detected mode: ${modeName} for event: ${context.eventName}`,
    );

    giteaToken = await setupGiteaToken();
    client = createGiteaClient(giteaToken);

    // Make token available to downstream code
    process.env.GITHUB_TOKEN = giteaToken;
    process.env.GH_TOKEN = giteaToken;
    process.env.GITEA_TOKEN = giteaToken;

    // Check write permissions
    if (isEntityContext(context)) {
      const hasWritePermissions = await checkGiteaWritePermissions(
        client,
        context,
        context.inputs.allowedNonWriteUsers,
        !!process.env.OVERRIDE_GITHUB_TOKEN || !!process.env.GITEA_TOKEN,
      );
      if (!hasWritePermissions) {
        throw new Error(
          "Actor does not have write permissions to the Gitea repository",
        );
      }
    }

    // Check trigger
    const containsTrigger =
      modeName === "tag"
        ? isEntityContext(context) && checkContainsTrigger(context)
        : !!context.inputs?.prompt;

    console.log(`Mode: ${modeName}`);
    console.log(`Context prompt: ${context.inputs?.prompt || "NO PROMPT"}`);
    console.log(`Trigger result: ${containsTrigger}`);

    if (!containsTrigger) {
      console.log("No trigger found, skipping remaining steps");
      core.setOutput("gitea_token", giteaToken);
      return;
    }

    // Run prepare
    console.log(
      `Preparing with mode: ${modeName} for event: ${context.eventName}`,
    );
    const prepareResult =
      modeName === "tag"
        ? await prepareGiteaTagMode({ context, client, giteaToken })
        : await prepareGiteaAgentMode({ context, client, giteaToken });

    commentId = prepareResult.commentId;
    claudeBranch = prepareResult.branchInfo.claudeBranch;
    baseBranch = prepareResult.branchInfo.baseBranch;
    prepareCompleted = true;

    // ── Phase 2: Install Claude Code CLI ──────────────────────────
    await installClaudeCode();

    // ── Phase 3: Run Claude ───────────────────────────────────────
    process.env.INPUT_ACTION_INPUTS_PRESENT = actionInputsPresent;
    process.env.CLAUDE_CODE_ACTION = "1";
    process.env.DETAILED_PERMISSION_MESSAGES = "1";

    validateEnvironmentVariables();

    await setupClaudeCodeSettings(process.env.INPUT_SETTINGS);

    await installPlugins(
      process.env.INPUT_PLUGIN_MARKETPLACES,
      process.env.INPUT_PLUGINS,
      process.env.INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE,
    );

    const promptFile =
      process.env.INPUT_PROMPT_FILE ||
      `${process.env.RUNNER_TEMP}/claude-prompts/claude-prompt.txt`;
    const promptConfig = await preparePrompt({
      prompt: "",
      promptFile,
    });

    const claudeResult: ClaudeRunResult = await runClaude(promptConfig.path, {
      claudeArgs: prepareResult.claudeArgs,
      appendSystemPrompt: process.env.APPEND_SYSTEM_PROMPT,
      model: process.env.ANTHROPIC_MODEL,
      pathToClaudeCodeExecutable:
        process.env.INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE,
      showFullOutput: process.env.INPUT_SHOW_FULL_OUTPUT,
    });

    claudeSuccess = claudeResult.conclusion === "success";
    executionFile = claudeResult.executionFile;

    if (claudeResult.executionFile) {
      core.setOutput("execution_file", claudeResult.executionFile);
    }
    if (claudeResult.sessionId) {
      core.setOutput("session_id", claudeResult.sessionId);
    }
    if (claudeResult.structuredOutput) {
      core.setOutput("structured_output", claudeResult.structuredOutput);
    }
    core.setOutput("conclusion", claudeResult.conclusion);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!prepareCompleted) {
      prepareSuccess = false;
      prepareError = errorMessage;
    }
    core.setFailed(`Action failed with error: ${errorMessage}`);
  } finally {
    // ── Phase 4: Cleanup ──────────────────────────────────────────
    if (commentId && context && isEntityContext(context) && client) {
      try {
        await updateFinalComment({
          client,
          commentId,
          context,
          claudeBranch,
          baseBranch: baseBranch || "main",
          claudeSuccess,
          prepareSuccess,
          prepareError,
        });
      } catch (error) {
        console.error("Error updating Gitea comment:", error);
      }
    }

    if (
      executionFile &&
      existsSync(executionFile) &&
      process.env.DISPLAY_REPORT !== "false"
    ) {
      await writeStepSummary(executionFile);
    }

    core.setOutput("branch_name", claudeBranch);
    core.setOutput("gitea_token", giteaToken);
  }
}

if (import.meta.main) {
  run();
}

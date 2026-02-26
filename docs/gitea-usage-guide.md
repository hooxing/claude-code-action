# Claude Code Action for Gitea — Usage Guide

This guide explains how to use the **Claude Code Action** on a self-hosted [Gitea](https://gitea.com) instance. The action allows Claude to respond to `@claude` mentions on issues and pull requests (tag mode) or to run tasks via a `prompt` input (agent mode), just like the GitHub version — but entirely on Gitea.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Architecture Overview](#architecture-overview)
4. [Authentication](#authentication)
5. [Workflow Configuration](#workflow-configuration)
   - [Tag Mode (Interactive)](#tag-mode-interactive)
   - [Agent Mode (Automation)](#agent-mode-automation)
6. [Available Inputs](#available-inputs)
7. [Available Outputs](#available-outputs)
8. [Differences from the GitHub Version](#differences-from-the-github-version)
9. [Advanced Configuration](#advanced-configuration)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement                           | Details                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Gitea version**                     | ≥ 1.19 (Gitea Actions support is required)                                                    |
| **Gitea Actions runner**              | A registered `act_runner` configured for your Gitea instance                                  |
| **Anthropic API key**                 | An API key from [console.anthropic.com](https://console.anthropic.com)                        |
| **Gitea personal access token (PAT)** | A token with `repo` scope (or use the built-in `GITHUB_TOKEN` that Gitea Actions provides)    |
| **Internet access**                   | The runner must be able to reach `https://claude.ai` (to install the CLI) and Anthropic's API |

### Setting up Gitea Actions

If you haven't already enabled Gitea Actions:

1. In `app.ini`, ensure:
   ```ini
   [actions]
   ENABLED = true
   ```
2. Register a runner:
   ```bash
   # On the runner machine
   act_runner register --instance https://your-gitea.example.com --token <runner-token>
   act_runner daemon
   ```
3. Your Gitea instance should now accept workflow files in `.gitea/workflows/`.

---

## Quick Start

### 1. Store Secrets

> **Note**: Gitea does not allow secret names starting with `GITEA_` or `GITHUB_`. Use a name like `CLAUDE_PAT` instead.

You can add secrets at either the **user level** or the **repository level**:

- **User-level secrets**: Click your **avatar** (top right) → **Settings** → **Actions** → **Secrets**. These secrets are available to all your repositories.
- **Repository-level secrets**: Go to your repository → **Settings** → **Actions** → **Secrets**. These secrets are only available to this repository.

Add the following secrets:

| Secret Name         | Value                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                                                                                      |
| `CLAUDE_PAT`        | A Gitea personal access token with `repo` scope (optional if the built-in token has sufficient permissions) |

### 2. Create a Workflow File

Create `.gitea/workflows/claude.yml`:

```yaml
name: Claude Code
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, labeled, assigned]
  pull_request:
    types: [opened, synchronize]

jobs:
  claude:
    runs-on: ubuntu-latest # or your custom runner label
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Run Claude Code Action
        uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          trigger_phrase: "@claude"
```

### 3. Try It Out

Open an issue or PR in your repository and type:

```
@claude Can you help me understand this codebase?
```

Claude will create a tracking comment and respond.

---

## Architecture Overview

```
┌────────────────────────────────────────┐
│         Gitea Instance                 │
│  ┌──────────────────────────────────┐  │
│  │   Issue / PR with @claude        │  │
│  └──────────┬───────────────────────┘  │
│             │ webhook                  │
│  ┌──────────▼───────────────────────┐  │
│  │   Gitea Actions Runner           │  │
│  │   ┌────────────────────────────┐ │  │
│  │   │  Claude Code Action        │ │  │
│  │   │  (action-gitea.yml)        │ │  │
│  │   │                            │ │  │
│  │   │  1. Parse context          │ │  │
│  │   │  2. Fetch PR/Issue data    │ │  │
│  │   │     (Gitea REST API)       │ │  │
│  │   │  3. Create tracking comment│ │  │
│  │   │  4. Run Claude Code CLI    │ │  │
│  │   │  5. Push changes / reply   │ │  │
│  │   └────────────────────────────┘ │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
                    │
                    │ API call
                    ▼
           ┌───────────────┐
           │ Anthropic API  │
           │  (Claude)      │
           └───────────────┘
```

The action:

1. **Parses** the Gitea Actions webhook payload (compatible with GitHub Actions format).
2. **Authenticates** to Gitea's REST API using a PAT or the built-in workflow token.
3. **Fetches** issue/PR data, comments, file changes via Gitea REST API (no GraphQL needed).
4. **Builds** a prompt containing all context for Claude.
5. **Runs** the Claude Code CLI, which reads the repo, makes changes, and pushes commits.
6. **Updates** the tracking comment with the result.

---

## Authentication

### Gitea Token

The action uses a Gitea Personal Access Token (PAT) for all API operations. There are three ways to provide it (in order of priority):

1. **`gitea_token` input** (recommended): Set in your workflow file using a secret.
2. **`GITEA_TOKEN` environment variable**: Set in the runner environment.
3. **Built-in `GITHUB_TOKEN`**: Gitea Actions automatically injects a token compatible with the GitHub Actions format.

> **Note**: Unlike the GitHub version, there is no OIDC-based token exchange. Gitea uses direct token authentication.

### Creating a Gitea PAT

1. Go to your Gitea profile → **Settings → Applications**.
2. Under **Manage Access Tokens**, create a new token with:
   - **Token Name**: `claude-code-action`
   - **Scopes**: Select `repo` (full repository access)
3. Copy the generated token and store it as a secret in your repository.

### Anthropic API Key

The Claude Code CLI requires authentication with Anthropic:

- **`anthropic_api_key`**: Direct API key from Anthropic.
- **`claude_code_oauth_token`**: OAuth token (alternative).
- **Bedrock/Vertex**: Cloud provider authentication (set `use_bedrock` or `use_vertex` to `true`).

---

## Workflow Configuration

### Tag Mode (Interactive)

Tag mode responds to user interactions — `@claude` mentions in comments, issue assignments, or label triggers.

#### Example: Respond to @claude Mentions

```yaml
name: Claude Tag Mode
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  issues:
    types: [opened, labeled, assigned]

jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          trigger_phrase: "@claude"
          track_progress: "true"
```

#### Example: Trigger by Label

```yaml
name: Claude on Label
on:
  issues:
    types: [labeled]

jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          label_trigger: "claude-task"
          track_progress: "true"
```

#### Example: Trigger by Assignee

```yaml
name: Claude on Assign
on:
  issues:
    types: [assigned]

jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          assignee_trigger: "@claude-bot"
          track_progress: "true"
```

### Agent Mode (Automation)

Agent mode runs whenever an explicit `prompt` input is provided. It bypasses mention checking and runs directly.

#### Example: Auto-review PRs

```yaml
name: Claude PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          prompt: |
            Review this pull request for:
            - Code quality issues
            - Potential bugs
            - Security vulnerabilities
            Provide a summary comment with your findings.
```

#### Example: Auto-fix on Schedule

```yaml
name: Claude Daily Fix
on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9 AM

jobs:
  fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          prompt: |
            Look through the codebase for any TODO comments
            and try to resolve them. Create a branch with your fixes.
```

---

## Available Inputs

| Input                            | Default          | Description                                      |
| -------------------------------- | ---------------- | ------------------------------------------------ |
| `trigger_phrase`                 | `@claude`        | Phrase to look for in comments/body              |
| `assignee_trigger`               | —                | Assignee username that triggers the action       |
| `label_trigger`                  | `claude`         | Label that triggers the action                   |
| `base_branch`                    | (default branch) | Branch to use as base when creating new branches |
| `branch_prefix`                  | `claude/`        | Prefix for Claude-created branches               |
| `branch_name_template`           | —                | Template for branch names (see below)            |
| `allowed_bots`                   | —                | Comma-separated bot usernames, or `*` for all    |
| `allowed_non_write_users`        | —                | Users allowed without write permissions          |
| `include_comments_by_actor`      | —                | Filter to include specific commenters            |
| `exclude_comments_by_actor`      | —                | Filter to exclude specific commenters            |
| `prompt`                         | —                | Direct prompt for Claude (enables agent mode)    |
| `settings`                       | —                | Claude Code settings JSON or file path           |
| `anthropic_api_key`              | —                | Anthropic API key                                |
| `claude_code_oauth_token`        | —                | OAuth token alternative                          |
| `gitea_token`                    | —                | Gitea PAT with repo permissions                  |
| `use_bedrock`                    | `false`          | Use Amazon Bedrock                               |
| `use_vertex`                     | `false`          | Use Google Vertex AI                             |
| `claude_args`                    | —                | Additional CLI arguments for Claude              |
| `use_sticky_comment`             | `false`          | Reuse a single tracking comment                  |
| `ssh_signing_key`                | —                | SSH private key for commit signing               |
| `bot_id`                         | `0`              | User ID for git operations                       |
| `bot_name`                       | `claude-bot`     | Username for git operations                      |
| `track_progress`                 | `false`          | Force tag mode with tracking comments            |
| `include_fix_links`              | `true`           | Include fix links in review feedback             |
| `path_to_claude_code_executable` | —                | Custom Claude Code executable path               |
| `display_report`                 | `true`           | Show report in step summary                      |
| `show_full_output`               | `false`          | Show full Claude output (may contain secrets)    |
| `plugins`                        | —                | Plugin names to install                          |
| `plugin_marketplaces`            | —                | Plugin marketplace URLs                          |
| `gitea_api_url`                  | —                | Custom Gitea API base URL                        |
| `gitea_server_url`               | —                | Custom Gitea server URL                          |

### Branch Name Template Variables

| Variable           | Description                             |
| ------------------ | --------------------------------------- |
| `{{prefix}}`       | The `branch_prefix` value               |
| `{{entityType}}`   | `issue` or `pr`                         |
| `{{entityNumber}}` | Issue/PR number                         |
| `{{timestamp}}`    | Current Unix timestamp                  |
| `{{sha}}`          | Short SHA of the source branch          |
| `{{label}}`        | First label, or entity type as fallback |
| `{{description}}`  | First 5 words of title in kebab-case    |

---

## Available Outputs

| Output              | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `execution_file`    | Path to Claude's execution output file                |
| `branch_name`       | Branch created by Claude                              |
| `gitea_token`       | The token used by the action                          |
| `structured_output` | JSON structured output (when `--json-schema` is used) |
| `session_id`        | Session ID for resuming conversations                 |

---

## Differences from the GitHub Version

| Feature                    | GitHub Version                   | Gitea Version                                   |
| -------------------------- | -------------------------------- | ----------------------------------------------- |
| **Authentication**         | OIDC + GitHub App token exchange | Personal Access Token (PAT)                     |
| **Data fetching**          | GraphQL API                      | REST API only                                   |
| **API commit signing**     | Supported (`use_commit_signing`) | Not supported (use SSH signing or standard git) |
| **CI status integration**  | GitHub Actions workflow status   | Not yet supported                               |
| **File operations server** | API-based commit/push            | Standard git commands                           |
| **Image downloading**      | Downloads from GitHub URLs       | Not yet supported                               |
| **Token revocation**       | Automatic (GitHub App)           | Not needed (PAT)                                |
| **Action format**          | `action.yml` (composite)         | `action-gitea.yml` (composite)                  |
| **Inline review comments** | Supported via MCP server         | Not yet supported                               |

---

## Advanced Configuration

### Using with Amazon Bedrock

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    use_bedrock: "true"
  env:
    AWS_REGION: us-east-1
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Using with Google Vertex AI

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    use_vertex: "true"
  env:
    ANTHROPIC_VERTEX_PROJECT_ID: my-gcp-project
    CLOUD_ML_REGION: us-central1
    GOOGLE_APPLICATION_CREDENTIALS: /path/to/credentials.json
```

### SSH Commit Signing

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    ssh_signing_key: ${{ secrets.SSH_SIGNING_KEY }}
```

### Custom Bot Identity

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    bot_name: "my-claude-bot"
    bot_id: "12345"
```

### Using a Custom Gitea Server URL

You can provide the custom Gitea URL directly as action inputs (recommended):

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    gitea_api_url: https://your-gitea.example.com/api/v1
    gitea_server_url: https://your-gitea.example.com
```

Alternatively, set environment variables in your workflow:

```yaml
env:
  GITEA_API_URL: https://your-gitea.example.com/api/v1
  GITEA_SERVER_URL: https://your-gitea.example.com
```

Or set them in the runner environment before the action runs.

---

## Troubleshooting

### Common Issues

#### "No authentication token found"

**Cause**: Neither `gitea_token`, `GITEA_TOKEN`, `OVERRIDE_GITHUB_TOKEN`, nor `GITHUB_TOKEN` is set.

**Fix**: Add a `gitea_token` input pointing to a secret containing your Gitea PAT:

```yaml
with:
  gitea_token: ${{ secrets.CLAUDE_PAT }}
```

#### "Actor does not have write permissions"

**Cause**: The user who triggered the action doesn't have write access to the repository.

**Fix**: Either grant write access to the user or use `allowed_non_write_users`:

```yaml
with:
  allowed_non_write_users: "username1,username2"
```

#### "Failed to fetch PR/Issue data from Gitea"

**Cause**: The Gitea token doesn't have permission to read the repository, or the API URL is incorrect.

**Fix**:

1. Verify your PAT has `repo` scope.
2. Check `GITEA_API_URL` points to the correct endpoint (e.g., `https://your-gitea.example.com/api/v1`).

#### "Install failed" (Claude Code CLI)

**Cause**: The runner can't reach `https://claude.ai` to download the CLI.

**Fix**:

1. Ensure the runner has internet access.
2. Alternatively, pre-install Claude Code and use `path_to_claude_code_executable`.

#### Branch creation fails

**Cause**: The Gitea token may not have branch creation permissions.

**Fix**: Ensure the PAT has full `repo` scope, and the repository allows the user to create branches.

### Debugging

Enable verbose output for debugging:

```yaml
with:
  show_full_output: "true"
```

> ⚠️ **Warning**: This may expose sensitive information in logs. Only use for debugging.

---

## Complete Example Workflow

Here's a full-featured example that handles multiple event types:

```yaml
name: Claude Code Bot
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  issues:
    types: [opened, labeled, assigned]
  pull_request:
    types: [opened, synchronize]

jobs:
  claude-tag:
    # Only run for interactive events (comments, reviews)
    if: >
      github.event_name == 'issue_comment' ||
      github.event_name == 'pull_request_review_comment' ||
      github.event_name == 'pull_request_review' ||
      (github.event_name == 'issues' && github.event.action == 'labeled') ||
      (github.event_name == 'issues' && github.event.action == 'assigned')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          trigger_phrase: "@claude"
          label_trigger: "claude"
          assignee_trigger: "@claude-bot"
          track_progress: "true"
          bot_name: "claude-bot"

  claude-agent:
    # Auto-review new PRs
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          prompt: "Review this PR for code quality, potential bugs, and security issues."
```

---

## Further Resources

- [Gitea Actions Documentation](https://docs.gitea.com/usage/actions/overview)
- [Gitea API Documentation](https://docs.gitea.com/development/api-usage)
- [Claude Code Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Original Claude Code Action (GitHub)](https://github.com/anthropics/claude-code-action)

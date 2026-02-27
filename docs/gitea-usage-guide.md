# Claude Code Action for Gitea — Usage Guide

This guide explains how to use **Claude Code Action** on a self-hosted [Gitea](https://gitea.com) instance. The Action lets Claude respond to `@claude` mentions in Issues and Pull Requests (Tag mode) or run tasks via a `prompt` input (Agent mode) — with the same capabilities as the GitHub version, but running entirely on Gitea.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Full Deployment)](#quick-start-full-deployment)
3. [act_runner Docker Configuration](#act_runner-docker-configuration)
4. [Workflow File (Inline Mode)](#workflow-file-inline-mode)
5. [Architecture Overview](#architecture-overview)
6. [Authentication](#authentication)
7. [Workflow Configuration Examples](#workflow-configuration-examples)
   - [Tag Mode (Interactive)](#tag-mode-interactive)
   - [Agent Mode (Automated)](#agent-mode-automated)
8. [Available Inputs](#available-inputs)
9. [Available Outputs](#available-outputs)
10. [Differences from GitHub Version](#differences-from-github-version)
11. [Advanced Configuration](#advanced-configuration)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement                     | Details                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| **Gitea version**               | ≥ 1.19 (Gitea Actions support required)                               |
| **Gitea Actions Runner**        | A registered and configured `act_runner` using Docker mode             |
| **Anthropic API Key**           | Obtained from [console.anthropic.com](https://console.anthropic.com)   |
| **Gitea Personal Access Token** | A token with `repo` scope                                              |
| **Network access**              | The runner needs access to the Anthropic API and npm/bun registries    |
| **Docker**                      | Docker must be installed on the runner host                            |

### Enable Gitea Actions

If Gitea Actions is not yet enabled:

1. In `app.ini`:
   ```ini
   [actions]
   ENABLED = true
   ```
2. Restart Gitea.

---

## Quick Start (Full Deployment)

> **This section covers the complete deployment from scratch**, including Gitea configuration, runner setup, secrets, and the workflow file.

### Step 1: Configure Secrets

> **Note**: Gitea does not allow secret names starting with `GITEA_` or `GITHUB_`. Use the names below.

Add secrets at the **user level** (Avatar → Settings → Actions → Secrets) or **repository level** (Repo → Settings → Actions → Secrets):

| Secret Name           | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | Your Anthropic API key                                        |
| `CLAUDE_PAT`          | A Gitea PAT with `repo` scope                                |
| `ANTHROPIC_BASE_URL`  | (Optional) Custom Anthropic API proxy URL                     |

### Step 2: Register and Configure act_runner

> **This is the most error-prone step.** Follow this section carefully. See [act_runner Docker Configuration](#act_runner-docker-configuration) for details.

#### Docker Compose Deployment (Recommended)

```yaml
version: "3.8"
services:
  gitea:
    image: gitea/gitea:latest
    container_name: gitea
    ports:
      - "3000:3000"
      - "2222:22"
    volumes:
      - ./gitea/data:/data
    environment:
      - USER_UID=1000
      - USER_GID=1000
    restart: unless-stopped
    networks:
      - gitea-network

  act_runner:
    image: gitea/act_runner:latest
    container_name: act_runner
    depends_on:
      - gitea
    volumes:
      - ./runner/data:/data
      - ./runner/config/config.yaml:/config.yaml
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      GITEA_INSTANCE_URL: http://gitea:3000
      GITEA_RUNNER_REGISTRATION_TOKEN: <your-runner-token>
      # ⚠️ CRITICAL: labels MUST include the full Docker image address
      GITEA_RUNNER_LABELS: "ubuntu-latest:docker://node:20-bullseye"
      CONFIG_FILE: /config.yaml
    restart: unless-stopped
    networks:
      - gitea-network

networks:
  gitea-network:
    driver: bridge
```

> **⚠️ Important**: The `GITEA_RUNNER_LABELS` format must be `<label>:docker://<image>`, e.g. `ubuntu-latest:docker://node:20-bullseye`.
> Writing just `ubuntu-latest:docker` (without the image) will cause the runner to fail with `Skipping unsupported platform`.

#### act_runner config.yaml

Create `./runner/config/config.yaml`:

```yaml
log:
  level: info

runner:
  capacity: 1
  timeout: 3600s
  labels:
    - "ubuntu-latest:docker://node:20-bullseye"

container:
  # ⚠️ CRITICAL: must match the docker-compose network name
  network: "gitea-network"
  docker_host: ""
  privileged: false
```

#### Get the Runner Registration Token

1. Log in to Gitea → **Site Administration** → **Actions** → **Runners**.
2. Click **Create Runner** to get the registration token.
3. Replace `<your-runner-token>` in `docker-compose.yml`.

#### Start Services

```bash
docker compose up -d
```

Verify the runner is registered and **Idle** in Gitea → Site Administration → Actions → Runners.

> **⚠️ .runner cache file**: After initial registration, the runner creates a `.runner` cache file in `./runner/data/`. If you change `GITEA_RUNNER_LABELS`, you must also update the `labels` field in `.runner`, or delete it to force re-registration.

### Step 3: Fork the claude-code-action Repository

> **⚠️ Important**: The official `anthropics/claude-code-action` repository does **not** contain the Gitea entry file `run-gitea.ts`. You must use a fork that includes it.

1. Fork [hooxing/claude-code-action](https://github.com/hooxing/claude-code-action) (or use it directly).
2. Verify the fork contains `src/entrypoints/run-gitea.ts`.
3. Update the clone URL in your workflow to point to your fork.

### Step 4: Create the Workflow File

> **⚠️ Important**: `act_runner` does **not** support `uses: repo/action-gitea.yml@main` to reference root-level YAML files (it will fail with `action.yml not found`). You must use **inline mode**: manually clone, install, and run in a single `run:` block.

Create `.gitea/workflows/claude.yml`:

```yaml
name: Claude Code
on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, labeled, assigned]
  pull_request:
    types: [opened, synchronize, ready_for_review]
  pull_request_review_comment:
    types: [created]

jobs:
  claude:
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Run Claude Code Action (Gitea)
        run: |
          set -e

          # 1. Install Bun (TypeScript runtime)
          echo "=== Installing Bun ==="
          curl -fsSL https://bun.sh/install | bash
          export BUN_PATH="$HOME/.bun/bin"
          export PATH="$BUN_PATH:$PATH"
          echo "Bun version: $(bun --version)"

          # 2. Clone claude-code-action (fork that includes run-gitea.ts)
          echo "=== Cloning claude-code-action ==="
          CCA_DIR="$HOME/cca"
          git clone --depth 1 https://github.com/hooxing/claude-code-action "$CCA_DIR"
          echo "Cloned to: $CCA_DIR"
          ls "$CCA_DIR/src/entrypoints/"

          # ⚠️ CRITICAL: Set GITHUB_ACTION_PATH to the actual clone path.
          # The MCP comment server uses this path to locate itself.
          export GITHUB_ACTION_PATH="$CCA_DIR"
          echo "GITHUB_ACTION_PATH=$GITHUB_ACTION_PATH"

          # 3. Install dependencies
          echo "=== Installing dependencies ==="
          cd "$CCA_DIR"
          bun install --production

          # 4. Run the Gitea entry script
          echo "=== Running Claude Code Action ==="
          bun run "$CCA_DIR/src/entrypoints/run-gitea.ts"
        env:
          # Gitea API (use container name if on the same Docker network)
          GITEA_API_URL: http://gitea:3000/api/v1
          GITEA_SERVER_URL: http://gitea:3000

          # Authentication
          GITEA_TOKEN: ${{ secrets.CLAUDE_PAT }}
          OVERRIDE_GITHUB_TOKEN: ${{ secrets.CLAUDE_PAT }}

          # Trigger configuration
          TRIGGER_PHRASE: "@claude"
          LABEL_TRIGGER: "claude"
          ASSIGNEE_TRIGGER: ""
          TRACK_PROGRESS: "true"

          # Bot identity
          BOT_NAME: "claude-bot"
          BOT_ID: "0"

          # Branch settings
          BRANCH_PREFIX: "claude/"
          BRANCH_NAME_TEMPLATE: ""
          BASE_BRANCH: ""

          # Comment/filter settings
          USE_STICKY_COMMENT: "false"
          INCLUDE_FIX_LINKS: "true"
          ALLOWED_BOTS: ""
          ALLOWED_NON_WRITE_USERS: ""
          INCLUDE_COMMENTS_BY_ACTOR: ""
          EXCLUDE_COMMENTS_BY_ACTOR: ""

          # Claude CLI args
          CLAUDE_ARGS: ""
          PROMPT: ""

          # Base-action required inputs
          INPUT_PROMPT_FILE: /tmp/claude-prompts/claude-prompt.txt
          INPUT_SETTINGS: ""
          INPUT_SHOW_FULL_OUTPUT: "false"
          DISPLAY_REPORT: "true"
          INPUT_PLUGINS: ""
          INPUT_PLUGIN_MARKETPLACES: ""
          PATH_TO_CLAUDE_CODE_EXECUTABLE: ""
          INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE: ""
          INPUT_PATH_TO_BUN_EXECUTABLE: ""

          # Anthropic API
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
```

### Step 5: Commit and Test

1. Commit `.gitea/workflows/claude.yml` to the default branch.
2. Ensure Actions is enabled under repo **Settings → Actions**.
3. Create an Issue and comment:
   ```
   @claude Hello, what can you do?
   ```
4. Claude should create a tracking comment and reply within seconds.

---

## act_runner Docker Configuration

### Key Configuration Points

| Setting | Correct | Wrong | Notes |
|---|---|---|---|
| Runner Labels | `ubuntu-latest:docker://node:20-bullseye` | `ubuntu-latest:docker` | Must include the full Docker image |
| Container Network | `gitea-network` (matches compose) | empty | Runner containers need access to Gitea |
| Docker Socket | Mount `/var/run/docker.sock` | Not mounted | Runner needs Docker API access |
| config.yaml | Specified via `CONFIG_FILE` | Not used | Ensures labels and network are correct |

### .runner Cache File

When you change labels but don't update `.runner`, the runner uses stale config. Fix:

```bash
# Delete .runner to force re-registration
rm ./runner/data/.runner
docker restart act_runner
```

---

## Workflow File (Inline Mode)

### Why can't you use `uses:` to reference action-gitea.yml?

In standard GitHub Actions:

```yaml
uses: anthropics/claude-code-action/action-gitea.yml@main
```

In `act_runner`, this fails with:

```
action.yml not found in action-gitea.yml/
```

`act_runner` treats the path as a directory and looks for `action.yml` inside it. It does not support referencing root-level YAML files.

### Core Principles of Inline Mode

1. **Manually clone the repo** in `run:`, not via `uses:`.
2. **All operations must be in a single `run:` block** (clone, install, run), because `/tmp` is isolated between steps in act_runner.
3. **`GITHUB_ACTION_PATH` must be set dynamically** via `export` in the run script, not in `env:`. The MCP server depends on this path to locate its scripts.

### Environment Variable Categories

| Category | Variables | Notes |
|---|---|---|
| **Gitea API** | `GITEA_API_URL`, `GITEA_SERVER_URL` | Container name for same Docker network; hostname for external |
| **Auth** | `GITEA_TOKEN`, `OVERRIDE_GITHUB_TOKEN` | Both set to `${{ secrets.CLAUDE_PAT }}` |
| **Trigger** | `TRIGGER_PHRASE`, `LABEL_TRIGGER`, `ASSIGNEE_TRIGGER` | How to trigger Claude |
| **Bot** | `BOT_NAME`, `BOT_ID` | Claude bot identity |
| **Branch** | `BRANCH_PREFIX`, `BRANCH_NAME_TEMPLATE`, `BASE_BRANCH` | Branch naming rules |
| **Anthropic** | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | API auth and proxy |

---

## Architecture Overview

```
┌────────────────────────────────────────┐
│         Gitea Instance                  │
│  ┌──────────────────────────────────┐  │
│  │  Issue / PR with @claude mention │  │
│  └──────────┬───────────────────────┘  │
│             │ webhook                  │
│  ┌──────────▼───────────────────────┐  │
│  │   Gitea Actions Runner           │  │
│  │   ┌────────────────────────────┐ │  │
│  │   │  Claude Code Action        │ │  │
│  │   │  (run-gitea.ts)            │ │  │
│  │   │                            │ │  │
│  │   │  1. Parse context          │ │  │
│  │   │  2. Fetch PR/Issue data    │ │  │
│  │   │     (Gitea REST API)       │ │  │
│  │   │  3. Create tracking comment│ │  │
│  │   │  4. Run Claude Code CLI    │ │  │
│  │   │  5. Update comment via MCP │ │  │
│  │   │  6. Push changes / reply   │ │  │
│  │   └────────────────────────────┘ │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
                    │
                    │ API calls
                    ▼
           ┌───────────────┐
           │ Anthropic API  │
           │  (Claude)      │
           └───────────────┘
```

---

## Authentication

### Gitea Token

The Action uses a Gitea PAT for all API operations. In inline mode, provide it via environment variables:

1. **`GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN`** (recommended for inline mode).
2. **Built-in `GITHUB_TOKEN`**: Auto-injected by Gitea Actions.

> **Note**: Unlike the GitHub version, there is no OIDC-based token exchange. Gitea uses direct token authentication.

### Creating a Gitea PAT

1. Avatar → **Settings** → **Applications**.
2. Under **Manage Access Tokens**, create a new token with `repo` scope.
3. Store the token as a secret.

### Anthropic API Key

- **`ANTHROPIC_API_KEY`**: Direct Anthropic API key.
- **`ANTHROPIC_BASE_URL`**: Optional custom API proxy URL.
- **Bedrock/Vertex**: Cloud provider auth (set `use_bedrock` or `use_vertex`).

---

## Workflow Configuration Examples

### Tag Mode (Interactive)

Modify the `env:` block in the workflow template to change trigger behaviour:

```yaml
# Trigger via @claude mention (default)
TRIGGER_PHRASE: "@claude"

# Trigger via label
LABEL_TRIGGER: "claude-task"

# Trigger via assignee
ASSIGNEE_TRIGGER: "@claude-bot"
```

### Agent Mode (Automated)

Set the `PROMPT` environment variable to enter agent mode:

```yaml
PROMPT: |
  Review this Pull Request for:
  - Code quality issues
  - Potential bugs
  - Security vulnerabilities
  Provide a summary in the comment.
```

---

## Available Inputs

> In inline mode, these are passed as `env:` variables (UPPER_SNAKE_CASE).

| Parameter                        | Env Variable                             | Default      | Description                                  |
| -------------------------------- | ---------------------------------------- | ------------ | -------------------------------------------- |
| `trigger_phrase`                 | `TRIGGER_PHRASE`                         | `@claude`    | Trigger phrase in comments/body              |
| `assignee_trigger`               | `ASSIGNEE_TRIGGER`                       | —            | Username that triggers when assigned         |
| `label_trigger`                  | `LABEL_TRIGGER`                          | `claude`     | Label that triggers the action               |
| `base_branch`                    | `BASE_BRANCH`                            | (default)    | Base branch for new branches                 |
| `branch_prefix`                  | `BRANCH_PREFIX`                          | `claude/`    | Prefix for Claude-created branches           |
| `prompt`                         | `PROMPT`                                 | —            | Direct prompt (enables agent mode)           |
| `anthropic_api_key`              | `ANTHROPIC_API_KEY`                      | —            | Anthropic API key                            |
| `anthropic_base_url`             | `ANTHROPIC_BASE_URL`                     | —            | Custom API base URL                          |
| `gitea_token`                    | `GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN`  | —            | Gitea PAT with repo scope                    |
| `claude_args`                    | `CLAUDE_ARGS`                            | —            | Extra arguments for Claude CLI               |
| `bot_id`                         | `BOT_ID`                                 | `0`          | User ID for git operations                   |
| `bot_name`                       | `BOT_NAME`                               | `claude-bot` | Username for git operations                  |
| `track_progress`                 | `TRACK_PROGRESS`                         | `false`      | Force tag mode with tracking comment         |
| `display_report`                 | `DISPLAY_REPORT`                         | `true`       | Show report in step summary                  |

---

## Available Outputs

| Output              | Description                             |
| ------------------- | --------------------------------------- |
| `execution_file`    | Path to Claude execution output         |
| `branch_name`       | Branch created by Claude                |
| `session_id`        | Session ID for conversation resumption  |

---

## Differences from GitHub Version

| Feature            | GitHub Version                | Gitea Version                            |
| ------------------ | ----------------------------- | ---------------------------------------- |
| **Authentication** | OIDC + GitHub App tokens      | Personal Access Token (PAT)               |
| **Data fetching**  | GraphQL API                   | REST API only                              |
| **Action format**  | `uses: repo/action.yml@ref`   | Inline mode only (manual clone + run)      |
| **Entry file**     | `run.ts`                      | `run-gitea.ts` (fork only)                 |
| **Comment tool**   | `mcp__github_comment__`       | `mcp__gitea_comment__` (auto-patched)      |
| **CI status**      | GitHub Actions workflow status| Not supported                              |
| **Inline reviews** | Via MCP server                | Not supported                              |

---

## Advanced Configuration

### Custom Gitea Server URL

```yaml
env:
  GITEA_API_URL: https://your-gitea.example.com/api/v1
  GITEA_SERVER_URL: https://your-gitea.example.com
```

### Custom Anthropic API Base URL

```yaml
env:
  ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
```

### Amazon Bedrock

```yaml
env:
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### Google Vertex AI

```yaml
env:
  ANTHROPIC_VERTEX_PROJECT_ID: my-gcp-project
  CLOUD_ML_REGION: us-central1
  GOOGLE_APPLICATION_CREDENTIALS: /path/to/credentials.json
```

---

## Troubleshooting

### Error Quick Reference

| Error | Cause | Fix |
|---|---|---|
| `Skipping unsupported platform` | Runner labels missing image address | Use `ubuntu-latest:docker://node:20-bullseye`, update `.runner` cache |
| `action.yml not found in action-gitea.yml/` | `act_runner` can't reference root YAML with `uses:` | Switch to inline mode |
| `Module not found "run-gitea.ts"` | Cloned `anthropics/claude-code-action` (no Gitea entry) | Clone the fork with `run-gitea.ts` |
| Comment shows only "✅ has finished" | `GITHUB_ACTION_PATH` mismatch, MCP server can't start | `export GITHUB_ACTION_PATH="$CCA_DIR"` in the run script |
| `No authentication token found` | `GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN` not set | Set both in `env:` |
| `Actor does not have write permissions` | User lacks repo write access | Grant access or set `ALLOWED_NON_WRITE_USERS` |

### Detailed Troubleshooting

#### 1. Actions Not Triggering

- [ ] Is Actions enabled in repo Settings?
- [ ] Is the workflow file on the default branch?
- [ ] Is the runner online and idle?
- [ ] Does `on:` include `issue_comment`?

#### 2. Runner Receives Task but Fails Immediately

Log shows: `Skipping unsupported platform -- Try running with -P ubuntu-latest=...`

Fix all three locations:
1. `docker-compose.yml` → `GITEA_RUNNER_LABELS`
2. `config.yaml` → `runner.labels`
3. `./runner/data/.runner` → `labels` (or delete the file)

Then: `docker restart act_runner`

#### 3. Comment Shows Only Status Line

**Cause**: MCP server can't start because `GITHUB_ACTION_PATH` points to a non-existent path.

**Check**: The Actions log should show `GITHUB_ACTION_PATH=/root/cca` and `[Gitea] Patched prompt...`.

#### 4. API Address Issues

| Deployment | `GITEA_API_URL` | `GITEA_SERVER_URL` |
|---|---|---|
| Same Docker network | `http://gitea:3000/api/v1` | `http://gitea:3000` |
| Runner on host | `http://localhost:3000/api/v1` | `http://localhost:3000` |
| Production (domain) | `https://gitea.company.com/api/v1` | `https://gitea.company.com` |

### Key Log Lines to Check

| Log Content | Meaning |
|---|---|
| `Bun version: x.x.x` | Bun installed successfully |
| `Cloned to: /root/cca` | Repo cloned successfully |
| `GITHUB_ACTION_PATH=/root/cca` | MCP server path is correct |
| `run-gitea.ts` in `ls` output | Gitea entry file exists |
| `[Gitea] Patched prompt...` | Prompt tool name fix applied |
| `[Gitea] Comment updated with status footer appended.` | Final comment update succeeded |

---

## Production Deployment Checklist

When migrating from test to production:

| Setting | Test | Production |
|---|---|---|
| `GITEA_API_URL` | `http://gitea:3000/api/v1` | `https://gitea.company.com/api/v1` |
| `GITEA_SERVER_URL` | `http://gitea:3000` | `https://gitea.company.com` |
| `CLAUDE_PAT` | Test account token | Service account token |
| `ANTHROPIC_API_KEY` | Test key | Production key |
| `ANTHROPIC_BASE_URL` | Test proxy | Production proxy |
| Container Network | `gitea-network` | Per actual network config |
| Clone URL | `hooxing/claude-code-action` | Internal fork URL |

---

## More Resources

- [Gitea Actions Docs](https://docs.gitea.com/usage/actions/overview)
- [Gitea API Docs](https://docs.gitea.com/development/api-usage)
- [Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code)
- [Original Claude Code Action (GitHub)](https://github.com/anthropics/claude-code-action)
- [中文使用指南](./gitea-usage-guide-zh.md)

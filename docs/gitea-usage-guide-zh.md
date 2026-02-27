# Claude Code Action for Gitea — 使用指南

本指南介绍如何在自托管的 [Gitea](https://gitea.com) 实例上使用 **Claude Code Action**。该 Action 允许 Claude 在 Issue 和 Pull Request 中响应 `@claude` 提及（Tag 模式），或通过 `prompt` 输入运行任务（Agent 模式），功能与 GitHub 版本一致——但完全运行在 Gitea 上。

---

## 目录

1. [前提条件](#前提条件)
2. [快速开始](#快速开始)
3. [架构概览](#架构概览)
4. [身份认证](#身份认证)
5. [工作流配置](#工作流配置)
   - [Tag 模式（交互式）](#tag-模式交互式)
   - [Agent 模式（自动化）](#agent-模式自动化)
6. [可用输入参数](#可用输入参数)
7. [可用输出参数](#可用输出参数)
8. [与 GitHub 版本的差异](#与-github-版本的差异)
9. [高级配置](#高级配置)
10. [故障排除](#故障排除)

---

## 前提条件

| 要求                          | 详情                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| **Gitea 版本**                | ≥ 1.19（需要 Gitea Actions 支持）                                         |
| **Gitea Actions Runner**      | 已注册并配置好的 `act_runner`                                             |
| **Anthropic API 密钥**        | 从 [console.anthropic.com](https://console.anthropic.com) 获取的 API 密钥 |
| **Gitea 个人访问令牌（PAT）** | 具有 `repo` 权限的令牌（或使用 Gitea Actions 内置提供的 `GITHUB_TOKEN`）  |
| **网络访问**                  | Runner 需要能够访问 `https://claude.ai`（安装 CLI）和 Anthropic API       |

### 配置 Gitea Actions

如果你还没有启用 Gitea Actions：

1. 在 `app.ini` 中确保：
   ```ini
   [actions]
   ENABLED = true
   ```
2. 注册 Runner：
   ```bash
   # 在 Runner 机器上执行
   act_runner register --instance https://your-gitea.example.com --token <runner-token>
   act_runner daemon
   ```
3. 你的 Gitea 实例现在应该可以接受 `.gitea/workflows/` 目录下的工作流文件。

---

## 快速开始

### 1. 配置密钥

> **注意**：Gitea 不允许密钥名称以 `GITEA_` 或 `GITHUB_` 开头。请使用 `CLAUDE_PAT` 等名称。

你可以在**用户级别**或**仓库级别**添加密钥：

- **用户级别密钥**：点击右上角**头像** → **设置** → **Actions** → **密钥**。这些密钥对你所有的仓库可用。
- **仓库级别密钥**：进入仓库 → **设置** → **Actions** → **密钥**。这些密钥仅对当前仓库可用。

添加以下密钥：

| 密钥名称            | 值                                                                  |
| ------------------- | ------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | 你的 Anthropic API 密钥                                             |
| `CLAUDE_PAT`        | 具有 `repo` 权限的 Gitea 个人访问令牌（如果内置令牌权限足够则可选） |

### 2. 创建工作流文件

创建 `.gitea/workflows/claude.yml`：

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
    runs-on: ubuntu-latest # 或你的自定义 Runner 标签
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

### 3. 试一试

在你的仓库中打开一个 Issue 或 PR，输入：

```
@claude 你能帮我理解这个代码库吗？
```

Claude 将创建一条跟踪评论并进行回复。

---

## 架构概览

```
┌────────────────────────────────────────┐
│         Gitea 实例                      │
│  ┌──────────────────────────────────┐  │
│  │   包含 @claude 的 Issue / PR     │  │
│  └──────────┬───────────────────────┘  │
│             │ webhook                  │
│  ┌──────────▼───────────────────────┐  │
│  │   Gitea Actions Runner           │  │
│  │   ┌────────────────────────────┐ │  │
│  │   │  Claude Code Action        │ │  │
│  │   │  (action-gitea.yml)        │ │  │
│  │   │                            │ │  │
│  │   │  1. 解析上下文              │ │  │
│  │   │  2. 获取 PR/Issue 数据     │ │  │
│  │   │     (Gitea REST API)       │ │  │
│  │   │  3. 创建跟踪评论           │ │  │
│  │   │  4. 运行 Claude Code CLI   │ │  │
│  │   │  5. 推送更改 / 回复        │ │  │
│  │   └────────────────────────────┘ │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
                    │
                    │ API 调用
                    ▼
           ┌───────────────┐
           │ Anthropic API  │
           │  (Claude)      │
           └───────────────┘
```

该 Action 的工作流程：

1. **解析** Gitea Actions webhook 负载（与 GitHub Actions 格式兼容）。
2. **认证** 使用 PAT 或内置工作流令牌访问 Gitea REST API。
3. **获取** Issue/PR 数据、评论、文件更改（通过 Gitea REST API，无需 GraphQL）。
4. **构建** 包含所有上下文的 Claude 提示词。
5. **运行** Claude Code CLI，读取仓库、修改代码并推送提交。
6. **更新** 跟踪评论中的结果。

---

## 身份认证

### Gitea 令牌

该 Action 使用 Gitea 个人访问令牌（PAT）进行所有 API 操作。提供令牌有三种方式（按优先级排列）：

1. **`gitea_token` 输入**（推荐）：在工作流文件中通过密钥设置。
2. **`GITEA_TOKEN` 环境变量**：在 Runner 环境中设置。
3. **内置 `GITHUB_TOKEN`**：Gitea Actions 自动注入的兼容 GitHub Actions 格式的令牌。

> **注意**：与 GitHub 版本不同，这里没有基于 OIDC 的令牌交换。Gitea 使用直接的令牌认证。

### 创建 Gitea PAT

1. 点击右上角**头像** → **设置** → **应用**。
2. 在**管理访问令牌**下，创建新令牌：
   - **令牌名称**：`claude-code-action`
   - **权限范围**：选择 `repo`（完整仓库访问）
3. 复制生成的令牌，将其作为密钥存储。

### Anthropic API 密钥

Claude Code CLI 需要 Anthropic 认证：

- **`anthropic_api_key`**：直接使用 Anthropic API 密钥。
- **`anthropic_base_url`**：可选，自定义 Anthropic API Base URL（用于 API 代理或自定义端点）。也可以通过 `ANTHROPIC_BASE_URL` 环境变量设置。
- **`claude_code_oauth_token`**：OAuth 令牌（替代方案）。
- **Bedrock/Vertex**：云提供商认证（将 `use_bedrock` 或 `use_vertex` 设置为 `true`）。

---

## 工作流配置

### Tag 模式（交互式）

Tag 模式响应用户交互——评论中的 `@claude` 提及、Issue 分配或标签触发。

#### 示例：响应 @claude 提及

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

#### 示例：通过标签触发

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

#### 示例：通过指派触发

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

### Agent 模式（自动化）

当提供了明确的 `prompt` 输入时，Agent 模式会直接运行，跳过提及检查。

#### 示例：自动审查 PR

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
            审查这个 Pull Request，检查：
            - 代码质量问题
            - 潜在的 Bug
            - 安全漏洞
            在评论中提供你的审查结果摘要。
```

#### 示例：定时自动修复

```yaml
name: Claude Daily Fix
on:
  schedule:
    - cron: "0 9 * * 1" # 每周一上午 9 点

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
            查找代码库中的所有 TODO 注释，
            并尝试解决它们。创建一个包含修复的分支。
```

---

## 可用输入参数

| 输入参数                         | 默认值       | 描述                                         |
| -------------------------------- | ------------ | -------------------------------------------- |
| `trigger_phrase`                 | `@claude`    | 在评论或正文中查找的触发短语                 |
| `assignee_trigger`               | —            | 触发 Action 的指派人用户名                   |
| `label_trigger`                  | `claude`     | 触发 Action 的标签                           |
| `base_branch`                    | （默认分支） | 创建新分支时用作基础的分支                   |
| `branch_prefix`                  | `claude/`    | Claude 创建的分支的前缀                      |
| `branch_name_template`           | —            | 分支命名模板（见下文）                       |
| `allowed_bots`                   | —            | 允许的机器人用户名（逗号分隔），`*` 表示全部 |
| `allowed_non_write_users`        | —            | 无需写权限即可使用的用户                     |
| `include_comments_by_actor`      | —            | 包含特定评论者的过滤器                       |
| `exclude_comments_by_actor`      | —            | 排除特定评论者的过滤器                       |
| `prompt`                         | —            | Claude 的直接提示词（启用 Agent 模式）       |
| `settings`                       | —            | Claude Code 设置 JSON 或文件路径             |
| `anthropic_api_key`              | —            | Anthropic API 密钥                           |
| `anthropic_base_url`             | —            | 自定义 Anthropic API Base URL（用于代理等）  |
| `claude_code_oauth_token`        | —            | OAuth 令牌替代方案                           |
| `gitea_token`                    | —            | 具有 repo 权限的 Gitea PAT                   |
| `use_bedrock`                    | `false`      | 使用 Amazon Bedrock                          |
| `use_vertex`                     | `false`      | 使用 Google Vertex AI                        |
| `claude_args`                    | —            | 传递给 Claude CLI 的额外参数                 |
| `use_sticky_comment`             | `false`      | 使用单一跟踪评论                             |
| `ssh_signing_key`                | —            | 用于签名提交的 SSH 私钥                      |
| `bot_id`                         | `0`          | git 操作使用的用户 ID                        |
| `bot_name`                       | `claude-bot` | git 操作使用的用户名                         |
| `track_progress`                 | `false`      | 强制使用 Tag 模式并显示跟踪评论              |
| `include_fix_links`              | `true`       | 在 PR 代码审查反馈中包含"修复此问题"链接     |
| `path_to_claude_code_executable` | —            | 自定义 Claude Code 可执行文件路径            |
| `display_report`                 | `true`       | 在步骤摘要中显示报告                         |
| `show_full_output`               | `false`      | 显示 Claude 的完整输出（可能包含密钥）       |
| `plugins`                        | —            | 要安装的插件名称                             |
| `plugin_marketplaces`            | —            | 插件市场 URL                                 |
| `gitea_api_url`                  | —            | 自定义 Gitea API 基础 URL                    |
| `gitea_server_url`               | —            | 自定义 Gitea 服务器 URL                      |

### 分支名称模板变量

| 变量               | 描述                              |
| ------------------ | --------------------------------- |
| `{{prefix}}`       | `branch_prefix` 的值              |
| `{{entityType}}`   | `issue` 或 `pr`                   |
| `{{entityNumber}}` | Issue/PR 编号                     |
| `{{timestamp}}`    | 当前 Unix 时间戳                  |
| `{{sha}}`          | 源分支的短 SHA                    |
| `{{label}}`        | 第一个标签，或实体类型作为回退    |
| `{{description}}`  | 标题前 5 个单词的 kebab-case 格式 |

---

## 可用输出参数

| 输出参数            | 描述                                       |
| ------------------- | ------------------------------------------ |
| `execution_file`    | Claude 执行输出文件的路径                  |
| `branch_name`       | Claude 创建的分支                          |
| `gitea_token`       | Action 使用的令牌                          |
| `structured_output` | JSON 结构化输出（使用 `--json-schema` 时） |
| `session_id`        | 用于恢复对话的会话 ID                      |

---

## 与 GitHub 版本的差异

| 功能             | GitHub 版本                 | Gitea 版本                        |
| ---------------- | --------------------------- | --------------------------------- |
| **身份认证**     | OIDC + GitHub App 令牌交换  | 个人访问令牌（PAT）               |
| **数据获取**     | GraphQL API                 | 仅 REST API                       |
| **API 提交签名** | 支持 (`use_commit_signing`) | 不支持（使用 SSH 签名或标准 git） |
| **CI 状态集成**  | GitHub Actions 工作流状态   | 暂不支持                          |
| **文件操作服务** | 基于 API 的提交/推送        | 标准 git 命令                     |
| **图片下载**     | 从 GitHub URL 下载          | 暂不支持                          |
| **令牌撤销**     | 自动（GitHub App）          | 不需要（PAT）                     |
| **Action 格式**  | `action.yml`（组合式）      | `action-gitea.yml`（组合式）      |
| **行内审查评论** | 通过 MCP 服务器支持         | 暂不支持                          |

---

## 高级配置

### 使用 Amazon Bedrock

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

### 使用 Google Vertex AI

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

### SSH 提交签名

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    ssh_signing_key: ${{ secrets.SSH_SIGNING_KEY }}
```

### 自定义机器人身份

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    bot_name: "my-claude-bot"
    bot_id: "12345"
```

### 自定义 Gitea 服务器 URL

你可以直接通过 Action 输入参数提供自定义 Gitea URL（推荐）：

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    gitea_token: ${{ secrets.CLAUDE_PAT }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    gitea_api_url: https://your-gitea.example.com/api/v1
    gitea_server_url: https://your-gitea.example.com
```

或者在工作流中设置环境变量：

```yaml
env:
  GITEA_API_URL: https://your-gitea.example.com/api/v1
  GITEA_SERVER_URL: https://your-gitea.example.com
```

也可以在 Action 运行前在 Runner 环境中设置这些变量。

### 自定义 Anthropic API Base URL

你可以直接通过 Action 输入参数设置自定义 Anthropic API Base URL（推荐）。这在使用 API 代理、自托管兼容端点或提供 Anthropic 模型访问的第三方服务时非常有用：

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    anthropic_base_url: ${{ secrets.ANTHROPIC_BASE_URL }}
    gitea_token: ${{ secrets.CLAUDE_PAT }}
```

也可以在工作流中通过环境变量设置：

```yaml
- uses: anthropics/claude-code-action/action-gitea.yml@main
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    gitea_token: ${{ secrets.CLAUDE_PAT }}
  env:
    ANTHROPIC_BASE_URL: https://your-proxy.example.com
```

> **安全提示**：如果 Base URL 包含敏感信息，建议将其存储为密钥（如 `secrets.ANTHROPIC_BASE_URL`）。

---

## 故障排除

### 常见问题

#### "No authentication token found"（未找到认证令牌）

**原因**：`gitea_token`、`GITEA_TOKEN`、`OVERRIDE_GITHUB_TOKEN` 和 `GITHUB_TOKEN` 均未设置。

**解决方法**：添加 `gitea_token` 输入，指向包含 Gitea PAT 的密钥：

```yaml
with:
  gitea_token: ${{ secrets.CLAUDE_PAT }}
```

#### "Actor does not have write permissions"（操作者没有写权限）

**原因**：触发 Action 的用户没有仓库的写入权限。

**解决方法**：授予用户写入权限，或使用 `allowed_non_write_users`：

```yaml
with:
  allowed_non_write_users: "username1,username2"
```

#### "Failed to fetch PR/Issue data from Gitea"（从 Gitea 获取 PR/Issue 数据失败）

**原因**：Gitea 令牌没有读取仓库的权限，或 API URL 不正确。

**解决方法**：

1. 验证你的 PAT 具有 `repo` 权限范围。
2. 检查 `GITEA_API_URL` 是否指向正确的端点（例如 `https://your-gitea.example.com/api/v1`）。
3. 如果使用自托管 Gitea，确保通过 `gitea_api_url` 和 `gitea_server_url` 输入参数设置了正确的 URL。

#### "Install failed"（安装失败）— Claude Code CLI

**原因**：Runner 无法访问 `https://claude.ai` 下载 CLI。

**解决方法**：

1. 确保 Runner 有网络访问权限。
2. 或者预先安装 Claude Code 并使用 `path_to_claude_code_executable`。

#### 分支创建失败

**原因**：Gitea 令牌可能没有创建分支的权限。

**解决方法**：确保 PAT 具有完整的 `repo` 权限范围，且仓库允许该用户创建分支。

### 调试

启用详细输出进行调试：

```yaml
with:
  show_full_output: "true"
```

> ⚠️ **警告**：这可能会在日志中暴露敏感信息。仅在调试时使用。

---

## 完整示例工作流

以下是一个处理多种事件类型的完整示例：

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
    # 仅对交互事件运行（评论、审查）
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
    # 自动审查新 PR
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action/action-gitea.yml@main
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          gitea_token: ${{ secrets.CLAUDE_PAT }}
          prompt: "审查这个 PR 的代码质量、潜在 Bug 和安全问题。"
```

---

## 更多资源

- [Gitea Actions 文档](https://docs.gitea.com/usage/actions/overview)
- [Gitea API 文档](https://docs.gitea.com/development/api-usage)
- [Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code)
- [原版 Claude Code Action（GitHub）](https://github.com/anthropics/claude-code-action)
- [英文使用指南](./gitea-usage-guide.md)

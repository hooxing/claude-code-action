# Claude Code Action for Gitea — 使用指南

本指南介绍如何在自托管的 [Gitea](https://gitea.com) 实例上使用 **Claude Code Action**。该 Action 允许 Claude 在 Issue 和 Pull Request 中响应 `@claude` 提及（Tag 模式），或通过 `prompt` 输入运行任务（Agent 模式），功能与 GitHub 版本一致——但完全运行在 Gitea 上。

---

## 目录

1. [前提条件](#前提条件)
2. [快速开始（完整部署步骤）](#快速开始完整部署步骤)
3. [act_runner Docker 配置](#act_runner-docker-配置)
4. [工作流文件写法（内联模式）](#工作流文件写法内联模式)
5. [架构概览](#架构概览)
6. [身份认证](#身份认证)
7. [工作流配置示例](#工作流配置示例)
   - [Tag 模式（交互式）](#tag-模式交互式)
   - [Agent 模式（自动化）](#agent-模式自动化)
8. [可用输入参数](#可用输入参数)
9. [可用输出参数](#可用输出参数)
10. [与 GitHub 版本的差异](#与-github-版本的差异)
11. [高级配置](#高级配置)
12. [故障排除](#故障排除)

---

## 前提条件

| 要求                          | 详情                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| **Gitea 版本**                | ≥ 1.19（需要 Gitea Actions 支持）                                         |
| **Gitea Actions Runner**      | 已注册并配置好的 `act_runner`，使用 Docker 模式运行                        |
| **Anthropic API 密钥**        | 从 [console.anthropic.com](https://console.anthropic.com) 获取的 API 密钥 |
| **Gitea 个人访问令牌（PAT）** | 具有 `repo` 权限的令牌                                                    |
| **网络访问**                  | Runner 需要能够访问 Anthropic API 和 npm/bun 包仓库                       |
| **Docker**                    | Runner 所在机器需要安装 Docker                                            |

### 配置 Gitea Actions

如果你还没有启用 Gitea Actions：

1. 在 `app.ini` 中确保：
   ```ini
   [actions]
   ENABLED = true
   ```
2. 重启 Gitea 服务。

---

## 快速开始（完整部署步骤）

> **本节涵盖从零开始的完整部署流程**，包括 Gitea 配置、Runner 安装、密钥设置和工作流创建。

### 第 1 步：配置密钥

> **注意**：Gitea 不允许密钥名称以 `GITEA_` 或 `GITHUB_` 开头。请使用下表中的名称。

你可以在**用户级别**或**仓库级别**添加密钥：

- **用户级别密钥**：点击右上角**头像** → **设置** → **Actions** → **密钥**。这些密钥对你所有的仓库可用。
- **仓库级别密钥**：进入仓库 → **设置** → **Actions** → **密钥**。这些密钥仅对当前仓库可用。

添加以下密钥：

| 密钥名称              | 值                                                                                |
| --------------------- | --------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | 你的 Anthropic API 密钥                                                           |
| `CLAUDE_PAT`          | 具有 `repo` 权限的 Gitea 个人访问令牌                                             |
| `ANTHROPIC_BASE_URL`  | （可选）自定义 Anthropic API 代理地址，如 `https://your-proxy.example.com`         |

### 第 2 步：注册并配置 act_runner

> **这是最容易出错的一步。** 请严格按照本节操作。详细配置请参考 [act_runner Docker 配置](#act_runner-docker-配置)。

#### 使用 Docker Compose 部署（推荐）

下面是一个完整的 `docker-compose.yml` 示例，包含 Gitea 和 act_runner：

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
      GITEA_RUNNER_REGISTRATION_TOKEN: <你的runner注册令牌>
      # ⚠️ 关键：labels 必须包含完整的 Docker 镜像地址
      GITEA_RUNNER_LABELS: "ubuntu-latest:docker://node:20-bullseye"
      CONFIG_FILE: /config.yaml
    restart: unless-stopped
    networks:
      - gitea-network

networks:
  gitea-network:
    driver: bridge
```

> **⚠️ 重要**：`GITEA_RUNNER_LABELS` 格式必须是 `<label>:docker://<image>`，例如 `ubuntu-latest:docker://node:20-bullseye`。
> 如果只写 `ubuntu-latest:docker`（不含镜像地址），Runner 将无法处理任务，报错 `Skipping unsupported platform`。

#### act_runner config.yaml

在 `./runner/config/` 目录下创建 `config.yaml`：

```yaml
# act_runner 配置文件
log:
  level: info

runner:
  # 并发任务数
  capacity: 1
  # 超时时间
  timeout: 3600s
  # labels 映射
  labels:
    - "ubuntu-latest:docker://node:20-bullseye"

container:
  # ⚠️ 关键：网络名称必须与 docker-compose 中的网络一致
  # 这样容器才能通过 "gitea" 主机名访问 Gitea
  network: "gitea-network"
  # Docker 主机
  docker_host: ""
  privileged: false
  options:
  workdir_parent:
```

> **为什么使用 `node:20-bullseye` 而不是 `ubuntu-latest`？**
>
> `act_runner` 使用 Docker 运行 Job，需要一个真实的 Docker 镜像。`ubuntu-latest` 只是一个标签名，不是 Docker 镜像。`node:20-bullseye` 提供了完整的 Node.js 环境和 Debian 系统工具。

#### 获取 Runner 注册令牌

1. 登录 Gitea → **站点管理** → **Actions** → **Runner**。
2. 点击 **创建 Runner** 获取注册令牌。
3. 将令牌填入 `docker-compose.yml` 的 `GITEA_RUNNER_REGISTRATION_TOKEN`。

#### 启动服务

```bash
docker compose up -d
```

检查 Runner 状态：
```bash
docker logs act_runner
```

确认看到类似输出：
```
Runner registered successfully.
```

在 Gitea → **站点管理** → **Actions** → **Runner** 中确认 Runner 为**在线（Idle）**状态。

> **⚠️ .runner 缓存文件注意事项**：
>
> Runner 首次注册后会在 `./runner/data/` 下生成 `.runner` 缓存文件。如果你后续修改了 `GITEA_RUNNER_LABELS`，**必须同时更新 `.runner` 文件中的 `labels` 字段**，或者删除 `.runner` 文件让 Runner 重新注册。否则 Runner 仍会使用旧的 labels。

### 第 3 步：Fork claude-code-action 仓库

> **⚠️ 重要**：官方 `anthropics/claude-code-action` 仓库**不包含** Gitea 入口文件 `run-gitea.ts`。你必须使用包含该文件的 Fork 仓库。

1. Fork [hooxing/claude-code-action](https://github.com/hooxing/claude-code-action) 到你的 GitHub 账号（或直接使用此 Fork）。
2. 确认 Fork 中包含 `src/entrypoints/run-gitea.ts` 文件。
3. 在后续工作流中，将 clone 地址指向你的 Fork。

### 第 4 步：创建工作流文件

> **⚠️ 重要**：`act_runner` 与 GitHub Actions runner 有一些行为差异。最关键的是：
> - **不能使用 `uses: repo/action-gitea.yml@main` 这种写法**来引用根目录下的 YAML 文件（会报 `action.yml not found`）。
> - 必须使用**内联模式**：在 `run:` 中手动 clone、安装依赖、执行脚本。

在仓库中创建 `.gitea/workflows/claude.yml`：

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

          # 1. 安装 Bun（TypeScript 运行时）
          echo "=== Installing Bun ==="
          curl -fsSL https://bun.sh/install | bash
          export BUN_PATH="$HOME/.bun/bin"
          export PATH="$BUN_PATH:$PATH"
          echo "Bun version: $(bun --version)"

          # 2. 克隆 claude-code-action（使用包含 run-gitea.ts 的 Fork）
          echo "=== Cloning claude-code-action ==="
          CCA_DIR="$HOME/cca"
          git clone --depth 1 https://github.com/hooxing/claude-code-action "$CCA_DIR"
          echo "Cloned to: $CCA_DIR"
          ls "$CCA_DIR/src/entrypoints/"

          # ⚠️ 关键：设置 GITHUB_ACTION_PATH 为实际 clone 路径
          # MCP 服务器脚本（gitea-comment-server.ts）需要这个路径来定位自身
          export GITHUB_ACTION_PATH="$CCA_DIR"
          echo "GITHUB_ACTION_PATH=$GITHUB_ACTION_PATH"

          # 3. 安装依赖
          echo "=== Installing dependencies ==="
          cd "$CCA_DIR"
          bun install --production

          # 4. 运行 Gitea 入口脚本
          echo "=== Running Claude Code Action ==="
          bun run "$CCA_DIR/src/entrypoints/run-gitea.ts"
        env:
          # Gitea API 地址
          # ⚠️ 如果 Runner 和 Gitea 在同一 Docker 网络中，使用容器名
          #    如果 Runner 在宿主机上，使用 localhost 或实际域名
          GITEA_API_URL: http://gitea:3000/api/v1
          GITEA_SERVER_URL: http://gitea:3000

          # 身份认证
          GITEA_TOKEN: ${{ secrets.CLAUDE_PAT }}
          OVERRIDE_GITHUB_TOKEN: ${{ secrets.CLAUDE_PAT }}

          # 触发配置
          TRIGGER_PHRASE: "@claude"
          LABEL_TRIGGER: "claude"
          ASSIGNEE_TRIGGER: ""
          TRACK_PROGRESS: "true"

          # 机器人身份
          BOT_NAME: "claude-bot"
          BOT_ID: "0"

          # 分支设置
          BRANCH_PREFIX: "claude/"
          BRANCH_NAME_TEMPLATE: ""
          BASE_BRANCH: ""

          # 评论/过滤设置
          USE_STICKY_COMMENT: "false"
          INCLUDE_FIX_LINKS: "true"
          ALLOWED_BOTS: ""
          ALLOWED_NON_WRITE_USERS: ""
          INCLUDE_COMMENTS_BY_ACTOR: ""
          EXCLUDE_COMMENTS_BY_ACTOR: ""

          # Claude CLI 参数
          CLAUDE_ARGS: ""
          PROMPT: ""

          # Base-action 必需输入
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

### 第 5 步：提交并测试

1. 将 `.gitea/workflows/claude.yml` 提交到仓库的默认分支。
2. 在仓库的 **设置 → Actions** 中确认 Actions 已启用。
3. 创建一个 Issue，评论：
   ```
   @claude 你好，请介绍一下你的能力。
   ```
4. 等待几秒钟，你应该看到 Claude 创建了一条跟踪评论并开始回复。

---

## act_runner Docker 配置

### 完整配置要点

| 配置项 | 正确写法 | 错误写法 | 说明 |
|---|---|---|---|
| Runner Labels | `ubuntu-latest:docker://node:20-bullseye` | `ubuntu-latest:docker` | 必须包含完整的 Docker 镜像地址 |
| Container Network | `gitea-network`（与 compose 一致） | 留空 | Runner 容器需要能访问 Gitea |
| Docker Socket | `/var/run/docker.sock` 挂载 | 不挂载 | Runner 需要调用 Docker API |
| config.yaml | 通过 `CONFIG_FILE` 指定 | 不使用 | 确保 labels 和网络正确 |

### .runner 缓存文件

Runner 首次注册时会生成 `.runner` 文件（JSON 格式），其中缓存了 labels 等配置。

如果修改了 labels **但没有更新 `.runner`**，Runner 会使用旧的配置。解决方法：

```bash
# 方法 1：删除 .runner 文件，让 Runner 重新注册
rm ./runner/data/.runner
docker restart act_runner

# 方法 2：手动编辑 .runner 文件
# 找到 "labels" 字段，更新为新的值
```

`.runner` 文件中的 labels 格式示例：

```json
{
  "labels": [
    "ubuntu-latest:docker://node:20-bullseye"
  ]
}
```

---

## 工作流文件写法（内联模式）

### 为什么不能使用 `uses:` 引用 action-gitea.yml？

在 GitHub Actions 中，可以这样引用 Action：

```yaml
uses: anthropics/claude-code-action/action-gitea.yml@main
```

但在 `act_runner` 中，这种写法会报错：

```
action.yml not found in action-gitea.yml/
```

原因是 `act_runner` 在处理 `uses:` 时，会将路径视为目录，并在其中查找 `action.yml` 文件。它不支持直接引用根目录下的 YAML 文件。

### 内联模式的核心原则

1. **在 `run:` 脚本中手动 clone 仓库**，而非 `uses:`。
2. **所有操作必须在同一个 `run:` 块中完成**（clone、安装、运行），因为 act_runner 中不同 step 的 `/tmp` 目录是隔离的，跨步骤的临时文件不会保留。
3. **`GITHUB_ACTION_PATH` 必须在 run 脚本中动态设置**（`export GITHUB_ACTION_PATH="$CCA_DIR"`），不能放在 `env:` 中使用 `${{ runner.temp }}`，因为：
   - 实际 clone 路径是 `$HOME/cca`（即 `/root/cca`）
   - `runner.temp` 指向的是另一个目录
   - MCP 服务器脚本路径依赖 `GITHUB_ACTION_PATH`，路径不一致会导致 Claude 无法更新评论

### 完整工作流模板

参见上文 [第 4 步：创建工作流文件](#第-4-步创建工作流文件) 中的完整模板。

### 环境变量说明

工作流 `env:` 中的环境变量分为以下几类：

| 类别 | 变量 | 说明 |
|---|---|---|
| **Gitea API** | `GITEA_API_URL`, `GITEA_SERVER_URL` | Gitea 实例地址。Docker 同网络用容器名，宿主机用 localhost |
| **认证** | `GITEA_TOKEN`, `OVERRIDE_GITHUB_TOKEN` | 两个都设为 `${{ secrets.CLAUDE_PAT }}` |
| **触发** | `TRIGGER_PHRASE`, `LABEL_TRIGGER`, `ASSIGNEE_TRIGGER` | 触发 Claude 的关键词和方式 |
| **机器人** | `BOT_NAME`, `BOT_ID` | Claude Bot 的身份信息 |
| **分支** | `BRANCH_PREFIX`, `BRANCH_NAME_TEMPLATE`, `BASE_BRANCH` | Claude 创建分支的命名规则 |
| **Anthropic** | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | API 认证和代理地址 |

> **网络地址说明**：
> - Runner 和 Gitea 在**同一 Docker 网络**中时：用 `http://gitea:3000`（容器名）
> - Runner 在**宿主机**上时：用 `http://localhost:3000` 或实际域名
> - 部署到**公司正式环境**时：用实际的域名，如 `https://gitea.company.com`

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
│  │   │  (run-gitea.ts)            │ │  │
│  │   │                            │ │  │
│  │   │  1. 解析上下文              │ │  │
│  │   │  2. 获取 PR/Issue 数据     │ │  │
│  │   │     (Gitea REST API)       │ │  │
│  │   │  3. 创建跟踪评论           │ │  │
│  │   │  4. 运行 Claude Code CLI   │ │  │
│  │   │  5. 通过 MCP 更新评论      │ │  │
│  │   │  6. 推送更改 / 回复        │ │  │
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
2. **认证** 使用 PAT 访问 Gitea REST API。
3. **获取** Issue/PR 数据、评论、文件更改（通过 Gitea REST API，无需 GraphQL）。
4. **构建** 包含所有上下文的 Claude 提示词。
5. **运行** Claude Code CLI，读取仓库、修改代码并推送提交。
6. **通过 MCP 服务器**更新跟踪评论中的结果。

---

## 身份认证

### Gitea 令牌

该 Action 使用 Gitea 个人访问令牌（PAT）进行所有 API 操作。提供令牌有三种方式（按优先级排列）：

1. **`GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN` 环境变量**（推荐，内联模式）。
2. **`gitea_token` 输入**：在 `uses:` 模式中通过密钥设置。
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

- **`ANTHROPIC_API_KEY`**：直接使用 Anthropic API 密钥。
- **`ANTHROPIC_BASE_URL`**：可选，自定义 Anthropic API Base URL（用于 API 代理或自定义端点）。
- **Bedrock/Vertex**：云提供商认证（设置 `use_bedrock` 或 `use_vertex` 为 `true`）。

---

## 工作流配置示例

### Tag 模式（交互式）

Tag 模式响应用户交互——评论中的 `@claude` 提及、Issue 分配或标签触发。

以下示例均使用内联模式写法。你只需修改 `env:` 中对应的触发条件即可。

#### 通过 @claude 提及触发（默认）

```yaml
env:
  TRIGGER_PHRASE: "@claude"
```

#### 通过标签触发

```yaml
env:
  TRIGGER_PHRASE: ""
  LABEL_TRIGGER: "claude-task"
```

#### 通过指派触发

```yaml
env:
  TRIGGER_PHRASE: ""
  ASSIGNEE_TRIGGER: "@claude-bot"
```

### Agent 模式（自动化）

当设置了 `PROMPT` 环境变量时，将进入 Agent 模式，跳过提及检查直接运行。

#### 自动审查 PR

```yaml
on:
  pull_request:
    types: [opened, synchronize]

# 在 env 中添加：
env:
  PROMPT: |
    审查这个 Pull Request，检查：
    - 代码质量问题
    - 潜在的 Bug
    - 安全漏洞
    在评论中提供你的审查结果摘要。
```

---

## 可用输入参数

> **注意**：在内联模式下，这些参数通过 `env:` 环境变量传递，变量名需要全大写并使用下划线。

| 参数                             | 环境变量名                               | 默认值       | 描述                                         |
| -------------------------------- | ---------------------------------------- | ------------ | -------------------------------------------- |
| `trigger_phrase`                 | `TRIGGER_PHRASE`                         | `@claude`    | 在评论或正文中查找的触发短语                 |
| `assignee_trigger`               | `ASSIGNEE_TRIGGER`                       | —            | 触发 Action 的指派人用户名                   |
| `label_trigger`                  | `LABEL_TRIGGER`                          | `claude`     | 触发 Action 的标签                           |
| `base_branch`                    | `BASE_BRANCH`                            | （默认分支） | 创建新分支时用作基础的分支                   |
| `branch_prefix`                  | `BRANCH_PREFIX`                          | `claude/`    | Claude 创建的分支的前缀                      |
| `branch_name_template`           | `BRANCH_NAME_TEMPLATE`                   | —            | 分支命名模板                                 |
| `allowed_bots`                   | `ALLOWED_BOTS`                           | —            | 允许的机器人用户名（逗号分隔），`*` 表示全部 |
| `allowed_non_write_users`        | `ALLOWED_NON_WRITE_USERS`                | —            | 无需写权限即可使用的用户                     |
| `prompt`                         | `PROMPT`                                 | —            | Claude 的直接提示词（启用 Agent 模式）       |
| `anthropic_api_key`              | `ANTHROPIC_API_KEY`                      | —            | Anthropic API 密钥                           |
| `anthropic_base_url`             | `ANTHROPIC_BASE_URL`                     | —            | 自定义 API Base URL（用于代理等）            |
| `gitea_token`                    | `GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN`  | —            | 具有 repo 权限的 Gitea PAT                   |
| `use_bedrock`                    | —                                        | `false`      | 使用 Amazon Bedrock                          |
| `use_vertex`                     | —                                        | `false`      | 使用 Google Vertex AI                        |
| `claude_args`                    | `CLAUDE_ARGS`                            | —            | 传递给 Claude CLI 的额外参数                 |
| `bot_id`                         | `BOT_ID`                                 | `0`          | git 操作使用的用户 ID                        |
| `bot_name`                       | `BOT_NAME`                               | `claude-bot` | git 操作使用的用户名                         |
| `track_progress`                 | `TRACK_PROGRESS`                         | `false`      | 强制使用 Tag 模式并显示跟踪评论              |
| `include_fix_links`              | `INCLUDE_FIX_LINKS`                      | `true`       | 在 PR 审查中包含"修复此问题"链接             |
| `display_report`                 | `DISPLAY_REPORT`                         | `true`       | 在步骤摘要中显示报告                         |

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

| 功能             | GitHub 版本                 | Gitea 版本                               |
| ---------------- | --------------------------- | ---------------------------------------- |
| **身份认证**     | OIDC + GitHub App 令牌交换  | 个人访问令牌（PAT）                       |
| **数据获取**     | GraphQL API                 | 仅 REST API                               |
| **API 提交签名** | 支持 (`use_commit_signing`) | 不支持（使用 SSH 签名或标准 git）          |
| **CI 状态集成**  | GitHub Actions 工作流状态   | 暂不支持                                  |
| **文件操作服务** | 基于 API 的提交/推送        | 标准 git 命令                              |
| **图片下载**     | 从 GitHub URL 下载          | 暂不支持                                  |
| **令牌撤销**     | 自动（GitHub App）          | 不需要（PAT）                              |
| **Action 引用**  | `uses: repo/action.yml@ref` | 不支持，需使用内联模式                     |
| **行内审查评论** | 通过 MCP 服务器支持         | 暂不支持                                  |
| **评论更新**     | `mcp__github_comment__`     | `mcp__gitea_comment__`（自动替换）         |
| **入口文件**     | `run.ts`                    | `run-gitea.ts`（仅在 Fork 中提供）        |

---

## 高级配置

### 使用 Amazon Bedrock

在 `env:` 中添加：

```yaml
env:
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

### 使用 Google Vertex AI

在 `env:` 中添加：

```yaml
env:
  ANTHROPIC_VERTEX_PROJECT_ID: my-gcp-project
  CLOUD_ML_REGION: us-central1
  GOOGLE_APPLICATION_CREDENTIALS: /path/to/credentials.json
```

### 自定义 Gitea 服务器 URL

```yaml
env:
  GITEA_API_URL: https://your-gitea.example.com/api/v1
  GITEA_SERVER_URL: https://your-gitea.example.com
```

### 自定义 Anthropic API Base URL

```yaml
env:
  ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
```

> **安全提示**：如果 Base URL 包含敏感信息，建议将其存储为密钥。

---

## 故障排除

### 错误速查表

| 错误信息 | 原因 | 解决方法 |
|---|---|---|
| `Skipping unsupported platform` | Runner labels 只写了 `ubuntu-latest:docker`，缺少镜像地址 | 改为 `ubuntu-latest:docker://node:20-bullseye`，同时更新 `.runner` 缓存文件或删除让其重新生成 |
| `action.yml not found in action-gitea.yml/` | `act_runner` 不支持 `uses: repo/file.yml@ref` 引用根目录 YAML | 改用内联模式写法（见上文工作流模板） |
| `Module not found "run-gitea.ts"` | 克隆了 `anthropics/claude-code-action`（不含 Gitea 入口文件） | 改为克隆包含 `run-gitea.ts` 的 Fork 仓库 |
| Claude 评论为空或只显示 "✅ has finished" | `GITHUB_ACTION_PATH` 路径与实际 clone 路径不一致，MCP 服务器启动失败 | 在 run 脚本中 `export GITHUB_ACTION_PATH="$CCA_DIR"`，不要放在 `env:` 中 |
| `No authentication token found` | `GITEA_TOKEN` / `OVERRIDE_GITHUB_TOKEN` 未设置 | 在 `env:` 中同时设置两者 |
| `Actor does not have write permissions` | 触发用户没有仓库写入权限 | 授予写入权限，或设置 `ALLOWED_NON_WRITE_USERS` |
| `Failed to fetch PR/Issue data` | PAT 无 `repo` 权限 或 API URL 错误 | 检查 PAT 权限和 `GITEA_API_URL` |
| Runner 处于在线但不执行任务 | Actions 未在仓库中启用 | 仓库 → 设置 → Actions → 启用 |

### 详细排查指南

#### 1. Actions 不触发

**症状**：发送 `@claude` 评论后 Runner 无运行记录。

**检查清单**：

- [ ] 仓库 → 设置 → Actions 是否已启用
- [ ] `.gitea/workflows/claude.yml` 是否在默认分支上
- [ ] Runner 是否显示为**在线（Idle）**状态
- [ ] 工作流文件中的 `on:` 事件是否包含 `issue_comment`

#### 2. Runner 收到任务但立即失败

**症状**：日志显示 `Skipping unsupported platform -- Try running with -P ubuntu-latest=...`

**根因**：Runner labels 格式不正确。

**必须同时修改三个位置**：

1. `docker-compose.yml` 中的 `GITEA_RUNNER_LABELS`
2. `config.yaml` 中的 `runner.labels`
3. `./runner/data/.runner` 中的 `labels` 字段（或删除此文件重新注册）

修改后重启 Runner：

```bash
docker restart act_runner
```

#### 3. Claude 评论只显示状态行

**症状**：评论只有 "✅ Claude Code has finished working on this."，没有 Claude 的实际回复。

**根因**：MCP 服务器无法启动，Claude 无法通过 MCP 工具更新评论。

**检查**：

1. 确认 `GITHUB_ACTION_PATH` 是否在 `run:` 脚本中动态设置（`export GITHUB_ACTION_PATH="$CCA_DIR"`）。
2. 确认 clone 路径和 `GITHUB_ACTION_PATH` 一致（都应该是 `$HOME/cca`，即 `/root/cca`）。
3. 查看 Actions 日志中是否有 `[Gitea] Patched prompt: replaced mcp__github_comment__ → mcp__gitea_comment__` 输出。

#### 4. API 地址问题

**症状**：获取 Issue 或评论失败。

**常见场景和正确地址**：

| 部署场景 | `GITEA_API_URL` | `GITEA_SERVER_URL` |
|---|---|---|
| Runner 和 Gitea 在同一 Docker 网络 | `http://gitea:3000/api/v1` | `http://gitea:3000` |
| Runner 在宿主机 | `http://localhost:3000/api/v1` | `http://localhost:3000` |
| 正式环境（域名） | `https://gitea.company.com/api/v1` | `https://gitea.company.com` |

### 调试

启用详细输出进行调试：

```yaml
env:
  INPUT_SHOW_FULL_OUTPUT: "true"
```

> ⚠️ **警告**：这可能会在日志中暴露敏感信息。仅在调试时使用。

在 Actions 日志中查找以下关键日志行来判断各阶段是否正常：

| 日志内容 | 含义 |
|---|---|
| `Bun version: x.x.x` | Bun 安装成功 |
| `Cloned to: /root/cca` | 仓库克隆成功 |
| `GITHUB_ACTION_PATH=/root/cca` | MCP 服务器路径正确 |
| `run-gitea.ts` 出现在 `ls` 输出中 | Gitea 入口文件存在 |
| `[Gitea] Patched prompt...` | 提示词工具名修复成功 |
| `[Gitea] Existing comment length=...` | 评论读取成功 |
| `[Gitea] Comment updated with status footer appended.` | 最终评论追加成功 |

---

## 部署到正式环境清单

从测试环境迁移到公司正式环境时，需要修改以下配置：

| 配置项 | 测试环境 | 正式环境 |
|---|---|---|
| `GITEA_API_URL` | `http://gitea:3000/api/v1` | `https://gitea.company.com/api/v1` |
| `GITEA_SERVER_URL` | `http://gitea:3000` | `https://gitea.company.com` |
| `CLAUDE_PAT` | 测试账号令牌 | 正式服务账号令牌 |
| `ANTHROPIC_API_KEY` | 测试密钥 | 正式密钥 |
| `ANTHROPIC_BASE_URL` | 测试代理地址 | 正式代理地址 |
| `BOT_NAME` | `claude-bot` | 按需自定义 |
| Container Network | `gitea-network` | 按实际网络配置 |
| Clone 地址 | `hooxing/claude-code-action` | 公司内部 Fork 地址 |

---

## 更多资源

- [Gitea Actions 文档](https://docs.gitea.com/usage/actions/overview)
- [Gitea API 文档](https://docs.gitea.com/development/api-usage)
- [Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code)
- [原版 Claude Code Action（GitHub）](https://github.com/anthropics/claude-code-action)
- [英文使用指南](./gitea-usage-guide.md)

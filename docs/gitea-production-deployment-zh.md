# 在已有生产环境 Gitea 上部署 Claude Code Action

本文档面向**已经有 Gitea 在生产环境运行**的团队，介绍如何在不影响现有服务的前提下，为仓库接入 Claude Code Action。

> 如果你需要从零搭建 Gitea + Runner，请参考 [完整使用指南](./gitea-usage-guide-zh.md)。

---

## 目录

1. [前置检查](#1-前置检查)
2. [启用 Gitea Actions](#2-启用-gitea-actions)
3. [部署 act_runner](#3-部署-act_runner)
4. [配置密钥](#4-配置密钥)
5. [添加工作流文件](#5-添加工作流文件)
6. [验证部署](#6-验证部署)
7. [安全与网络注意事项](#7-安全与网络注意事项)
8. [多仓库推广](#8-多仓库推广)

---

## 1. 前置检查

在开始之前，请确认以下信息：

| 检查项 | 如何确认 | 要求 |
|---|---|---|
| Gitea 版本 | 站点管理 → 首页底部 | ≥ 1.19 |
| 管理员权限 | 能否访问站点管理页面 | 需要，用于注册 Runner |
| Docker | 在目标服务器运行 `docker --version` | 已安装（Runner 使用 Docker 模式） |
| 外网访问 | Runner 服务器能否访问外网 | 需要访问 Anthropic API 和 npm 注册表 |
| Gitea 内网地址 | Runner 服务器能否访问 Gitea | Runner 需要调用 Gitea API |

> **⚠️ 风险评估**：本操作仅新增 Runner 服务和工作流文件，**不修改** Gitea 本身的配置或数据库，对现有服务无影响。唯一需要确认的是 `app.ini` 中 Actions 是否已启用。

---

## 2. 启用 Gitea Actions

检查 Gitea 的 `app.ini` 文件（通常在 `/data/gitea/conf/app.ini` 或 Docker 挂载卷中）：

```ini
[actions]
ENABLED = true
```

- 如果**已经有这一行**且为 `true` → 跳过此步。
- 如果**没有或为 `false`** → 添加/修改后**重启 Gitea 服务**：

```bash
# Docker 部署
docker restart gitea

# 二进制部署
systemctl restart gitea
```

> **影响范围**：启用 Actions 不会对现有 CI/CD 或仓库产生影响。只有在仓库中放置了 `.gitea/workflows/` 目录才会触发。

---

## 3. 部署 act_runner

### 选择部署方式

| 方式 | 适用场景 | 优缺点 |
|---|---|---|
| **Docker 容器（推荐）** | 生产环境、需要隔离 | 部署简单，干净隔离，易维护 |
| 二进制部署 | 无 Docker 的服务器 | 配置复杂，但资源开销小 |

### Docker 部署步骤

#### 3.1 获取 Runner 注册令牌

1. 使用管理员账号登录 Gitea。
2. 进入 **站点管理** → **Actions** → **Runner**。
3. 点击 **创建新 Runner**，复制注册令牌。

#### 3.2 确定网络方案

根据你的 Gitea 部署方式选择：

| Gitea 部署方式 | Runner 部署建议 | 网络方案 |
|---|---|---|
| Docker Compose 部署 | 加入同一 compose 文件或同一 Docker 网络 | 容器间用服务名访问（如 `http://gitea:3000`） |
| 独立 Docker 容器 | 创建共享 Docker 网络 | `docker network connect` 连接 |
| 二进制/systemd 部署 | 在同一服务器或可达的服务器上部署 Runner | 用 `localhost` 或内网 IP/域名 |
| 通过反向代理暴露 | Runner 可在任意位置 | 用公网域名（如 `https://gitea.company.com`） |

#### 3.3 创建 Runner 配置

在 Runner 的部署目录中创建以下文件结构：

```
runner/
├── config/
│   └── config.yaml    # Runner 配置
├── data/              # Runner 运行数据（自动生成）
└── docker-compose.yml # Runner 部署文件
```

**config.yaml**：

```yaml
log:
  level: info

runner:
  # 并发任务数（生产环境建议 ≥ 2）
  capacity: 2
  # 单任务超时时间
  timeout: 3600s
  # Runner 标签 → Docker 镜像映射
  labels:
    - "ubuntu-latest:docker://node:20-bullseye"

container:
  # ⚠️ 关键配置项 ——
  # 如果 Runner 和 Gitea 在同一 Docker 网络，写网络名
  # 如果 Runner 通过宿主机或域名访问 Gitea，留空即可
  network: ""
  docker_host: ""
  privileged: false
```

> **`network` 字段说明**：
> - 设为 Docker 网络名（如 `gitea-network`）：Runner 启动的 Job 容器会连接到该网络，可以用容器名访问 Gitea。
> - 留空：Job 容器使用默认 Docker 网络，需要通过宿主机 IP 或域名访问 Gitea。

**docker-compose.yml**（仅 Runner）：

```yaml
version: "3.8"
services:
  act_runner:
    image: gitea/act_runner:latest
    container_name: claude-runner
    volumes:
      - ./data:/data
      - ./config/config.yaml:/config.yaml
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      # ⚠️ 替换为你的 Gitea 地址
      GITEA_INSTANCE_URL: https://gitea.company.com
      # ⚠️ 替换为你的注册令牌
      GITEA_RUNNER_REGISTRATION_TOKEN: <你的注册令牌>
      # ⚠️ labels 必须包含完整 Docker 镜像地址
      GITEA_RUNNER_LABELS: "ubuntu-latest:docker://node:20-bullseye"
      CONFIG_FILE: /config.yaml
    restart: unless-stopped
```

> 如果 Gitea 也运行在 Docker 中，需要把 Runner 加入同一网络：
> ```yaml
>     networks:
>       - gitea-network
> networks:
>   gitea-network:
>     external: true  # 引用已有网络
> ```
> 并在 `config.yaml` 中设置 `container.network: "gitea-network"`。

#### 3.4 启动 Runner

```bash
cd runner/
docker compose up -d
```

#### 3.5 验证注册

```bash
docker logs claude-runner
```

应看到：
```
Runner registered successfully.
```

同时在 Gitea → **站点管理** → **Actions** → **Runner** 中确认 Runner 为**在线（Idle）**状态。

---

## 4. 配置密钥

> **注意**：Gitea 不允许密钥名称以 `GITEA_` 或 `GITHUB_` 开头。

### 组织级/用户级密钥（推荐，一次配置所有仓库可用）

- **用户级**：头像 → 设置 → Actions → 密钥
- **组织级**：组织设置 → Actions → 密钥

### 仓库级密钥

进入仓库 → 设置 → Actions → 密钥。

### 必须添加的密钥

| 密钥名称              | 说明 | 获取方式 |
| --------------------- | ---- | -------- |
| `ANTHROPIC_API_KEY`   | Anthropic API 密钥 | [console.anthropic.com](https://console.anthropic.com) |
| `CLAUDE_PAT`          | Gitea 个人访问令牌，需 `repo` 权限 | Gitea → 头像 → 设置 → 应用 → 管理访问令牌 |

### 可选密钥

| 密钥名称              | 说明 |
| --------------------- | ---- |
| `ANTHROPIC_BASE_URL`  | 自定义 API 代理地址（如公司内部代理） |

> **PAT 创建建议**：
> - 建议为 Claude 创建**专用服务账号**（如 `claude-bot`），而非使用个人账号。
> - 该账号需要有目标仓库的**写入权限**。
> - PAT 权限范围选择 `repo`（完整仓库访问）。

---

## 5. 添加工作流文件

在目标仓库的**默认分支**中创建 `.gitea/workflows/claude.yml`。

> **前提**：进入仓库 → **设置** → **Actions** → 确认已勾选"启用仓库 Actions"。

### 完整工作流模板

复制以下内容，**只需修改标注了 ⚠️ 的部分**：

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

          # 1. 安装 Bun
          curl -fsSL https://bun.sh/install | bash
          export BUN_PATH="$HOME/.bun/bin"
          export PATH="$BUN_PATH:$PATH"

          # 2. 克隆 claude-code-action
          CCA_DIR="$HOME/cca"
          # ⚠️ 如果你有内部 Fork，改为内部地址
          git clone --depth 1 https://github.com/hooxing/claude-code-action "$CCA_DIR"

          # 3. 设置 MCP 路径（不要修改）
          export GITHUB_ACTION_PATH="$CCA_DIR"

          # 4. 安装依赖
          cd "$CCA_DIR"
          bun install --production

          # 5. 运行
          bun run "$CCA_DIR/src/entrypoints/run-gitea.ts"
        env:
          # ⚠️ 改为你的 Gitea 地址
          GITEA_API_URL: https://gitea.company.com/api/v1
          GITEA_SERVER_URL: https://gitea.company.com

          # 认证（使用密钥）
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

          # 评论设置
          USE_STICKY_COMMENT: "false"
          INCLUDE_FIX_LINKS: "true"
          ALLOWED_BOTS: ""
          ALLOWED_NON_WRITE_USERS: ""
          INCLUDE_COMMENTS_BY_ACTOR: ""
          EXCLUDE_COMMENTS_BY_ACTOR: ""

          # Claude 参数
          CLAUDE_ARGS: ""
          PROMPT: ""

          # 内部参数（不要修改）
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
          # ⚠️ 如果使用 API 代理，设为密钥；否则删除此行
          ANTHROPIC_BASE_URL: ${{ secrets.ANTHROPIC_BASE_URL }}
```

### 需要修改的配置项速查

| 配置 | 位置 | 修改为 |
|---|---|---|
| Gitea 地址 | `GITEA_API_URL` / `GITEA_SERVER_URL` | 你的实际 Gitea 域名 |
| 克隆地址 | `git clone` 行 | 公司内部 Fork 地址（如有） |
| API 代理 | `ANTHROPIC_BASE_URL` | 公司代理地址，或删除此行 |
| 机器人名称 | `BOT_NAME` | 按需自定义 |
| 触发词 | `TRIGGER_PHRASE` | 按需自定义（默认 `@claude`） |

---

## 6. 验证部署

### 6.1 基础测试

1. 在仓库中创建一个 Issue。
2. 发送评论：
   ```
   @claude 你好，请简单介绍一下你自己。
   ```
3. 预期结果：
   - Claude 会在几秒内创建一条评论："Claude Code is working…"
   - 几十秒后，评论内容更新为 Claude 的实际回复。
   - 最底部显示 "✅ Claude Code has finished working on this." 和 Job 链接。

### 6.2 功能要素检查

| 检查项 | 如何验证 | 正常结果 |
|---|---|---|
| Actions 触发 | 查看仓库 → Actions → 是否有新的 Run | 有运行记录 |
| Bun 安装 | Actions 日志中搜索 `Bun version` | 版本号正常 |
| 仓库克隆 | 日志中搜索 `run-gitea.ts` | 文件列出 |
| MCP 路径 | 日志中搜索 `GITHUB_ACTION_PATH` | 值为 `/root/cca` |
| 提示词修复 | 日志中搜索 `Patched prompt` | 出现替换日志 |
| 评论更新 | 日志中搜索 `Comment updated` | 追加成功 |
| 评论内容 | Issue 页面查看 | Claude 的完整回复 |

### 6.3 失败排查

如果测试不成功，按以下顺序排查：

```
Actions 没有触发
  → 检查仓库 Actions 是否启用
  → 检查 Runner 是否在线
  → 检查工作流文件是否在默认分支

Runner 报 "Skipping unsupported platform"
  → Labels 格式不正确（缺少镜像地址）
  → 同时检查 config.yaml 和 .runner 文件

报 "Module not found run-gitea.ts"
  → 克隆的仓库不包含 Gitea 入口文件
  → 改为克隆包含 run-gitea.ts 的 Fork

评论只有 "✅ has finished"，没有回复内容
  → GITHUB_ACTION_PATH 没有正确设置
  → 检查日志中是否有 export GITHUB_ACTION_PATH

报 API/认证错误
  → 检查 GITEA_API_URL 是否正确
  → 检查 PAT 是否有 repo 权限
  → 如果 Runner 在 Docker 容器中，确认网络能访问 Gitea
```

> 完整故障排除请参考 [使用指南的故障排除章节](./gitea-usage-guide-zh.md#故障排除)。

---

## 7. 安全与网络注意事项

### 7.1 网络安全

| 关注点 | 建议 |
|---|---|
| **Runner 服务器位置** | 建议部署在内网，通过内网地址访问 Gitea |
| **Anthropic API 出站** | Runner 需要访问 `api.anthropic.com:443`（或你的代理地址） |
| **npm/Bun 包下载** | Runner 需要访问 `registry.npmjs.org`、`bun.sh` |
| **Docker 镜像拉取** | Runner 需要能拉取 `node:20-bullseye` 镜像 |
| **Git 操作** | Runner 中的 Job 容器通过 PAT 推送代码到 Gitea |

### 7.2 代理与防火墙

如果公司网络有代理或防火墙，需要确保：

```
Runner 服务器 → Gitea API（内网，通常无限制）
Runner 服务器 → api.anthropic.com:443 或代理地址
Runner 服务器 → registry.npmjs.org:443
Runner 服务器 → bun.sh:443
Runner 服务器 → github.com:443（克隆 claude-code-action）
Runner 服务器 → Docker Hub（拉取 node 镜像，可改用内部镜像仓库）
```

> **如果无法访问 github.com**：可以将 `hooxing/claude-code-action` Fork 到公司内部 Git 服务，修改工作流中的 `git clone` 地址。

### 7.3 PAT 权限最小化

| 权限 | 是否必须 | 用途 |
|---|---|---|
| `repo:read` | ✅ | 读取 Issue/PR 数据 |
| `repo:write` | ✅ | 创建评论、推送代码 |
| `admin:repo` | ❌ | 不需要管理权限 |

### 7.4 密钥安全

- API 密钥和 PAT 通过 Gitea Secrets 注入，**不会明文出现在工作流文件中**。
- 生产环境建议**关闭 `INPUT_SHOW_FULL_OUTPUT`**（默认即关闭），避免日志泄露敏感信息。
- 建议为 Claude 创建**专用服务账号**，不使用管理员或个人账号的 PAT。

---

## 8. 多仓库推广

当单个仓库验证成功后，推广到其他仓库的步骤：

### 方式一：逐仓库配置

1. 将 `.gitea/workflows/claude.yml` 复制到每个目标仓库。
2. 确认仓库 Actions 已启用。
3. 如果使用用户级/组织级密钥，无需重复配置密钥。

### 方式二：模板仓库

1. 创建一个模板仓库，包含标准的 `.gitea/workflows/claude.yml`。
2. 新仓库从模板创建时自动包含工作流。
3. 已有仓库可以手动复制工作流文件。

### Runner 容量规划

| 仓库数量 | 同时活跃触发估计 | 建议 Runner `capacity` |
|---|---|---|
| 1–5 | 1–2 | 2 |
| 5–20 | 2–5 | 4 |
| 20+ | 5–10 | 部署多个 Runner |

> 每个 Claude 任务通常需要 30 秒到 5 分钟。如果同时活跃触发超过 Runner capacity，任务会排队等待。

---

## 快速参考卡

```
┌─────────────────────────────────────────────┐
│   生产环境部署 Claude Code Action 速查       │
├─────────────────────────────────────────────┤
│                                             │
│  ① app.ini → [actions] ENABLED = true       │
│  ② 注册 Runner（labels 含镜像地址）          │
│  ③ 配置密钥（ANTHROPIC_API_KEY + CLAUDE_PAT）│
│  ④ 提交 .gitea/workflows/claude.yml         │
│  ⑤ 发送 @claude 评论测试                    │
│                                             │
│  关键要素：                                  │
│  • Labels: ubuntu-latest:docker://node:20   │
│  • GITHUB_ACTION_PATH = clone 路径           │
│  • 克隆含 run-gitea.ts 的 Fork              │
│  • 所有操作在同一个 run: 块中               │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 更多资源

- [完整使用指南（中文）](./gitea-usage-guide-zh.md) — 从零搭建 + 全部参数说明
- [完整使用指南（英文）](./gitea-usage-guide.md) — English version
- [Gitea Actions 文档](https://docs.gitea.com/usage/actions/overview)
- [Claude Code 文档](https://docs.anthropic.com/en/docs/claude-code)

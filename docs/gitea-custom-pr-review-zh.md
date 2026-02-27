# 自定义 Claude Code Action 的 PR 审阅规则

在使用 Claude Code Action 自动审阅 Gitea 下的 Pull Request 时，有时候我们需要让 Claude 遵循团队特定的编码风格、安全检查或测试要求来执行 Review。

本文将介绍几种让 Claude 按照**指定/自定义规则**进行代码审阅的最佳实践方案。

## 方案一：在工作流文件 (Workflow) 中直接指定规则（适合简单规则）

最直接的方法是在 `.gitea/workflows/claude.yml` 中的 `prompt` 参数里直接给出审阅规则。

修改你的 Workflow 代码：

```yaml
      - name: Run Claude Code Action (Gitea)
        uses: hooxing/claude-code-action@main
        with:
          # ... 其他配置 ...
          prompt: |
            请作为高级前端工程师审阅此 Pull Request。
            必须遵循以下自定义规则：
            1. 所有新增的函数必须包含 JSDoc 注释。
            2. 禁用 console.log，如果有遗留请指出。
            3. 如果修改了 React 组件，必须检查是否考虑了重新渲染(rerender)的性能问题。
            4. 审阅结果请使用包含"需要修改"、"建议优化"或"完美通过"三个等级进行分类输出。
```

> **优点**：配置简单直观，集中在 CI 文件中。
> **缺点**：如果不方便把动辄几百行的规范写进 YAML 里，这种方式显得臃肿。

---

## 方案二：使用仓库内的独立规则文件（推荐，适合详细规则）

对于复杂的审查规则，强烈建议将规则写在仓库中的独立 Markdown 文件内，例如 `.github/REVIEW_GUIDELINES.md` 或 `AI-REVIEW-RULES.md`。

然后在 workflow 的 `prompt` 中指示 Claude 去读取该文件作为裁判标准：

### 1. 在你的代码仓库中创建规则文件
在仓库根目录新建文件 `AI-REVIEW-RULES.md`：
```markdown
# 业务代码 AI 审查指南

## 1. 命名规范
- 变量必须使用驼峰命名 (camelCase)
- 类名必须使用帕斯卡命名 (PascalCase)

## 2. 异常处理
- 所有网络调用必须有 try/catch 机制。
- 不允许吞弃 Error（即空的 catch 块）。

## 3. 安全要求
- SQL 查询绝不允许拼接字符串，必须使用参数化查询。
- 对外暴露的 API 返回体中不得包含密码或 Token 敏感字段。
```

### 2. 在 Workflow 中指示 Claude 加载此规则
在 `.gitea/workflows/claude.yml` 中：
```yaml
      - name: Run Claude Code Action (Gitea)
        uses: hooxing/claude-code-action@main
        with:
          # ...
          prompt: |
            请作为技术专家审阅此 Pull Request 的变更。
            审阅的唯一标准请严格参照当前仓库根目录下的 `AI-REVIEW-RULES.md` 文件。
            请先读取并理解该文件的要求，然后再检查本次 PR 的代码，并指出所有不符合该文件规定的地方。
```
当 Claude Code 在执行时，它会自动使用读取文件的工具找到并阅读 `AI-REVIEW-RULES.md`，然后利用该背景知识对变更进行打分或评价。

---

## 方案三：通过 Claude Code 配置项目上下文 (`.claude/settings.json`)

目前 Claude Code CLI 支持项目级配置。如果你在仓库的根目录提供一个定义好的提示词或者开启特定的 Context，可以进一步收敛行为。
但通常对于纯基于 Action 的 PR 审查来说，**方案二** 是最灵活并且效果最好的，因为大型语言模型更擅长处理直接下达的“先读规则、再看代码”的连续性指令。

---

## 进阶技巧：针对特定事件触发不同的审查规则

结合 Gitea Action 的上下文判断，你可以为 `Pull Request` 和普通的 `@claude` 评论分配不同的 Prompt：

```yaml
      - name: Run Claude Code Action (Gitea)
        uses: hooxing/claude-code-action@main
        with:
          # 利用 Gitea Event Context 编写条件表达式
          prompt: >-
            ${{ github.event_name == 'pull_request' && 
            '请检查代码变更，并根据 AI-REVIEW-RULES.md 执行严格的 Code Review。' || 
            '请回答用户的提问，或执行他们要求的代码修改。' }}
```

## 总结

让 Claude 自定义规则审阅的最佳做法是：**将复杂的规范写到专门的 `.md` 文档中，通过在 Action 的 `prompt` 入参里明文指令 Claude 去阅读它。** 由于 Claude Code 本身自带强大的文件检索和阅读工具 (Tools)，它能完美适配这种工作流。

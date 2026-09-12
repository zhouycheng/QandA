# Git 工作流

本文档定义 QandA 项目的分支、提交、推送和 Pull Request 规则。项目级 Git Workflow Skill 会读取并遵循本文档。

## 分支流转

```text
个人任务分支 ── PR + 1 人审核 + CI ──> develop
develop ────── PR + 3 人审核 + CI ──> main
```

规则如下：

- `main` 是稳定分支，禁止直接推送；
- `main` 只能接受来自 `develop` 的 PR；
- 合并到 `main` 至少需要 3 个有效审核；
- `develop` 是团队集成分支，禁止直接推送；
- 合并到 `develop` 至少需要 1 个有效审核；
- 个人任务分支必须通过 CI 后才能合并；
- PR 来源必须来自同一个仓库；
- PR 合并后应删除个人任务分支；
- `main` 和 `develop` 禁止强制推送和删除；
- 管理员不能绕过 `main` 和 `develop` 的保护规则。

## 创建任务分支

任务分支必须从最新的 `develop` 创建：

```bash
git fetch origin --prune
git switch -c <github-username>/<type>/<description> origin/develop
```

示例：

```text
zhouycheng/feat/add-question-filter
hopehoudini/fix/session-restore
JiangfengPang/docs/update-install-guide
Currycyber/test/add-question-cases
```

任务完成并合并后删除任务分支。

## 分支命名

格式：

```text
gitname/type/description
```

命名规则：

- `gitname` 使用 GitHub 用户名；
- `type` 只能使用 `feat`、`fix`、`chore`、`docs`、`test`、`refactor`、`build`、`ci`；
- `description` 使用小写英文、数字和短横线；
- 不使用空格、中文、下划线和随机编号；
- 不在 `main` 或 `develop` 上进行日常开发提交。

## 提交信息

格式：

```text
type(scope): 中文描述
```

类型说明：

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `chore` | 工程维护 |
| `docs` | 文档变更 |
| `test` | 测试变更 |
| `refactor` | 重构 |
| `build` | 构建或依赖变更 |
| `ci` | CI 配置变更 |

提交规则：

- 一个 commit 只表达一个独立逻辑；
- 文档、测试、功能、重构和 CI 改动尽量分开；
- 不将无关格式化、临时文件或生成文件混入业务提交；
- 每个 commit 都应具备独立的内容描述和提交原因；
- 提交前检查暂存区，确认没有混入无关改动。

## 分段提交

Agent 在规划提交前必须检查当前分支、upstream、工作区改动、冲突和远程同步状态。

Agent 执行 `git fetch origin --prune` 后比较当前分支和 upstream：

- 分支落后远程时停止提交并提示用户先同步；
- 分支与远程分叉时停止提交并提示用户处理分叉；
- 没有 upstream 时停止提交并提示用户配置远程跟踪；
- 分支与远程一致或仅领先远程时，才允许继续生成提交计划；
- Agent 不自动执行 pull、merge、rebase、reset、stash 或历史重写。

Agent 必须先用中文输出每个分段的提交信息、提交内容和独立提交原因，并询问用户是否同意。

用户未同意时不得暂存、提交或推送。用户同意后，Agent 只暂存计划中属于当前分段的文件，依次创建 commit，全部成功后自动 push 当前分支。

## Pull Request

PR 标题格式：

```text
type(scope): 中文描述
```

PR 正文格式：

```markdown
## Summary

- 说明改动了什么；
- 说明为什么需要改；
- 必要时附关联 issue 或设计文档链接。

## Notes

- 仅在存在迁移、兼容性、风险、截图或特殊决策时填写；
- 没有内容时删除本章节。
```

章节名沿用项目约定，但内容使用中文。普通 PR 不写 `Verification`，也不复制例行测试命令、完整文件清单、commit 清单、文档清单或通用回滚说明。

## 合并流程

个人任务分支合并到 `develop`：

1. 从最新 `develop` 创建任务分支；
2. 完成开发并按逻辑拆分 commit；
3. 创建 PR 到 `develop`；
4. 获得至少 1 个有效审核并通过 CI；
5. 使用 squash merge 合并；
6. 删除任务分支。

`develop` 合并到 `main`：

1. 创建 `develop` 到 `main` 的 PR；
2. 通过来源分支检查；
3. 获得至少 3 个有效审核；
4. CI 全部通过；
5. 使用 squash merge 合并。

## 文档与 Skill 的关系

- `.agents/skills/git-workflow/SKILL.md` 是给 Agent 读取的英文执行规则；
- 本文档是给开发者阅读的中文 Git 规则；
- 如果 Skill 与本文档不一致，以本文档中的项目 Git 规则为准；
- Agent 与用户沟通时始终使用中文，即使 Agent 读取的规则文件使用英文。

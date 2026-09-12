# QandA Git 操作速查

当前规则以 [Git 工作流](../git-workflow.md) 为准。本手册只说明操作，不另设审批或命名门禁。

## 日常流程

```text
从 origin/main 创建任务分支
→ 开发和自检
→ 提交、推送到任务分支
→ 创建 PR 到 main
→ 有写入权限的协作者自行合并
→ 确认后删除已合并任务分支
```

前期不要求他人审批；仍禁止直接推送、强推或删除 main。不要再把日常任务 PR 指向 develop。

## 第一次接入

```bash
git clone https://github.com/zhouycheng/QandA.git
cd QandA
git status
git remote -v
```

仓库当前尚无可运行应用骨架；后续启动方式以 README 的实际说明为准。

## 开始新任务

先处理好工作区中已有修改，再创建任务分支：

```bash
git status
git fetch origin --prune
git switch --no-track -c feat/question-list origin/main
```

分支名用于说明任务，不必包含用户名。每项独立任务使用短期分支，不使用长期个人集成分支。

## 保存与首次推送

```bash
git diff
git add <本次任务的文件>
git diff --cached
git diff --cached --check
git commit -m "feat(question): 增加题目列表"
git push -u origin HEAD
```

新分支首次 push 之前没有 upstream 是正常情况。首次 push 后才建立同名远程跟踪。不要用直接推送 main 的方式省略 PR。

## 创建与合并 PR

在 GitHub 创建 PR 时，base 选择 main，compare 选择当前任务分支。按模板说明改动和原因，自行核对差异、验证变更、处理冲突和已有讨论后合并。普通任务推荐 squash merge。

有写入权限的协作者无需等待其他人批准即可合并。发现 GitHub 仍显示强制审批、旧分支检查或其他阻塞时，核对后台配置，不通过强推或绕过 PR 解决。

## 合并后开始下一项任务

确认 PR 显示 Merged，且任务分支没有未合并的新提交后，再删除远程任务分支。接着从更新后的 origin/main 新建下一条分支：

```bash
git fetch origin --prune
git switch --no-track -c feat/next-task origin/main
```

不要复用已经 squash 合并的旧任务分支继续开发；也不要批量删除其他成员的分支。

## 常见问题

### 没有 upstream

新分支允许本地提交。首次推送使用 git push -u origin HEAD，事先确认没有同名远程分支冲突。不要把 origin/main 设置为任务分支的发布目标。

### push 被拒绝

先 fetch 并检查同名远程任务分支是否有新提交。保留本地工作，不用 force push 覆盖远程改动；请求协助处理分叉或冲突。

### 本地 main 落后

工作区干净时，可切回 main 并使用 git pull --ff-only origin main 同步。本地 main 有独有提交或无法快进时先检查，不执行 reset --hard。也可以直接从已 fetch 的 origin/main 创建新任务分支。

### 旧 develop 或个人分支还有工作

先检查独有提交及现有 PR，确认无遗漏后再迁移。旧 develop 的历史已通过 PR #2 合入 main，但后续新增提交仍需另行核对；不能据此直接删除所有旧分支。

## 使用 Agent

只检查时，可以说：请检查当前分支和改动，生成提交计划，不提交、不推送。

需要执行时，应明确本次授权范围，例如：请提交这次 Git 文档修改，推送到任务分支并创建目标为 main 的 PR。

提交、推送、创建 PR、合并和删除分支是不同操作；Agent 只执行已授权的部分，不以取消人工审批为由扩大操作范围。

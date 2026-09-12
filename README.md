# QandA

刷题系统，目标包含小程序端、用户网页端、管理端和统一后端。

## 当前阶段

仓库处于项目初始化阶段，目前提供 MVP 功能清单和协作规范，尚未提供可运行的应用骨架。不要把下面的 Git 命令当作应用启动命令。

## 开发流程

```text
main → 短期任务分支 → PR → main
```

前期不要求他人审批，有写入权限的协作者可以自行合并 PR；仍必须经过 PR，禁止直接推送、强推或删除 main。日常任务不再经过 develop。

```bash
git clone https://github.com/zhouycheng/QandA.git
cd QandA
git fetch origin --prune
git switch --no-track -c feat/your-task origin/main
```

开发后，只提交本次任务的文件，并首次推送任务分支：

```bash
git add <本次任务的文件>
git diff --cached --check
git commit -m "feat(scope): 说明本次改动"
git push -u origin HEAD
```

随后创建目标为 main 的 PR，核对改动后合并。不要直接执行 git push origin main。

## 文档

- [MVP 功能清单](docs/mvp-functions.md)
- [Git 协作规则](docs/git-workflow.md)
- [Git 操作速查与常见问题](docs/sops/QandA-Git-Workflow-Handbook.md)

后续维护阶段再根据实际需要增加审批和必需 CI。文档不会自动修改 GitHub 的后台分支保护设置。

# QandA

刷题系统，目标包含微信小程序端、用户 Web 端、管理端和统一后端。

## 当前阶段

仓库处于第一阶段 Independent MVP 开发期。

当前已经完成：

- Git 协作与仓库治理规则；
- Monorepo 空目录骨架；
- 四端 Independent MVP PRD；
- MVP 功能范围基线。

管理端已提供可运行的前端与 Mock Playground，运行方式见 [apps/admin/README.md](apps/admin/README.md)。其他端第一阶段仍按各自 PRD 独立完成 MVP 闭环；之后再进入 Contract Freeze、联调和 E2E。

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

随后创建目标为 main 的 PR，核对改动后合并。不要直接执行 `git push origin main`。

## 文档

- [文档索引](docs/README.md)
- [四端 MVP PRD](docs/prd/README.md)
- [Git 协作规则](docs/git-workflow.md)
- [Git 操作速查与常见问题](docs/sops/QandA-Git-Workflow-Handbook.md)

当前是第一阶段，不再为 PRD 按开发阶段拆分目录；后续确有多阶段产品文档需求时再调整。

后续维护阶段再根据实际需要增加审批和必需 CI。文档不会自动修改 GitHub 的后台分支保护设置。

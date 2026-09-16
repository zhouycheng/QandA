# QandA 文档索引

当前 `docs/` 只按文档职责整理，不按开发阶段拆分目录。当前项目处于第一阶段 Independent MVP。

```text
docs/
├── README.md
├── git-workflow.md
├── prd/
│   ├── README.md
│   ├── mvp-functions.md
│   ├── miniapp-mvp.md
│   ├── web-mvp.md
│   ├── admin-mvp.md
│   └── api-mvp.md
└── sops/
    └── QandA-Git-Workflow-Handbook.md
```

## 产品需求

进入 [PRD 索引](prd/README.md)。

## Git 协作

- [Git 工作流](git-workflow.md)
- [Git 操作速查与常见问题](sops/QandA-Git-Workflow-Handbook.md)

## 文档组织原则

- `prd/`：产品目标、MVP 范围、端内闭环和技术架构。
- `sops/`：面向开发成员的操作手册。
- `git-workflow.md`：项目 Git 协作规则的单一事实来源。
- 当前阶段不建立 `phase-1/`、`phase-2/` 等目录；后续出现真实多阶段文档需求时再拆分。

# QandA 文档索引

当前 `docs/` 只按文档职责整理，不按开发阶段拆分目录。当前项目处于第一阶段 Independent MVP。

```text
docs/
├── README.md
├── git-workflow.md
├── admin-figma-implementation.md
├── admin-student-platform-implementation.md
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

- [学生自主复习平台架构报告](prd/student-platform-architecture.md)：平台定位、共享题库、学生自选课程、后台模块、数据关系与实施建议。

## Git 协作

- [Git 工作流](git-workflow.md)
- [Git 操作速查与常见问题](sops/QandA-Git-Workflow-Handbook.md)

## 管理端实现

- [管理端学生平台改造说明](admin-student-platform-implementation.md)：当前页面、推荐规则、章节、发布检查、反馈处理、旧数据兼容及实际边界。
- [管理端 Figma 原型实现说明](admin-figma-implementation.md)：画板对应、交互规则、Mock 边界与验证方式。

## 文档组织原则

- `prd/`：产品目标、MVP 范围、端内闭环和技术架构。
- `sops/`：面向开发成员的操作手册。
- `git-workflow.md`：项目 Git 协作规则的单一事实来源。
- 当前阶段不建立 `phase-1/`、`phase-2/` 等目录；后续出现真实多阶段文档需求时再拆分。

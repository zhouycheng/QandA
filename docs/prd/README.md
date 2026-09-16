# QandA MVP PRD

当前目录保存 QandA 第一阶段 Independent MVP 的产品需求与范围基线。

## 第一阶段开发模型

```text
Independent MVP
      ↓
Contract Freeze
      ↓
Integration
      ↓
E2E
```

第一阶段要求四个端先独立完成自身闭环：

| 端 | Independent MVP 核心闭环 |
| --- | --- |
| 微信小程序 | 选择题库 → PracticeSession → 本地持久化 / 恢复 → Mock 提交 → PracticeResult |
| 用户 Web | 选择题库 → PracticeSession → 浏览器持久化 / 恢复 → Mock 提交 → PracticeResult |
| 管理端 | 科目 → 题库 → 题目 CRUD，通过 Playground / Mock Gateway 完成交互闭环 |
| API | Subject → QuestionBank → Question → PracticeSession → Submission → PracticeResult，通过 Swagger / HTTP Client / Integration Test 独立验证 |

前端 MVP 不依赖真实 Spring Boot 接口。Mock 与真实 HTTP 必须通过统一 Gateway / Adapter 边界切换，联调阶段只替换基础设施实现，不重写已经验证过的页面和业务流程。

API MVP 不 Mock 自身核心业务与数据库，使用真实 PostgreSQL 或 Testcontainers PostgreSQL 完成闭环。

## 文档

- [MVP 功能范围基线](mvp-functions.md)
- [微信小程序端 MVP PRD](miniapp-mvp.md)
- [用户 Web 端 MVP PRD](web-mvp.md)
- [管理端 MVP PRD](admin-mvp.md)
- [后端 API MVP PRD](api-mvp.md)

## 当前目录原则

当前是第一阶段，因此 PRD 不再按开发阶段拆分子目录。后续只有在确实进入新的产品阶段并产生独立需求基线时，再增加阶段级组织。

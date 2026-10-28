# QandA 产品需求与架构

本目录记录各端的需求基线和架构建议。实际实现状态以代码与对应应用文档为准。

## 当前实现状态

| 部分 | 当前实现 |
| --- | --- |
| 微信小程序 | 题库与学习记录使用本地存储；身份适配层支持 HTTP 请求与本地降级，练习业务仍待整体联调 |
| 管理端 | React 管理界面使用浏览器本地 Mock 数据，尚未接入统一 API |
| API | Kotlin / Spring Boot / Maven / MyBatis-Plus / PostgreSQL；完整业务和验收入口见后端 README |
| 用户 Web | 当前没有实现；保留 Web MVP PRD 作为未来产品范围 |

前端与 API 的联调尚未完成。API 合同位于 apps/api/contracts，实现情况见 [apps/api/README.md](../../apps/api/README.md)。

## 文档

- [微信小程序 MVP PRD](miniapp-mvp.md)
- [用户 Web MVP PRD](web-mvp.md)
- [管理端 MVP PRD](admin-mvp.md)
- [API MVP PRD](api-mvp.md)
- [学生自主复习平台架构报告](student-platform-architecture.md)：产品定位、共享内容、推荐范围与客户端接入约定。

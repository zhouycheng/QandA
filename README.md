<p align="center"><strong>QandA 是面向课程复习场景的题库与练习平台</strong></p>

<p align="center">
  微信小程序 · 内容管理端 · Kotlin API
  <br>
  <a href="#项目概览">项目概览</a> ·
  <a href="#工程结构">工程结构</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="#验证与文档">验证与文档</a>
</p>

QandA 为学生提供课程题库浏览、练习与学习记录能力，并为内容团队提供课程、题库、题目和运营内容管理能力。仓库采用多应用结构，包含原生微信小程序、React 管理端和 Kotlin 后端 API。

## 项目概览

以下状态按当前仓库实现整理：

| 子项目 | 技术栈 | 当前范围 |
| --- | --- | --- |
| 微信小程序 | 微信原生 JavaScript、WXML、WXSS | 题库浏览、练习、复盘和本地学习记录；身份适配层提供 HTTP Gateway 与本地降级，练习业务仍待联调 |
| 管理端 | React、TypeScript、Vite、Arco Design | 内容与运营管理界面，当前使用浏览器本地 Mock 数据 |
| 后端 API | Kotlin、Spring Boot、PostgreSQL、Flyway | 提供统一服务与 API 合同；101 项操作合同中 76 项已实现，25 项标记为 Draft |
| 用户 Web | — | 当前没有对应的运行实现；产品范围见 [Web MVP PRD](docs/prd/web-mvp.md) |

小程序题库、练习进度和学习记录保存在本地。管理端数据使用浏览器本地 Mock。API 与客户端的业务联调尚未完成；实现范围和本地运行方式分别见 [小程序说明](apps/miniapp/README.md)、[管理端说明](apps/admin/README.md) 和 [API 说明](apps/api/README.md)。

## 工程结构

| 路径 | 内容 |
| --- | --- |
| `apps/miniapp` | 微信小程序前端、题库数据、资源脚本与自检 |
| `apps/admin` | 管理端前端及 Mock 数据适配 |
| `apps/api` | Kotlin 服务端、数据库迁移、模块化 API 合同、验收工具与 Postman 集合 |
| `docs` | 产品需求、系统架构、管理端交付记录与 Git 工作流 |

API 合同由模块文档组成，聚合入口为 [apps/api/contracts/openapi.yaml](apps/api/contracts/openapi.yaml)。101 项合同包含已实现操作与明确标记为 Draft 的未来范围。

## 本地开发

### 微信小程序

在微信开发者工具中导入仓库内的 `apps/miniapp` 目录并编译。项目运行时不需要安装 npm 依赖或执行 TypeScript 构建。页面路由和开发说明见 [小程序 README](apps/miniapp/README.md)。

### 管理端

```bash
cd apps/admin
pnpm install
pnpm dev
```

开发服务器默认监听 `http://localhost:5174`。测试与生产构建命令见 [管理端 README](apps/admin/README.md)。

### 后端 API

需要 JDK 21、Node.js 和 Docker。首次运行时在仓库根目录执行：

```bash
node apps/api/scripts/backend.mjs init
node apps/api/scripts/backend.mjs deps
node apps/api/scripts/backend.mjs build
node apps/api/scripts/backend.mjs start
```

数据库依赖由 Docker Compose 管理。本地私有配置写入 `apps/api/.env.backend`。管理员初始化、邮件验证码捕获及服务停止方式见 [API README](apps/api/README.md)。

## 验证与文档

在 `apps/miniapp` 目录运行以下命令，可执行全部 Node 自检：

```bash
for f in tests/*.check.js; do
  node "$f" || exit 1
done
```

管理端验证命令为 `pnpm test` 和 `pnpm build`。后端单元测试、PostgreSQL 测试及合同校验步骤见 [API 验收说明](apps/api/acceptance/README.md)。

- [项目文档索引](docs/README.md)
- [产品需求与架构索引](docs/prd/README.md)
- [Git 工作流](docs/git-workflow.md)

## 开发协作

日常开发从最新 main 创建短期任务分支，通过 Pull Request 合并。分支、提交、检查与合并规则以 [Git 工作流](docs/git-workflow.md) 为准。

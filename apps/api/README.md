# QandA Kotlin API

服务端使用 Kotlin、Spring Boot 和 PostgreSQL。运行配置、数据库迁移、API 合同和验收工具均位于本目录。

## 本地运行

需要 JDK 21、Node.js 与 Docker。首次运行时生成本地私有配置并启动 PostgreSQL：

```sh
node apps/api/scripts/backend.mjs init
node apps/api/scripts/backend.mjs deps
node apps/api/scripts/backend.mjs capture
node apps/api/scripts/backend.mjs build
node apps/api/scripts/backend.mjs start
```

首次创建管理员账号时，在可交互终端运行：

```sh
node apps/api/scripts/backend.mjs bootstrap
```

服务默认监听本机 `8083` 端口。`.env.backend` 保存本地私有配置；邮件验证码可通过本地 Mailpit 捕获界面查看。`stop-deps` 停止开发依赖容器。

## API 合同

模块合同位于 [`contracts/modules/`](contracts/modules/)，聚合合同位于 [`contracts/openapi.yaml`](contracts/openapi.yaml)。合同覆盖 101 个操作：身份、授权、管理和内容模块的 76 项已实现操作，以及练习、学习记录和统计模块的 25 项未实现草案。草案保留操作标识、路径、方法和现存请求样例；尚未确定的响应细节保持待定。

合同根据现存 Postman 集合、服务实现、测试和去敏 HTTP 观察整理。此前版本的 OpenAPI 原件未能恢复，当前合同不保证与其逐字一致。

## 验收与 Postman

验收说明见 [`acceptance/README.md`](acceptance/README.md)。可运行 Kotlin 测试并校验静态合同：

```sh
node apps/api/scripts/backend.mjs test
node apps/api/scripts/backend.mjs postgresTest
```

导入 [`postman/QandA-MVP.postman_collection.json`](postman/QandA-MVP.postman_collection.json) 和 [`postman/QandA-Local.postman_environment.json`](postman/QandA-Local.postman_environment.json)。环境内的凭据字段为空，按本机测试身份填写；结构样例见 [`postman/QandA-MVP.examples.json`](postman/QandA-MVP.examples.json)。验收报告和运行日志写入被忽略的 `.backend-runtime/verification/`。

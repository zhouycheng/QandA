# QandA 后端

后端采用 Kotlin 2.2.21、Spring Boot 3.5.16、JDK 21、Maven 3.9.16、MyBatis-Plus 3.5.18 和 PostgreSQL 17.6。应用制品和 API 合同版本为 `1.0.0`。

业务包括账号与资料、独立管理员、学院专业、课程题库、推荐和个人选择、在线练习、学习记录、反馈、公告及统计。架构、关系模型和指标口径见[后端架构与数据库](../../docs/backend-architecture.md)。管理端和小程序目前仍使用各自的数据适配器，客户端接入单独进行。

## 本地运行

从仓库根目录执行，需要 JDK 21、Node.js 和已运行的 Docker：

```sh
node apps/api/scripts/backend.mjs init
node apps/api/scripts/backend.mjs deps
node apps/api/scripts/backend.mjs capture
node apps/api/scripts/backend.mjs build
node apps/api/scripts/backend.mjs db-init
node apps/api/scripts/backend.mjs bootstrap
BACKEND_DOCS_ENABLED=true node apps/api/scripts/backend.mjs start
```

`init` 首次生成权限为 `600` 的 `.env.backend`，已有文件会保留。构建通过项目 Maven Wrapper 执行；检测到标准 `HTTPS_PROXY` 环境变量时，在忽略目录生成私有 Maven 配置。`JAVA_HOME` 可以指定 JDK 21。

`db-init` 只接受空的本机专用开发库。需要重新开始时，显式运行 `db-reset`，该命令会清空配置指向的 `qanda_backend` 开发数据库公共 schema，重新执行完整的 [`db/schema.sql`](src/main/resources/db/schema.sql)。普通应用启动只检查结构，不修改或重建表。初始化和重建命令均校验运行模式、连接目标与数据库名称。

`bootstrap` 在可交互终端读取用户名、姓名和密码，创建首个平台管理员。密码不会出现在命令参数中；数据库初始化不包含默认管理员或默认密码。管理员不需要注册学生账号。

API 默认地址为 `http://127.0.0.1:8083/api/v1`，健康检查为 `/api/v1/health`。启用文档后，可访问本机服务的 `/swagger-ui/index.html` 和 `/v3/api-docs`。本地验证码进入 Mailpit；`stop-deps` 停止开发依赖容器。

## 已有数据库升级

练习同步增加配置快照、写入设备和确认序号字段。已有 `1.0.0` 数据库在备份后显式执行 [`20261028-practice-sync.sql`](src/main/resources/db/upgrades/20261028-practice-sync.sql)，保留已有账号、题库和练习。应用启动检查结构，不自动执行升级。新建数据库继续使用完整 `schema.sql`。升级前创建的练习没有完整配置快照，可通过编辑权获取与快照接口继续作答。

## 接口规则

- 学生通过邮箱或微信注册、登录，院系资料选填；管理员使用 `/admin/auth/sessions` 单独登录。
- 令牌通过 `Authorization: Bearer …` 传递，学生与管理员令牌隔离。密码或邮箱变更后重新登录。
- 写命令携带 UUID 格式的 `Idempotency-Key`。同一意图重试复用原键；同键不同内容返回 `409`。
- 更新请求使用业务并发字段；冲突返回 `VERSION_CONFLICT`。`PUT /me/profile` 完整替换资料，组织字段留空可以清除已有选择。
- 列表分页使用 `page`、`pageSize`，单页最多 `100` 条。需要全部目录时继续读取后续页。`GET /questions?keyword=…` 跨已发布可用题库搜索题干与选项；`GET /me/question-progress` 返回每题最近一次已判定的提交结果，用于各端一致的已练题数与正确率。
- 学生可访问有可练习题目的已发布题库，专业影响推荐。课程移除和资料变更保留历史记录。
- 同一用户可以创建多份独立练习，跨设备续答以练习 ID 为边界。创建时携带 `deviceId` 开启写入所有权；所有后续变更携带 `writerToken`，旧凭证在交接后失效。
- 创建练习固定题目修订与顺序。多选题需要确认；统一反馈时交卷前不返回答案及解析。简答题在交卷后自评，统计与客观题分开。
- 管理员安全设置执行登录锁定、闲置超时和密码组成规则。密码至少 12 个字符，可提高到 64；当前接口的设备验证、首次改密字段固定为关闭。
- JSON 使用 UTF-8，限制 8 MiB；图片上传限制 5 MiB，校验实际类型、像素与尺寸后保存为 PNG。

## 验证与合同

```sh
node apps/api/scripts/backend.mjs test
node apps/api/scripts/backend.mjs verify
```

`test` 执行单元测试；`verify` 执行单元测试及真实 PostgreSQL、Mailpit、HTTP 集成验收。集成测试使用 Testcontainers 独立数据库，生成运行时 OpenAPI 和去敏 HTTP 观察，输出位于忽略目录 `.backend-runtime/verification/`。

聚合合同为 [`contracts/openapi.yaml`](contracts/openapi.yaml)，各模块合同引用聚合文档中的共享模型。当前模块进度与 Q01 历史计划对照见[后端接口进度](../../docs/backend-progress.md)。合同和 Postman 生成、校验入口见[接口验收说明](acceptance/README.md)。Postman 的账号、密码、验证码和令牌变量由使用者填写。

本地捕获和测试微信身份用于独立验收；官方微信与腾讯云 SES 的真实服务验收需要对应配置和实际执行记录。

## 练习同步协议

联网创建带 `deviceId` 的练习一次返回 `configuration`、题目快照和独立的 `offlineGrading`。普通题目 DTO 按反馈时机提供可展示字段；客户端将离线判题数据保存在逻辑层，仅在确认作答或交卷后展示相应答案及解析。服务端重新判题并保存正式成绩。

`PUT /practice/sessions/{id}/progress-ack` 接收原进度字段及 `writerToken`、递增 `clientSequence`，只返回版本、确认序号与写入状态。客户端合并尚未发送的进度，固定在途请求的内容与幂等键，确认后保留更新的本地草稿。`expectedVersion` 用于业务并发校验，`writerToken` 用于设备写入隔离。

接管端调用 `writer-acquire` 后通过 `writer-state?deviceId=…` 等待。原设备看见 `pendingDeviceId` 后停止编辑、完成最后一批进度上传，再用相同确认序号和版本调用 `writer-release`。释放与新凭证签发在同一事务内完成。原设备退出时也可主动释放；离线或进程终止时，接管继续等待它再次联网完成交接。等待中的设备可创建独立新练习。

接管完成后，通过 `GET /practice/sessions/{id}/snapshot?deviceId=…` 和 `X-Practice-Writer` 请求头取得完整离线快照。普通读取不返回离线判题数据或其他设备的写入凭证。写入状态查询只返回匹配 `deviceId` 的持有者凭证；客户端的设备 ID 应使用持久化随机 UUID。

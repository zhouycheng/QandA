# QandA 后端

当前为 v1.0 开发基线，应用制品和 OpenAPI 合同版本为 `1.0.0`，接口前缀为 `/api/v1`。业务采用 Kotlin、Spring Boot、MyBatis-Plus 和 PostgreSQL，涵盖账号、目录、题库、练习、学习记录与管理接口。

## 运行结构

Docker Compose 管理三个服务：

| 服务 | 用途 | 本机入口 |
| --- | --- | --- |
| `api` | Java 21 运行时及完整 Spring Boot JAR，使用非 root 用户 | `http://127.0.0.1:8083` |
| `postgres` | 专用开发数据库，数据位于 `backend_pg` 卷 | 仅本机数据库端口 |
| `mailpit` | 捕获本地验证码邮件 | `http://127.0.0.1:58025` |

文件资源保存在 `backend_assets` 卷。Compose 只向本机发布服务端口；容器内部通过服务名连接数据库和 SMTP。

健康检查为 `/api/v1/health`，接口浏览入口为 `/swagger-ui/index.html`，运行时合同为 `/v3/api-docs`。

## 构建和启动

需要 Node.js、JDK 21 和运行中的 Docker。现有配置保存在忽略的 `.env.backend` 中，权限须为 `600`。首次使用时执行 `init` 生成私有密钥；已存在配置可直接进入重建步骤。

从仓库根目录执行：

```sh
node apps/api/scripts/backend.mjs init
node apps/api/scripts/rebuild.mjs
node apps/api/scripts/backend.mjs docker-up
```

`rebuild.mjs` 按顺序清理本项目 `target/` 中的编译缓存、测试报告与旧 JAR，执行 Maven `package` 和单元测试，再构建 `qanda-backend:dev` 镜像。构建成功后清理带本项目标签的悬空镜像；失败即停止。

镜像只包含 Java 21 运行时及应用 JAR；私有配置在启动时注入。构建上下文排除源码、私有配置与运行记录。重建脚本和容器重启保留数据库及文件卷。

PostgreSQL 在全新数据卷首次初始化时执行完整 `src/main/resources/db/schema.sql`。应用启动检查当前表结构。各业务记录的 `version`、内容修订与同步序号用于并发和练习一致性，独立于应用发布版本。

首次创建平台管理员：

```sh
node apps/api/scripts/backend.mjs docker-bootstrap
```

该命令在临时 API 容器的终端中读取用户名、姓名和密码。普通启动不创建默认管理员或默认密码。

## 日常操作

```sh
# 修改代码后重建并更新 API 容器
node apps/api/scripts/rebuild.mjs
node apps/api/scripts/backend.mjs docker-up

# 查看 API 日志；Ctrl+C 结束日志查看
node apps/api/scripts/backend.mjs docker-logs

# 停止 API，保留开发数据
node apps/api/scripts/backend.mjs docker-stop
```

项目 Maven Wrapper 固定构建工具版本。`JAVA_HOME` 可指定本机 JDK 21；Docker 启动、停止和日志命令不要求本机 JDK。构建复用标准代理环境变量生成私有 Maven 设置。

## 接口与练习同步

- 学生和管理员使用独立 Bearer token；写命令使用 UUID 格式的 `Idempotency-Key`。同一意图重试复用原键，同键不同内容返回 `409`。
- 更新使用业务并发版本；冲突返回 `VERSION_CONFLICT`。资料读取统一使用 `GET /me`，`PUT /me/profile` 完整替换资料。
- 列表采用 `page`、`pageSize`，每页最多 100 条。`GET /questions?keyword=…` 搜索已发布题库的题干与选项，个人题目进度由 `GET /me/question-progress` 提供。
- 创建练习必须携带 `deviceId`，一次返回固定配置、题序、修订及独立离线判题数据。客户端按题型与反馈模式控制答案展示，正式成绩由服务端判定。
- 进行中的练习变更携带有效 `writerToken`。进度统一通过 `PUT /practice/sessions/{id}/progress-ack` 提交，并携带递增 `clientSequence`；响应返回业务版本、确认序号及写入状态。
- 跨端调用 `writer-acquire` 后等待原设备同步并 `writer-release`；服务端在事务内更换凭证。持有者通过 `snapshot` 与 `X-Practice-Writer` 取得离线快照。简答题在交卷后按业务版本自评。
- 本地验证码进入 Mailpit。真实微信身份服务需要官方应用配置；开发配置的本地微信提供端用于自动检查。

### 腾讯云 SES 实发

在私有 `.env.backend` 中设置 `BACKEND_MAIL_ENABLED=true`、`BACKEND_MAIL_TRANSPORT=tencent-ses` 和 `BACKEND_SES_SEND_ENABLED=true`。SES 凭据、地域、已验证发信地址及通用验证码模板 ID 存放在仓库外的 `~/.config/qanda/tencent-ses.env`，权限为 `600`，对应字段为 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_SES_REGION`、`TENCENT_SES_FROM_EMAIL`、`TENCENT_SES_VERIFICATION_TEMPLATE_ID`。

通过 `node apps/api/scripts/backend.mjs docker-up` 启动时，脚本读取私有 SES 配置，Compose 将所需字段注入 API 容器。修改邮件配置后执行该命令重建容器即可生效。出站记录的 `ACCEPTED` 表示服务商受理，实际收件需结合 SES 投递状态和收件箱确认。

API 容器使用 Compose 指定的公共 DNS 解析 SES 域名，数据库仍通过 Docker 内部服务名访问。排查实发失败时同时检查容器内的域名解析与 HTTPS 连通性。

## 验证与文档

```sh
node apps/api/scripts/rebuild.check.mjs
node apps/api/scripts/backend.mjs test
node apps/api/scripts/backend.mjs verify
```

`verify` 使用隔离 PostgreSQL 和 Mailpit 执行 HTTP 及小程序运行时验收。合同和 Postman 的生成、校验方式见[接口验收说明](acceptance/README.md)。业务模型见[后端架构](../../docs/backend-architecture.md)，页面调用关系见[小程序接口台账](../../docs/miniapp-api-integration.md)。
